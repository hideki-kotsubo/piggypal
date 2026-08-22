import { Router } from 'express';
import { pool } from '../db.js';
import { signAccessToken } from '../jwt.js';
import { generateOpaqueToken, hashToken } from './crypto.js';
import { sendMagicLinkEmail } from './email.js';
import { requireAccessToken, type AuthedRequest } from './middleware.js';

export const authRouter = Router();

const REFRESH_COOKIE = 'piggypal_refresh';
const REFRESH_TTL_DAYS = 60;
const MAGIC_LINK_TTL_MINUTES = 15;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function refreshCookieOptions() {
  // docs/05 D13: httpOnly/Secure/SameSite. `secure` needs to be false for
  // plain-http local dev (browsers silently drop Secure cookies over
  // http, except on localhost specifically in newer browsers — not
  // relied on here). app.* and api-beta.* share the same registrable
  // domain in production (both under piggypal.codexbase.dev), which
  // makes this same-site despite being cross-origin — SameSite=lax is
  // sent on those requests, no need for the wider None+Secure exposure.
  // COOKIE_DOMAIN unset in dev scopes the cookie to the exact host only.
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    domain: process.env.COOKIE_DOMAIN || undefined,
    maxAge: REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000,
  };
}

// docs/05 flow, step 2: "Always returns 200 (no user enumeration)" — this
// never checks whether `email` already has an account before sending,
// same code path either way.
authRouter.post('/request-link', async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(email)) {
    res.status(400).json({ error: 'Invalid email' });
    return;
  }

  const token = generateOpaqueToken();
  await pool().query(
    `INSERT INTO magic_links (email, token_hash, expires_at) VALUES ($1, $2, now() + interval '${MAGIC_LINK_TTL_MINUTES} minutes')`,
    [email, hashToken(token)],
  );

  const appBaseUrl = process.env.APP_BASE_URL || 'http://localhost:3001';
  const verifyUrl = `${appBaseUrl}/auth/verify?token=${encodeURIComponent(token)}`;
  await sendMagicLinkEmail(email, verifyUrl);

  res.json({ ok: true });
});

// docs/05 flow, step 3-4. Called by the app's own client-side JS (not a
// raw browser navigation) once it's loaded the /auth/verify page from the
// emailed link — that's the only way this endpoint can ever learn the
// clicking device's local user_id and device_id, both purely client-side
// values (docs/05 D11, D12). The app-side route that does this call isn't
// built yet (separate piece from "build /api/auth/*") — this endpoint is
// independently testable via a direct request with those two values
// supplied manually.
authRouter.get('/verify', async (req, res) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  const localUserId = typeof req.query.localUserId === 'string' ? req.query.localUserId : '';
  const deviceId = typeof req.query.deviceId === 'string' ? req.query.deviceId : '';
  if (!token || !UUID_RE.test(localUserId) || !UUID_RE.test(deviceId)) {
    res.status(400).json({ error: 'token, localUserId, and deviceId (both UUIDs) are all required' });
    return;
  }

  const client = await pool().connect();
  try {
    await client.query('BEGIN');

    const linkResult = await client.query<{ id: string; email: string }>(
      `SELECT id, email FROM magic_links WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now()`,
      [hashToken(token)],
    );
    const link = linkResult.rows[0];
    if (!link) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'Invalid or expired link' });
      return;
    }
    await client.query('UPDATE magic_links SET consumed_at = now() WHERE id = $1', [link.id]);

    // docs/05 D11: existing account wins outright (second-device-joins
    // flow); a brand-new email adopts the *client's* local_user_id as
    // users.id rather than generating a server-side one, so the device
    // that just signed up never needs a local rekey.
    const existing = await client.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [link.email]);
    let userId: string;
    let isNewUser: boolean;
    if (existing.rows[0]) {
      userId = existing.rows[0].id;
      isNewUser = false;
    } else {
      userId = localUserId;
      isNewUser = true;
      await client.query('INSERT INTO users (id, email) VALUES ($1, $2)', [userId, link.email]);
    }

    const refreshToken = generateOpaqueToken();
    await client.query(
      `INSERT INTO refresh_tokens (user_id, device_id, token_hash, expires_at) VALUES ($1, $2, $3, now() + interval '${REFRESH_TTL_DAYS} days')`,
      [userId, deviceId, hashToken(refreshToken)],
    );

    await client.query('COMMIT');

    res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions());
    res.json({ accessToken: await signAccessToken(userId), userId, isNewUser });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// docs/05: "Access token refresh" — cookie-authenticated, no body, rotates
// on every use. Reuse of an already-rotated token is a theft signal: the
// whole chain for that device gets revoked, forcing re-login on that
// device only (other devices' own chains are untouched).
authRouter.post('/refresh', async (req, res) => {
  const cookieToken = req.cookies?.[REFRESH_COOKIE];
  if (typeof cookieToken !== 'string' || !cookieToken) {
    res.status(401).json({ error: 'No refresh token' });
    return;
  }

  const tokenHash = hashToken(cookieToken);
  const result = await pool().query<{
    id: string;
    user_id: string;
    device_id: string;
    expires_at: string;
    revoked_at: string | null;
    replaced_by: string | null;
  }>('SELECT id, user_id, device_id, expires_at, revoked_at, replaced_by FROM refresh_tokens WHERE token_hash = $1', [tokenHash]);
  const row = result.rows[0];
  res.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
  if (!row) {
    res.status(401).json({ error: 'Unknown refresh token' });
    return;
  }

  if (row.revoked_at || row.replaced_by) {
    // Reuse of a token that's already been rotated away or revoked —
    // exactly the theft signal docs/05 describes. Revoke every other
    // still-live token for this same user+device (the rest of the
    // chain), not just this one row.
    await pool().query(
      'UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND device_id = $2 AND revoked_at IS NULL',
      [row.user_id, row.device_id],
    );
    res.status(401).json({ error: 'Refresh token reuse detected — this device has been signed out' });
    return;
  }

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    res.status(401).json({ error: 'Refresh token expired' });
    return;
  }

  const newToken = generateOpaqueToken();
  const insertResult = await pool().query<{ id: string }>(
    `INSERT INTO refresh_tokens (user_id, device_id, token_hash, expires_at) VALUES ($1, $2, $3, now() + interval '${REFRESH_TTL_DAYS} days') RETURNING id`,
    [row.user_id, row.device_id, hashToken(newToken)],
  );
  await pool().query('UPDATE refresh_tokens SET revoked_at = now(), replaced_by = $1 WHERE id = $2', [insertResult.rows[0].id, row.id]);

  res.cookie(REFRESH_COOKIE, newToken, refreshCookieOptions());
  res.json({ accessToken: await signAccessToken(row.user_id) });
});

// docs/05: "requires a valid access token" — mints a fresh short-lived
// token for the PowerSync client SDK's own fetchCredentials() cycle,
// independent of the app's general ~10-min refresh cadence. Same shape
// as the general access token (signAccessToken already matches exactly
// what deploy/powersync/service.yaml's client_auth expects) — this
// endpoint exists as its own thing because PowerSync's SDK calls it on
// its own schedule, not because the token itself differs.
authRouter.get('/powersync-token', requireAccessToken, async (req: AuthedRequest, res) => {
  res.json({ token: await signAccessToken(req.userId!) });
});

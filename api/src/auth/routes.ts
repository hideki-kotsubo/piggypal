import { Router, type Request, type Response } from 'express';
import type { PoolClient } from 'pg';
import { pool } from '../db.js';
import { signAccessToken } from '../jwt.js';
import { generateOpaqueToken, generateSignInCode, hashToken, hashesMatch } from './crypto.js';
import { sendMagicLinkEmail } from './email.js';
import { requireAccessToken, type AuthedRequest } from './middleware.js';

export const authRouter = Router();

const REFRESH_COOKIE = 'flowtab_refresh';
const REFRESH_TTL_DAYS = 60;
// docs/05 D13's rotation/reuse-detection is otherwise correct but has no
// tolerance for two *legitimate* concurrent requests from the same
// device — a real report found this: a double page-reload (a stray
// second reload firing before the first reload's own silent-reconnect
// refresh had gotten its rotated cookie applied) sent the same
// already-rotated cookie twice, and the second request's reuse tripped a
// full chain revocation, signing the device out entirely. A short grace
// window lets a reuse that lands this fast keep the session alive instead
// — a real attacker replaying a stolen token isn't realistically also
// landing within single-digit seconds of the legitimate rotation, so this
// doesn't meaningfully weaken the theft signal, just stops it from firing
// on the client's own race.
const REUSE_GRACE_MS = 10_000;
const MAGIC_LINK_TTL_MINUTES = 15;
// docs/56 D204: 5 guesses against 10^6 codes per issued link — the row is
// consumed (dead) on the 5th wrong one.
const MAX_CODE_ATTEMPTS = 5;
const CODE_RE = /^\d{6}$/;
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

// docs/68: the iOS/Android apps' web views run at these origins, which are
// cross-site to the api, so WebKit never stores or sends the refresh
// cookie there (SameSite=lax, plus WKWebView's third-party cookie
// blocking). Requests from them get the refresh token in the JSON body
// instead, and the app keeps it in the Keychain / Android Keystore. Keyed
// on Origin because a browser page can't forge it: a web page, XSS
// included, never gets the token out of its httpOnly cookie this way.
const NATIVE_ORIGINS = new Set(['capacitor://localhost', 'https://localhost']);

function isNativeClient(req: Request): boolean {
  return NATIVE_ORIGINS.has(req.get('origin') ?? '');
}

// The presented refresh token: the cookie on the web, the request body
// from the native apps.
function presentedRefreshToken(req: Request): string {
  const cookieToken = req.cookies?.[REFRESH_COOKIE];
  if (typeof cookieToken === 'string' && cookieToken) return cookieToken;
  const bodyToken = req.body?.refreshToken;
  return typeof bodyToken === 'string' ? bodyToken : '';
}

// Hands a newly issued refresh token to the client the way it can keep
// it: a cookie for the web, a `refreshToken` field merged into the JSON
// response for the native apps.
function sendWithRefreshToken(req: Request, res: Response, refreshToken: string, body: Record<string, unknown>): void {
  if (isNativeClient(req)) {
    res.json({ ...body, refreshToken });
    return;
  }
  res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions());
  res.json(body);
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
  const code = generateSignInCode();
  await pool().query(
    `INSERT INTO magic_links (email, token_hash, code_hash, expires_at) VALUES ($1, $2, $3, now() + interval '${MAGIC_LINK_TTL_MINUTES} minutes')`,
    [email, hashToken(token), hashToken(code)],
  );

  const appBaseUrl = process.env.APP_BASE_URL || 'http://localhost:3001';
  const verifyUrl = `${appBaseUrl}/auth/verify?token=${encodeURIComponent(token)}`;
  await sendMagicLinkEmail(email, verifyUrl, code);

  res.json({ ok: true });
});

// docs/05 flow, step 3-4, shared by both ways of proving the email
// (docs/56 D204): the link's token (/verify) and the emailed code
// (/verify-code) each pick their own magic_links row, then land here —
// one path, so the two can't drift apart on user creation or session
// issuance. Runs inside the caller's transaction; the caller commits.
async function completeSignIn(
  client: PoolClient,
  req: Request,
  res: Response,
  link: { id: string; email: string },
  localUserId: string,
  deviceId: string,
): Promise<void> {
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

  sendWithRefreshToken(req, res, refreshToken, { accessToken: await signAccessToken(userId), userId, isNewUser });
}

// Called by the app's own client-side JS (not a raw browser navigation)
// once it's loaded the /auth/verify page from the emailed link — that's
// the only way this endpoint can ever learn the clicking device's local
// user_id and device_id, both purely client-side values (docs/05 D11,
// D12).
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
      `SELECT id, email FROM magic_links WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now() FOR UPDATE`,
      [hashToken(token)],
    );
    const link = linkResult.rows[0];
    if (!link) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'Invalid or expired link' });
      return;
    }
    await completeSignIn(client, req, res, link, localUserId, deviceId);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// docs/56 D204: the same sign-in, proven by the 6-digit code from the
// email instead of the link — typed into the app that requested it, so
// the session lands there even when the link can't (an iOS home-screen
// PWA never receives links; its storage and cookies are separate from
// Safari's). Only the newest live row for the email is checked, so
// requesting a new link retires the previous code. One generic error for
// unknown email / wrong code / dead row — no enumeration (docs/05).
authRouter.post('/verify-code', async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const code = typeof req.body?.code === 'string' ? req.body.code.replace(/\s/g, '') : '';
  const localUserId = typeof req.body?.localUserId === 'string' ? req.body.localUserId : '';
  const deviceId = typeof req.body?.deviceId === 'string' ? req.body.deviceId : '';
  if (!EMAIL_RE.test(email) || !CODE_RE.test(code) || !UUID_RE.test(localUserId) || !UUID_RE.test(deviceId)) {
    res.status(400).json({ error: 'email, a 6-digit code, localUserId, and deviceId are all required' });
    return;
  }

  const client = await pool().connect();
  try {
    await client.query('BEGIN');

    // FOR UPDATE serializes concurrent guesses against the same row, so
    // the attempt counter can't be raced past MAX_CODE_ATTEMPTS.
    const linkResult = await client.query<{ id: string; email: string; code_hash: string | null; code_attempts: number }>(
      `SELECT id, email, code_hash, code_attempts FROM magic_links
       WHERE email = $1 AND consumed_at IS NULL AND expires_at > now()
       ORDER BY expires_at DESC LIMIT 1 FOR UPDATE`,
      [email],
    );
    const link = linkResult.rows[0];
    if (!link || !link.code_hash || !hashesMatch(hashToken(code), link.code_hash)) {
      if (link) {
        await client.query(
          `UPDATE magic_links SET code_attempts = code_attempts + 1,
             consumed_at = CASE WHEN code_attempts + 1 >= $2 THEN now() ELSE consumed_at END
           WHERE id = $1`,
          [link.id, MAX_CODE_ATTEMPTS],
        );
      }
      await client.query('COMMIT');
      res.status(400).json({ error: 'Invalid or expired code' });
      return;
    }
    await completeSignIn(client, req, res, link, localUserId, deviceId);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// docs/05: "Access token refresh" — cookie-authenticated on the web, the
// token in the body from the native apps (docs/68), rotates on every use. Reuse of an already-rotated token is a theft signal: the
// whole chain for that device gets revoked, forcing re-login on that
// device only (other devices' own chains are untouched).
authRouter.post('/refresh', async (req, res) => {
  const presentedToken = presentedRefreshToken(req);
  if (!presentedToken) {
    res.status(401).json({ error: 'No refresh token' });
    return;
  }

  const tokenHash = hashToken(presentedToken);
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
    // Within-grace reuse of a *normally rotated* token (replaced_by set,
    // not a prior theft-revocation — that case has replaced_by null and
    // always falls through to the hard revoke below) is treated as a
    // same-device race, not theft: hop again off the chain's current tip
    // rather than nuking it. If the tip was itself already consumed by a
    // third concurrent request, tip.rows[0] comes back empty and this
    // falls through to the real theft response same as before.
    if (row.replaced_by && row.revoked_at && Date.now() - new Date(row.revoked_at).getTime() < REUSE_GRACE_MS) {
      const tip = await pool().query<{ id: string }>(
        'SELECT id FROM refresh_tokens WHERE id = $1 AND revoked_at IS NULL',
        [row.replaced_by],
      );
      if (tip.rows[0]) {
        const newToken = generateOpaqueToken();
        const insertResult = await pool().query<{ id: string }>(
          `INSERT INTO refresh_tokens (user_id, device_id, token_hash, expires_at) VALUES ($1, $2, $3, now() + interval '${REFRESH_TTL_DAYS} days') RETURNING id`,
          [row.user_id, row.device_id, hashToken(newToken)],
        );
        await pool().query('UPDATE refresh_tokens SET revoked_at = now(), replaced_by = $1 WHERE id = $2', [
          insertResult.rows[0].id,
          tip.rows[0].id,
        ]);
        sendWithRefreshToken(req, res, newToken, { accessToken: await signAccessToken(row.user_id) });
        return;
      }
    }

    // Reuse of a token that's already been rotated away or revoked,
    // outside the grace window (or the chain's tip was already gone too)
    // — the theft signal docs/05 describes. Revoke every other still-live
    // token for this same user+device (the rest of the chain), not just
    // this one row.
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

  sendWithRefreshToken(req, res, newToken, { accessToken: await signAccessToken(row.user_id) });
});

// A real gap found alongside the refresh-reuse race above: there was no
// way for a device to actually sign out — Settings had no button for it,
// and even if it had, nothing revoked the refresh cookie server-side.
// Never fails on a missing/already-invalid cookie (a device whose whole
// chain was already revoked, e.g. by the theft-signal branch above, still
// needs this to succeed so it can clear its local state and re-sign-in)
// — clearing the cookie and returning success is correct either way. No
// requireAccessToken (same reasoning as /refresh itself): the access JWT
// is memory-only and may already be gone by the time a real user reaches
// for "sign out," but the refresh cookie is still there to revoke.
authRouter.post('/logout', async (req, res) => {
  const presentedToken = presentedRefreshToken(req);
  res.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
  if (presentedToken) {
    await pool().query('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [
      hashToken(presentedToken),
    ]);
  }
  res.status(204).end();
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

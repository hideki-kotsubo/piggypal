import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool } from '../db.js';
import { signAccessToken } from '../jwt.js';
import { generateOpaqueToken, generateSignInCode, hashToken, hashesMatch } from './crypto.js';
import { sendMagicLinkEmail } from './email.js';
import { emailLanguage } from './emailTemplates.js';
import { isDeletedAccount, requireAccessToken, type AuthedRequest } from './middleware.js';

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

// docs/72 D258 — one fixed email + code for App Store / Play review, whose
// reviewers can't receive our email. Both env vars must be set, and the
// code must be 6 digits, or this is off. Everything else about sign-in
// is unchanged: the code still expires with its row and still dies after
// MAX_CODE_ATTEMPTS wrong tries.
function reviewLogin(): { email: string; code: string } | null {
  const email = process.env.REVIEW_EMAIL?.trim().toLowerCase() ?? '';
  const code = process.env.REVIEW_CODE?.trim() ?? '';
  if (!EMAIL_RE.test(email) || !CODE_RE.test(code)) return null;
  return { email, code };
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
  const review = reviewLogin();
  const isReviewEmail = review !== null && email === review.email;
  const code = isReviewEmail ? review.code : generateSignInCode();
  await pool().query(
    `INSERT INTO magic_links (email, token_hash, code_hash, expires_at) VALUES ($1, $2, $3, now() + interval '${MAGIC_LINK_TTL_MINUTES} minutes')`,
    [email, hashToken(token), hashToken(code)],
  );

  // docs/72 D258: the reviewer has no inbox to read, so nothing is sent.
  if (isReviewEmail) {
    res.json({ ok: true });
    return;
  }

  const appBaseUrl = process.env.APP_BASE_URL || 'http://localhost:3001';
  const verifyUrl = `${appBaseUrl}/auth/verify?token=${encodeURIComponent(token)}`;
  await sendMagicLinkEmail(email, verifyUrl, code, emailLanguage(req.body?.language));

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
    // docs/75 D285: a device that signed out keeping its data still
    // carries that account's id (the owner's users.id, or a household
    // member's profile id) — reusing it would collide with that row, so
    // the new account gets a fresh one and the app sees userId !== its
    // localUserId (its data belongs to another account).
    const taken = await client.query('SELECT 1 FROM users WHERE id = $1 UNION ALL SELECT 1 FROM profiles WHERE id = $1', [
      localUserId,
    ]);
    userId = taken.rows[0] ? randomUUID() : localUserId;
    isNewUser = true;
    await client.query('INSERT INTO users (id, email) VALUES ($1, $2)', [userId, link.email]);
    // docs/72 D260: the owner signing up again reuses the deleted id.
    await client.query('DELETE FROM deleted_accounts WHERE user_id = $1', [userId]);
  }

  await issueSession(client, req, res, userId, deviceId, { isNewUser });
}

// A new refresh-token chain for this device plus an access token — the
// end of every sign-in: email (completeSignIn above) and QR device
// linking (docs/71 D255). Commits the caller's transaction.
async function issueSession(
  client: PoolClient,
  req: Request,
  res: Response,
  userId: string,
  deviceId: string,
  body: Record<string, unknown>,
): Promise<void> {
  const refreshToken = generateOpaqueToken();
  await client.query(
    `INSERT INTO refresh_tokens (user_id, device_id, token_hash, expires_at) VALUES ($1, $2, $3, now() + interval '${REFRESH_TTL_DAYS} days')`,
    [userId, deviceId, hashToken(refreshToken)],
  );

  await client.query('COMMIT');

  sendWithRefreshToken(req, res, refreshToken, { accessToken: await signAccessToken(userId), userId, ...body });
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
      res.status(400).json({ error: 'Invalid or expired link', code: 'link_invalid' });
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
      res.status(400).json({ error: 'Invalid or expired code', code: 'code_invalid' });
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
    // docs/72 D260: deleting an account deletes its refresh tokens, so a
    // household device's token is simply unknown afterwards. The app sends
    // the account id it thinks it's in; if that account was deleted, say
    // so, and the app signs itself out instead of asking to sign in again.
    if (await isDeletedAccount(req.body?.userId)) {
      res.status(401).json({ error: 'This account was deleted', code: 'account_deleted' });
      return;
    }
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

// docs/71 D255 (docs/48 D178) — QR device linking, step 1: a device that's
// already signed in asks for a short-lived, single-use code to show as a
// QR. Being authenticated is what makes this safe to put on a screen: only
// someone already in the account can mint one. Each new code retires this
// account's older unclaimed ones, so at most one is live at a time.
const DEVICE_LINK_TTL_MINUTES = 5;

authRouter.post('/device-link/start', requireAccessToken, async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  const token = generateOpaqueToken();
  await pool().query('DELETE FROM device_link_codes WHERE user_id = $1 AND (claimed_at IS NULL OR expires_at < now())', [
    userId,
  ]);
  const inserted = await pool().query<{ expires_at: Date }>(
    `INSERT INTO device_link_codes (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '${DEVICE_LINK_TTL_MINUTES} minutes') RETURNING expires_at`,
    [userId, hashToken(token)],
  );
  res.json({ token, expiresAt: inserted.rows[0].expires_at.toISOString() });
});

// Step 2: the new device scanned the code. Deliberately unauthenticated —
// this device has no session yet; the code is the credential. Consumed on
// first use. Responds exactly like /verify (plus the account's email, which
// the scanning device never typed), so the app runs the same profile picker
// and merge flow after it (docs/48 D177).
authRouter.post('/device-link/claim', async (req, res) => {
  const token = typeof req.body?.token === 'string' ? req.body.token : '';
  const localUserId = typeof req.body?.localUserId === 'string' ? req.body.localUserId : '';
  const deviceId = typeof req.body?.deviceId === 'string' ? req.body.deviceId : '';
  if (!token || !UUID_RE.test(localUserId) || !UUID_RE.test(deviceId)) {
    res.status(400).json({ error: 'token, localUserId, and deviceId (both UUIDs) are all required' });
    return;
  }

  const client = await pool().connect();
  try {
    await client.query('BEGIN');
    const codeResult = await client.query<{ id: string; user_id: string; email: string }>(
      `SELECT c.id, c.user_id, u.email FROM device_link_codes c JOIN users u ON u.id = c.user_id
       WHERE c.token_hash = $1 AND c.claimed_at IS NULL AND c.expires_at > now() FOR UPDATE OF c`,
      [hashToken(token)],
    );
    const code = codeResult.rows[0];
    if (!code) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'That code has expired or was already used. Show a new one on the other device.', code: 'device_link_expired' });
      return;
    }
    await client.query('UPDATE device_link_codes SET claimed_at = now() WHERE id = $1', [code.id]);
    await issueSession(client, req, res, code.user_id, deviceId, { isNewUser: false, email: code.email });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// docs/71 D253 — signs another device out remotely: revokes every refresh
// token it holds for this account. Its current access token still works
// until it expires (15 min, docs/05); after that it gets a 401 on refresh
// and shows "Sync paused — sign in again" (docs/68 D244). The devices row
// itself is deleted by the caller through the normal upload path (one
// write path for synced tables), not here — refresh_tokens is server-only.
authRouter.post('/devices/:deviceId/revoke', requireAccessToken, async (req: AuthedRequest, res) => {
  const deviceId = String(req.params.deviceId);
  if (!UUID_RE.test(deviceId)) {
    res.status(400).json({ error: 'deviceId must be a UUID' });
    return;
  }
  await pool().query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND device_id = $2 AND revoked_at IS NULL', [
    req.userId!,
    deviceId,
  ]);
  res.status(204).end();
});

// docs/72 D257 — App Review 5.1.1(v): deletes the account and everything
// synced under it, for every person in the household (one account, docs/48).
// Only the owner may do it: the profile whose id is users.id itself. The
// caller proves which device it is with its own refresh token (the cookie
// on the web, the body from the native apps), and that device's synced row
// has to belong to the owner's profile. That stops another household
// member's device by accident; it isn't a hard boundary against a member
// who forges a device id, who could read all the data anyway.
//
// Rows go in foreign-key order, in one transaction. PowerSync then streams
// the deletions to any device still connected, so the caller disconnects
// its own sync first to keep its local copy (D257). Every refresh token is
// deleted with the user, so other devices drop to "sign in again" within
// one access-token lifetime, and requireAccessToken turns away the access
// tokens still live until then.
const ACCOUNT_TABLES = [
  'transaction_splits',
  'transactions',
  'budgets',
  'category_keywords',
  'scheduled_payments',
  'accounts',
  'categories',
  'devices',
  'profiles',
] as const;

authRouter.post('/delete-account', requireAccessToken, async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  const presentedToken = presentedRefreshToken(req);
  if (!presentedToken) {
    res.status(401).json({ error: 'Sign in again on this device to delete the account.', code: 'sign_in_again' });
    return;
  }

  const client = await pool().connect();
  try {
    await client.query('BEGIN');
    const session = await client.query<{ device_id: string }>(
      'SELECT device_id FROM refresh_tokens WHERE token_hash = $1 AND user_id = $2 AND revoked_at IS NULL AND expires_at > now()',
      [hashToken(presentedToken), userId],
    );
    const deviceId = session.rows[0]?.device_id;
    if (!deviceId) {
      await client.query('ROLLBACK');
      res.status(401).json({ error: 'Sign in again on this device to delete the account.', code: 'sign_in_again' });
      return;
    }
    const device = await client.query<{ profile_id: string }>('SELECT profile_id FROM devices WHERE id = $1 AND user_id = $2', [
      deviceId,
      userId,
    ]);
    if (device.rows[0]?.profile_id !== userId) {
      await client.query('ROLLBACK');
      res.status(403).json({ error: 'Only the account owner can delete the account.', code: 'not_owner' });
      return;
    }

    for (const table of ACCOUNT_TABLES) {
      await client.query(`DELETE FROM ${table} WHERE user_id = $1`, [userId]);
    }
    const user = await client.query<{ email: string }>('SELECT email FROM users WHERE id = $1', [userId]);
    await client.query('DELETE FROM device_link_codes WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM subscriptions WHERE user_id = $1', [userId]);
    if (user.rows[0]) await client.query('DELETE FROM magic_links WHERE email = $1', [user.rows[0].email]);
    await client.query('DELETE FROM users WHERE id = $1', [userId]);
    await client.query('INSERT INTO deleted_accounts (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [userId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  res.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
  res.status(204).end();
});

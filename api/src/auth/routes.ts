import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool } from '../db.js';
import { signAccessToken } from '../jwt.js';
import { generateOpaqueToken, generateSignInCode, hashPin, hashToken, hashesMatch, pinMatches } from './crypto.js';
import { sendMagicLinkEmail, sendPinResetCodeEmail, sendPinResetNoticeEmail } from './email.js';
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

// docs/77 D299 — the profile this device's session was verified as, or
// null. Server-only (device_profiles): the synced devices row is written
// by the client, so it can't be what decides whose private rows a device
// gets.
async function deviceProfileId(userId: string, deviceId: string): Promise<string | null> {
  const r = await pool().query<{ profile_id: string }>(
    'SELECT profile_id FROM device_profiles WHERE user_id = $1 AND device_id = $2',
    [userId, deviceId],
  );
  return r.rows[0]?.profile_id ?? null;
}

// The calling device, proven by its own live refresh token (the cookie on
// the web, the body from the native apps) — the same check delete-account
// makes. The access token alone doesn't say which device sent it.
async function callerDeviceId(client: PoolClient, req: Request, userId: string): Promise<string | null> {
  const presentedToken = presentedRefreshToken(req);
  if (!presentedToken) return null;
  const session = await client.query<{ device_id: string }>(
    'SELECT device_id FROM refresh_tokens WHERE token_hash = $1 AND user_id = $2 AND revoked_at IS NULL AND expires_at > now()',
    [hashToken(presentedToken), userId],
  );
  return session.rows[0]?.device_id ?? null;
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
  // docs/77 D299: a new sign-in starts with no verified profile, so the
  // device has to pick one again (and enter its PIN, if it has one)
  // before it downloads that person's "Only me" rows.
  await client.query('DELETE FROM device_profiles WHERE user_id = $1 AND device_id = $2', [userId, deviceId]);

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
        sendWithRefreshToken(req, res, newToken, {
          accessToken: await signAccessToken(row.user_id, await deviceProfileId(row.user_id, row.device_id)),
        });
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

  sendWithRefreshToken(req, res, newToken, {
    accessToken: await signAccessToken(row.user_id, await deviceProfileId(row.user_id, row.device_id)),
  });
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
//
// docs/77: carries the access token's profile_id over unchanged. A device
// whose verification was dropped (a PIN set from another device) keeps it
// until its access token next refreshes, at most one access-token
// lifetime plus this token's.
authRouter.get('/powersync-token', requireAccessToken, async (req: AuthedRequest, res) => {
  res.json({ token: await signAccessToken(req.userId!, req.profileId ?? null) });
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
  await pool().query('DELETE FROM device_profiles WHERE user_id = $1 AND device_id = $2', [req.userId!, deviceId]);
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
  'device_profiles', // docs/77
  'profile_pins',
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

// docs/77 D299 — profile PINs. 5 wrong PINs lock the profile for 15
// minutes; the counter resets on a correct PIN or when the lock ends.
const PIN_RE = /^\d{4,6}$/;
const MAX_PIN_ATTEMPTS = 5;
const PIN_LOCK_MINUTES = 15;

// Step after the profile picker: tells the server which household person
// this device is. A profile with a PIN needs it; one without (or a brand
// new profile whose row hasn't been uploaded yet) is accepted as is. The
// answer is stored per device (device_profiles) and becomes the
// profile_id claim in this and every later token for the device, until it
// signs in again (issueSession) or is removed.
authRouter.post('/session-profile', requireAccessToken, async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  const profileId = typeof req.body?.profileId === 'string' ? req.body.profileId : '';
  const pin = typeof req.body?.pin === 'string' ? req.body.pin : '';
  if (!UUID_RE.test(profileId)) {
    res.status(400).json({ error: 'profileId (a UUID) is required' });
    return;
  }

  const client = await pool().connect();
  try {
    await client.query('BEGIN');
    const deviceId = await callerDeviceId(client, req, userId);
    if (!deviceId) {
      await client.query('ROLLBACK');
      res.status(401).json({ error: 'Sign in again on this device.', code: 'sign_in_again' });
      return;
    }

    const profile = await client.query<{ user_id: string; deleted_at: Date | null }>(
      'SELECT user_id, deleted_at FROM profiles WHERE id = $1',
      [profileId],
    );
    const row = profile.rows[0];
    // An unknown id is a profile this device just created ("Someone new")
    // and hasn't uploaded yet. It can't have a PIN or private rows: both
    // need a session already verified as it.
    if (row && row.user_id !== userId) {
      await client.query('ROLLBACK');
      res.status(403).json({ error: 'Unknown profile', code: 'profile_unknown' });
      return;
    }
    if (row?.deleted_at) {
      await client.query('ROLLBACK');
      res.status(403).json({ error: 'This person was removed from the household.', code: 'profile_removed' });
      return;
    }

    const pinRow = await client.query<{ pin_hash: string; failed_attempts: number; locked_until: Date | null }>(
      'SELECT pin_hash, failed_attempts, locked_until FROM profile_pins WHERE profile_id = $1 FOR UPDATE',
      [profileId],
    );
    const stored = pinRow.rows[0];
    if (stored) {
      if (stored.locked_until && stored.locked_until.getTime() > Date.now()) {
        await client.query('ROLLBACK');
        res.status(429).json({ error: 'Too many wrong PINs.', code: 'pin_locked', lockedUntil: stored.locked_until.toISOString() });
        return;
      }
      if (!pin) {
        // The picker asks first and only then sends the PIN — not a guess.
        await client.query('ROLLBACK');
        res.status(403).json({ error: 'This person has a PIN.', code: 'pin_required' });
        return;
      }
      if (!PIN_RE.test(pin) || !(await pinMatches(pin, stored.pin_hash))) {
        const attempts = (stored.locked_until ? 0 : stored.failed_attempts) + 1;
        const locked = attempts >= MAX_PIN_ATTEMPTS;
        await client.query(
          `UPDATE profile_pins SET failed_attempts = $2,
             locked_until = CASE WHEN $3 THEN now() + interval '${PIN_LOCK_MINUTES} minutes' ELSE NULL END
           WHERE profile_id = $1`,
          [profileId, locked ? 0 : attempts, locked],
        );
        await client.query('COMMIT');
        res.status(403).json({ error: 'Wrong PIN.', code: 'pin_invalid', attemptsLeft: locked ? 0 : MAX_PIN_ATTEMPTS - attempts });
        return;
      }
      await client.query('UPDATE profile_pins SET failed_attempts = 0, locked_until = NULL WHERE profile_id = $1', [profileId]);
    }

    await client.query(
      `INSERT INTO device_profiles (user_id, device_id, profile_id) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, device_id) DO UPDATE SET profile_id = $3, verified_at = now()`,
      [userId, deviceId, profileId],
    );
    await client.query('COMMIT');
    res.json({ accessToken: await signAccessToken(userId, profileId) });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// Sets or changes the PIN of the profile this device is verified as.
// Being verified is the proof, so changing it doesn't ask for the old PIN
// (whoever holds this device can already read everything on it). Every
// other device verified as this profile has to enter the new PIN: one
// that picked it before there was a PIN is no longer trusted for it.
authRouter.post('/profile-pin', requireAccessToken, async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  const pin = typeof req.body?.pin === 'string' ? req.body.pin : '';
  if (!PIN_RE.test(pin)) {
    res.status(400).json({ error: 'The PIN must be 4 to 6 digits.', code: 'pin_format' });
    return;
  }

  const client = await pool().connect();
  try {
    await client.query('BEGIN');
    const deviceId = await callerDeviceId(client, req, userId);
    const profileId = deviceId
      ? (await client.query<{ profile_id: string }>('SELECT profile_id FROM device_profiles WHERE user_id = $1 AND device_id = $2', [userId, deviceId]))
          .rows[0]?.profile_id
      : undefined;
    if (!deviceId || !profileId) {
      await client.query('ROLLBACK');
      res.status(403).json({ error: 'This device is not verified as anyone yet.', code: 'profile_not_verified' });
      return;
    }
    const profile = await client.query('SELECT 1 FROM profiles WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL', [profileId, userId]);
    if (profile.rowCount === 0) {
      // A brand-new profile whose row hasn't been uploaded yet.
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'Not synced yet. Try again in a moment.', code: 'profile_not_synced' });
      return;
    }

    await client.query(
      `INSERT INTO profile_pins (profile_id, user_id, pin_hash) VALUES ($1, $2, $3)
       ON CONFLICT (profile_id) DO UPDATE SET pin_hash = $3, failed_attempts = 0, locked_until = NULL,
         reset_code_hash = NULL, reset_code_expires_at = NULL, reset_code_attempts = 0, updated_at = now()`,
      [profileId, userId, await hashPin(pin)],
    );
    await client.query('UPDATE profiles SET has_pin = true, updated_at = now() WHERE id = $1', [profileId]);
    await client.query('DELETE FROM device_profiles WHERE user_id = $1 AND profile_id = $2 AND device_id <> $3', [userId, profileId, deviceId]);
    await client.query('COMMIT');
    res.status(204).end();
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// docs/77 D303 — a forgotten PIN, reset by another household member from
// their own device: the person whose PIN it is tells them the new one, or
// they set it together. The acting device must be verified as someone
// else, and stays that person: it never becomes the target, so it never
// downloads their "Only me" records (whoever knows the new PIN can still
// enter it later, which is the accepted trade-off). Nothing is erased.
// The target's devices all have to enter the new PIN, and see who reset
// it, where and when (profiles.pin_reset_*, D304); the owner is emailed
// too.
authRouter.post('/profile-pin/reset', requireAccessToken, async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  const profileId = typeof req.body?.profileId === 'string' ? req.body.profileId : '';
  const pin = typeof req.body?.pin === 'string' ? req.body.pin : '';
  if (!UUID_RE.test(profileId)) {
    res.status(400).json({ error: 'profileId (a UUID) is required' });
    return;
  }
  if (!PIN_RE.test(pin)) {
    res.status(400).json({ error: 'The PIN must be 4 to 6 digits.', code: 'pin_format' });
    return;
  }

  const client = await pool().connect();
  let notify: { email: string; byName: string; deviceLabel: string } | null = null;
  try {
    await client.query('BEGIN');
    const deviceId = await callerDeviceId(client, req, userId);
    const actor = deviceId
      ? (
          await client.query<{ profile_id: string; display_name: string }>(
            `SELECT dp.profile_id, p.display_name FROM device_profiles dp
               JOIN profiles p ON p.id = dp.profile_id AND p.deleted_at IS NULL
             WHERE dp.user_id = $1 AND dp.device_id = $2`,
            [userId, deviceId],
          )
        ).rows[0]
      : undefined;
    if (!deviceId || !actor) {
      await client.query('ROLLBACK');
      res.status(403).json({ error: 'This device is not verified as anyone yet.', code: 'profile_not_verified' });
      return;
    }
    if (actor.profile_id === profileId) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'Change your own PIN with /profile-pin.', code: 'pin_own' });
      return;
    }
    const target = await client.query(
      `SELECT 1 FROM profiles p JOIN profile_pins pp ON pp.profile_id = p.id
       WHERE p.id = $1 AND p.user_id = $2 AND p.deleted_at IS NULL FOR UPDATE OF pp`,
      [profileId, userId],
    );
    if (target.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'This person has no PIN.', code: 'pin_not_set' });
      return;
    }

    const deviceLabel = (await client.query<{ label: string }>('SELECT label FROM devices WHERE id = $1 AND user_id = $2', [deviceId, userId]))
      .rows[0]?.label ?? null;
    await client.query(
      `UPDATE profile_pins SET pin_hash = $2, failed_attempts = 0, locked_until = NULL,
         reset_code_hash = NULL, reset_code_expires_at = NULL, reset_code_attempts = 0, updated_at = now()
       WHERE profile_id = $1`,
      [profileId, await hashPin(pin)],
    );
    await client.query(
      `UPDATE profiles SET has_pin = true, pin_reset_at = now(), pin_reset_by = $2, pin_reset_device = $3, updated_at = now()
       WHERE id = $1`,
      [profileId, actor.profile_id, deviceLabel],
    );
    await client.query('DELETE FROM device_profiles WHERE user_id = $1 AND profile_id = $2', [userId, profileId]);
    if (profileId === userId) {
      // The owner (docs/72 D257: profile id == users.id) owns the email.
      const user = await client.query<{ email: string }>('SELECT email FROM users WHERE id = $1', [userId]);
      if (user.rows[0]) notify = { email: user.rows[0].email, byName: actor.display_name, deviceLabel: deviceLabel ?? actor.display_name };
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // After the commit: the reset stands even if the email can't be sent;
  // the in-app notice is the one that always arrives.
  if (notify) {
    await sendPinResetNoticeEmail(notify.email, notify.byName, notify.deviceLabel, emailLanguage(req.body?.language)).catch((err: unknown) =>
      console.error('[auth] PIN reset notice email failed', err),
    );
  }
  res.status(204).end();
});

// docs/77 D302 — the owner forgot their PIN and has no other device (and
// maybe no one else in the household any more): a 6-digit code to the
// account email. Only the owner's PIN, since only the owner is proven by
// that inbox; anyone else asks a household member (D303). Any signed-in
// device of the account can ask, the code only goes to the owner's inbox.
authRouter.post('/profile-pin/email-code', requireAccessToken, async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  const client = await pool().connect();
  let email: string;
  const code = generateSignInCode();
  try {
    await client.query('BEGIN');
    const deviceId = await callerDeviceId(client, req, userId);
    if (!deviceId) {
      await client.query('ROLLBACK');
      res.status(401).json({ error: 'Sign in again on this device.', code: 'sign_in_again' });
      return;
    }
    const updated = await client.query(
      `UPDATE profile_pins SET reset_code_hash = $2, reset_code_expires_at = now() + interval '${MAGIC_LINK_TTL_MINUTES} minutes', reset_code_attempts = 0
       WHERE profile_id = $1`,
      [userId, hashToken(code)],
    );
    if (updated.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'The owner has no PIN.', code: 'pin_not_set' });
      return;
    }
    email = (await client.query<{ email: string }>('SELECT email FROM users WHERE id = $1', [userId])).rows[0].email;
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  await sendPinResetCodeEmail(email, code, emailLanguage(req.body?.language));
  res.status(204).end();
});

// The code from /profile-pin/email-code plus the new PIN. Verifies this
// device as the owner (like /session-profile) and returns its new access
// token; every other owner device has to enter the new PIN. Recorded as a
// reset (D304) too, in case the inbox isn't only the owner's.
authRouter.post('/profile-pin/email-reset', requireAccessToken, async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  const code = typeof req.body?.code === 'string' ? req.body.code.replace(/\s/g, '') : '';
  const pin = typeof req.body?.pin === 'string' ? req.body.pin : '';
  if (!PIN_RE.test(pin)) {
    res.status(400).json({ error: 'The PIN must be 4 to 6 digits.', code: 'pin_format' });
    return;
  }

  const client = await pool().connect();
  try {
    await client.query('BEGIN');
    const deviceId = await callerDeviceId(client, req, userId);
    if (!deviceId) {
      await client.query('ROLLBACK');
      res.status(401).json({ error: 'Sign in again on this device.', code: 'sign_in_again' });
      return;
    }
    const stored = (
      await client.query<{ reset_code_hash: string | null; reset_code_expires_at: Date | null; reset_code_attempts: number }>(
        'SELECT reset_code_hash, reset_code_expires_at, reset_code_attempts FROM profile_pins WHERE profile_id = $1 FOR UPDATE',
        [userId],
      )
    ).rows[0];
    const live = stored?.reset_code_hash && stored.reset_code_expires_at && stored.reset_code_expires_at.getTime() > Date.now();
    if (!stored || !live || !CODE_RE.test(code) || !hashesMatch(hashToken(code), stored.reset_code_hash!)) {
      if (live) {
        // Same rule as the sign-in code: the 5th wrong try kills it.
        const attempts = stored.reset_code_attempts + 1;
        await client.query(
          `UPDATE profile_pins SET reset_code_attempts = $2,
             reset_code_hash = CASE WHEN $3 THEN NULL ELSE reset_code_hash END
           WHERE profile_id = $1`,
          [userId, attempts, attempts >= MAX_CODE_ATTEMPTS],
        );
        await client.query('COMMIT');
      } else {
        await client.query('ROLLBACK');
      }
      res.status(403).json({ error: 'That code is wrong or expired.', code: 'code_invalid' });
      return;
    }

    const deviceLabel = (await client.query<{ label: string }>('SELECT label FROM devices WHERE id = $1 AND user_id = $2', [deviceId, userId]))
      .rows[0]?.label ?? null;
    await client.query(
      `UPDATE profile_pins SET pin_hash = $2, failed_attempts = 0, locked_until = NULL,
         reset_code_hash = NULL, reset_code_expires_at = NULL, reset_code_attempts = 0, updated_at = now()
       WHERE profile_id = $1`,
      [userId, await hashPin(pin)],
    );
    await client.query(
      `UPDATE profiles SET has_pin = true, pin_reset_at = now(), pin_reset_by = $1, pin_reset_device = $2, updated_at = now()
       WHERE id = $1`,
      [userId, deviceLabel],
    );
    await client.query('DELETE FROM device_profiles WHERE user_id = $1 AND profile_id = $1', [userId]);
    await client.query(
      `INSERT INTO device_profiles (user_id, device_id, profile_id) VALUES ($1, $2, $1)
       ON CONFLICT (user_id, device_id) DO UPDATE SET profile_id = $1, verified_at = now()`,
      [userId, deviceId],
    );
    await client.query('COMMIT');
    res.json({ accessToken: await signAccessToken(userId, userId) });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// D304 — "Got it" on the reset notice, from a device verified as the
// person it's about. Clears it on all their devices.
authRouter.post('/profile-pin/notice/dismiss', requireAccessToken, async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  const client = await pool().connect();
  try {
    const deviceId = await callerDeviceId(client, req, userId);
    const profileId = deviceId ? await deviceProfileId(userId, deviceId) : null;
    if (!profileId) {
      res.status(403).json({ error: 'This device is not verified as anyone yet.', code: 'profile_not_verified' });
      return;
    }
    await client.query(
      `UPDATE profiles SET pin_reset_at = NULL, pin_reset_by = NULL, pin_reset_device = NULL, updated_at = now()
       WHERE id = $1 AND user_id = $2 AND pin_reset_at IS NOT NULL`,
      [profileId, userId],
    );
    res.status(204).end();
  } finally {
    client.release();
  }
});

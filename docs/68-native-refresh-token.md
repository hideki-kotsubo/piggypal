# 68 — Native apps keep the refresh token in the Keychain

2026-10-10. Revises docs/05 D13 for the iOS and Android apps only.

## The bug

On the iPhone (installed from Xcode), sign-in and sync worked, but the
next day nothing synced in either direction: expenses entered while out
never reached the server, and changes made on the computer never
arrived. Settings still said "Signed in as …".

Cause: the refresh token (docs/05 D13) is an httpOnly cookie with
`SameSite=lax`. That works for the web app because `app.*` and `api.*`
are the same site. The native apps' web view runs at
`capacitor://localhost` (iOS) or `https://localhost` (Android), which is
cross-site to the api:

- `SameSite=lax` cookies are never sent on cross-site `fetch` requests.
- WKWebView also blocks third-party cookies by default.

So the cookie was never stored or sent. The 15-minute access token from
sign-in is memory-only; once it expired, or iOS closed the app,
`POST /api/auth/refresh` returned 401, `fetchPowerSyncCredentials()`
returned `null`, and PowerSync stopped without any error. Entries stayed
safely on the phone, queued for upload.

## The fix

| # | Decision | Why |
|---|---|---|
| D242 | In the native apps the refresh token lives in the iOS Keychain / Android Keystore (`capacitor-secure-storage-plugin`, `app/src/lib/nativeRefreshToken.ts`) and travels in the request body of `/refresh` and `/logout`. The web app keeps the httpOnly cookie, unchanged. | The usual mobile-app pattern; the Keychain is the platform's own secure store, so this is no weaker than the cookie, and it doesn't depend on WebKit cookie rules. Considered and rejected: `SameSite=None` (iOS still blocks the third-party cookie) and Capacitor's native HTTP (PowerSync's streaming connection doesn't work through it). |
| D243 | The api decides by `Origin`: only requests from `capacitor://localhost` or `https://localhost` get `refreshToken` in the JSON body (sign-in, `/verify`, `/verify-code`, `/refresh`); everyone else gets the cookie. `/refresh` and `/logout` accept the token from the cookie or the body. | A browser page can't forge `Origin`, so a web page (XSS included) can never read the refresh token out of its cookie this way. |
| D244 | When this device is marked signed in but the server rejects (401) or has no refresh token, the app says so: a "Sync paused — sign in again" banner on Home, "Signed out on this device" + "Sign in again" in Settings. A 401 deletes the stored token; a 5xx or network error keeps it for the next try. | Silent sync failure is what made this bug hard to notice. |

Rotation, the 10-second reuse grace window and the theft-signal chain
revocation (docs/05, docs/41) work the same with a body token. The app
saves the rotated token before returning, and concurrent refreshes in
one app are still coalesced into one request.

`clearAuthAccount()` (used by "Reset local data") now also deletes the
Keychain token, which the web cookie never allowed.

## What users see

A native app that was signed in before this release has no token in its
Keychain yet, so after updating it shows "Sync paused" once and needs one
more sign-in. After that the session lasts 60 days and renews on use.

## Also found

`npm install <package>` removes the `app/node_modules/@powersync/capacitor`
link that the root postinstall creates (docs/64) and doesn't recreate it,
so a `cap update` right after dropped PowerSync from the native projects.
`npm ci` / plain `npm install` run the postinstall, so the Mac is fine;
after adding a package here, run `node scripts/link-capacitor-plugins.mjs`
before `cap update`/`cap sync`.

## Verified

- api, against a throwaway PGlite Postgres (26/26): native sign-in returns
  the token in the body and sets no cookie (iOS and Android origins);
  refresh with a body token rotates it; no/unknown token → 401; reuse
  within the grace window hops; reuse after it → 401 and the whole chain
  revoked; logout with a body token revokes it; the web flow still sets
  and rotates the httpOnly `SameSite=Lax` cookie and never returns the
  token in a body, even when a web origin sends one; CORS preflight from
  `capacitor://localhost` passes.
- app, `src/lib/auth.native.test.ts` (8 tests, Keychain mocked): token
  saved at sign-in, sent and rotated on refresh, concurrent refreshes
  coalesced, 401 forgets it and flags the session, 5xx keeps it, a
  relaunch (nothing in memory) gets PowerSync credentials again, sign-out
  revokes and deletes it.
- Not yet on a real iPhone or Android device.

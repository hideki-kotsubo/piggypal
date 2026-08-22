# 41 — Magic-Link Auth, Implemented

## What this closes

docs/05's actual sign-in flow — the last piece of docs/39's server phase
that wasn't at least partially real yet. `api/` now has real, tested
`/api/auth/*` routes: `request-link`, `verify`, `refresh`,
`powersync-token`. Builds directly on docs/40's JWT/JWKS primitive
(`signAccessToken`, now also `verifyAccessToken`) — nothing there
changed in spirit, just gained a real caller.

## What's implemented

- **`api/src/db.ts`** — a lazily-constructed `pg` `Pool` against
  `DATABASE_URL` (the same production Postgres docs/39 step 1 verified,
  not a separate one).
- **`api/src/auth/crypto.ts`** — opaque token generation + SHA-256
  hashing (docs/05 D12: tokens are opaque and hashed at rest, plaintext
  only ever exists in the one email/cookie it's sent in).
- **`api/src/auth/email.ts`** — `sendMagicLinkEmail`, the one-function
  adapter D15 calls for. Logs the link to the console when
  `AZURE_COMMUNICATION_CONNECTION_STRING` is unset (true today — no ACS
  account exists yet, docs/39 open question #5) — which also happens to
  be exactly what local dev/testing needs, no inbox to check.
- **`api/src/auth/middleware.ts`** — `requireAccessToken`, a small Bearer
  gate reusable by any future route needing a signed-in user (the
  still-unbuilt sync-upload/parse routes, docs/03-04).
- **`api/src/auth/routes.ts`** — the four routes, matching docs/05's
  flows: `request-link` always returns 200 regardless of whether the
  email exists (no enumeration); `verify` resolves an existing account by
  email or creates one using the *client's* local user id as the new
  `users.id` (D11); `refresh` rotates on every use and, on reuse of an
  already-rotated token, revokes the entire refresh-token chain for that
  user+device (the theft-signal behavior docs/05 describes) rather than
  just the one reused row; `powersync-token` re-mints a fresh
  `signAccessToken` for PowerSync's own `fetchCredentials()` cycle, gated
  behind `requireAccessToken`.
- Wired into `api/src/index.ts`: `cors` (credentials-enabled, needed for
  the refresh cookie across app/'s and api/'s different subdomains),
  `express.json()`, `cookie-parser`, mounted at `/api/auth`.

## Two real interpretation calls docs/05 left implicit

1. **The emailed link points at an app/ route, not this API directly.**
   docs/05 literally says "clicks the link → `GET /api/auth/verify`," but
   `verify` needs the *clicking device's* local user id and device id —
   both purely client-side values no email hyperlink click can carry on
   its own. The link is `${APP_BASE_URL}/auth/verify?token=...`; the
   app's own JS (not built here — separate piece) is meant to read its
   local values and call this API from inside the running app. This
   endpoint is fully testable without that app-side page existing yet, by
   supplying `localUserId`/`deviceId` directly.
2. **`deviceId` is a required parameter, not silently generated.** docs/05
   calls it "client-generated, persisted locally," but nothing in `app/`
   generates one yet (only `getLocalUserId()`, a *user* identity,
   exists). Rather than invent a server-side fallback that would
   undermine the whole point of per-device refresh-token tracking, this
   endpoint requires a real UUID and 400s without one — `app/` gaining
   its own device-id generation is a prerequisite for actually calling
   this, not solved here.

## A real bug found and fixed

`db.ts`'s `Pool` was originally constructed at module-load time. Since ES
module imports fully evaluate before the importing file's own top-level
code runs, `auth/routes.ts`'s `import { pool } from '../db.js'` (and
everything it transitively pulled in) resolved *before*
`index.ts`'s own `process.loadEnvFile()` call ever executed — so
`DATABASE_URL` was reliably `undefined` at `Pool` construction time,
surfacing as a deeply unhelpful `pg` error (`SASL:
SCRAM-SERVER-FIRST-MESSAGE: client password must be a string`) with no
obvious link back to "env var not loaded yet." Fixed by making `pool` a
lazily-constructed singleton (`pool()`, called at request time, well
after env vars are loaded) rather than a top-level `const`.

## Verified

A real, throwaway end-to-end script (not committed — no test runner
exists yet, docs/00-backlog's Vitest item) drove the live dev server
against the real Postgres, 21/21 assertions passing:

- Full signup: request-link → magic link captured from the (stubbed)
  email log → verify creates a new user with the client's own local id,
  sets the refresh cookie, returns a real access token.
- The same magic-link token can't be reused after consumption (400).
- `powersync-token` mints a token that verifies against the *live*
  `/.well-known/jwks.json` endpoint via `jose`'s `createRemoteJWKSet`
  (not an in-process shortcut), with the right `sub`/`aud`; a garbage
  bearer token is correctly rejected (401).
- `refresh` rotates the cookie and mints a fresh access token.
- Reusing the just-rotated-away cookie is correctly rejected (401) *and*
  revokes the entire chain — confirmed by then also rejecting the
  currently-valid new cookie (401), not just the reused old one.
- Second device / existing account: a second `request-link` +`verify`
  for the same email returns the *original* account id, not the new
  device's local id, and `isNewUser: false`.
- Input validation: invalid email, missing `deviceId`, no refresh cookie
  all correctly 400/401.

`tsc --noEmit` clean on `api`; `tsc -b`/`oxlint` clean on `app`
(unrelated, re-checked anyway).

## Not in scope, still open

- **The app-side `/auth/verify` page** — reads local user id/device id,
  calls this API, and (D14) prompts to merge pre-existing local data when
  the account id differs from what's already on-device. None of this UI
  exists yet.
- **Device-id generation on the client** — a new, separate local identity
  from `getLocalUserId()`, needed before the app can call `verify` for
  real.
- **Real Azure Communication Services sending** — the adapter boundary
  exists (`email.ts`); the actual ACS SDK call doesn't, since no ACS
  account exists yet (docs/39 open question #5).
- **Rate limiting on `request-link`** — not specified anywhere in docs/05,
  not added speculatively.
- **The subscription gate** (docs/06) isn't wired into any of these
  routes — none of them are paid-tier-gated yet, matching that this is
  auth alone, not the billing enforcement layer.

**2026-08-22.**

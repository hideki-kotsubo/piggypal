# 40 — JWT Keypair & JWKS Endpoint

## What this closes

docs/39 step 3's second real blocker: `deploy/powersync/service.yaml`'s
`client_auth.jwks_uri` pointed at
`https://api-beta.piggypal.codexbase.dev/.well-known/jwks.json`, which
didn't exist. This is docs/05 D13's RS256 access-JWT half — not the full
auth flow (magic link, refresh tokens, cookies, `/api/auth/*` routes are
all still unbuilt), just the signing/verification primitive PowerSync and
every future gated route will depend on.

## What's implemented

- **`api/src/jwt.ts`** — `signAccessToken(userId)` (RS256, `sub=userId`,
  `aud=piggypal`, 15-minute TTL — exactly docs/05's "Server issues an
  access JWT (RS256, ~15 min TTL, sub=user_id)" line, no extra claims
  invented) and `getJwks()` (exports the public key as a JWK, `kid`
  derived deterministically from a SHA-256 hash of the public key itself
  rather than separately configured — automatically changes on a future
  key rotation, though multi-key rotation support isn't wired up, still
  single-key only). Uses `jose` (added as a new `api` dependency) rather
  than hand-rolling PEM/JWT encoding.
- **`GET /.well-known/jwks.json`** (`api/src/index.ts`) — serves
  `getJwks()`'s output; a missing key env var is a real `500`, not a
  silently-empty key set, since PowerSync depends on this route to do
  anything at all — a loud startup-adjacent failure beats a confusing
  runtime one.
- **`npm run -w api generate-jwt-keys`** (`api/scripts/generate-jwt-keys.ts`)
  — the *only* place a keypair gets generated. Deliberately not generated
  at server boot: an ephemeral boot-time keypair would silently invalidate
  every outstanding token on every restart, which is a much worse failure
  mode than requiring an explicit env var. Outputs `.env`-ready lines
  (real newlines escaped to `\n`, since PEM strings don't survive
  single-line env vars otherwise — `jwt.ts`'s `readPem` un-escapes them on
  read).
- **`api/.env.example`** — documents `JWT_PRIVATE_KEY`/`JWT_PUBLIC_KEY`
  alongside the existing `PORT`, matching docs/39's secrets table.

## Verified

Real round trip, not just `tsc`/type-shape checking:

- Generated a real dev keypair via the actual script, restarted `api`'s
  dev server with it loaded.
- Hit the live `/.well-known/jwks.json` over real HTTP — got a real JWK
  back (`kty: RSA`, `n`/`e`, `use: sig`, `alg: RS256`, `kid`).
- Signed a token with `signAccessToken`, then verified it using `jose`'s
  `createRemoteJWKSet` pointed at that same live HTTP endpoint (not an
  in-process shortcut) — confirmed `sub`, `aud`, `kid`, `alg` all correct,
  and `exp - iat = 900` (the real 15-minute TTL, not just the string
  `'15m'` trusted at face value).
- Confirmed a tampered token is rejected
  (`ERR_JWS_SIGNATURE_VERIFICATION_FAILED`), not silently accepted.
- Confirmed `getJwks()` throws a clear error (not a blank/broken
  response) when `JWT_PUBLIC_KEY` is unset.
- `tsc --noEmit` clean on `api`, `tsc -b`/`oxlint` clean on `app`
  (unrelated to this change, re-checked anyway).

One real fix mid-build: `jose` 6.x's TypeScript types export `CryptoKey`,
not the `KeyLike` type older `jose`/example code online still references
— caught by `tsc`, not assumed from stale documentation.

## Still open

- **Production keypair not generated** — the dev keypair above lives only
  in this sandbox's gitignored `api/.env`; a real one needs generating
  and placing wherever docs/39's still-open secrets-storage question
  lands, before `deploy/powersync/`'s `PS_JWKS_URL` resolves to anything
  real in production.
- No key rotation mechanism — single active key only, `kid` support in
  `getJwks()`'s shape is there but nothing generates or serves a second
  key during a rotation window.
- This is only the signing/verification primitive. `/api/auth/*` (magic
  link issuance, calling `signAccessToken` for real, refresh token
  rotation, the httpOnly cookie) is docs/05's next, larger, separate
  piece — not started here.

**2026-08-21.**

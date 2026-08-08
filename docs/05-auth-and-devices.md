# 05 — Auth & Devices

## Core principle: auth is opt-in, not required

Free tier does zero server calls (single-device, local-only — see MVP scope in
01-scope-and-decisions.md). No account, no sign-in, no JWT: the app is fully
functional with a purely local `user_id`. Auth only enters the picture the
moment a user upgrades to paid, because paid is exactly the tier that needs
sync + LLM, and both already require a server identity per the enforcement
points named in doc 01's Tiers section (`/api/sync/upload`, `/api/parse`).
Tying "must be signed in" to those same two gates costs nothing extra.

## Identity model

- Client generates a local `user_id` (UUID) on first launch — same
  client-owned-ID philosophy as every other row (D5). Used locally from day
  one; never sent to any server while on free tier.
- Postgres side: `users`, `magic_links`, `refresh_tokens` tables (server-only,
  not part of the sync buckets in 03-schema-and-sync-rules.md).

```sql
create table users (
  id          uuid primary key,          -- == the client's local user_id on first sign-up
  email       text not null unique,
  created_at  timestamptz not null default now()
);

create table magic_links (
  id           uuid primary key default gen_random_uuid(),
  email        text not null,
  token_hash   text not null,             -- sha256(token); the token itself is never stored
  expires_at   timestamptz not null,       -- issued_at + 15 min
  consumed_at  timestamptz
);

create table refresh_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id),
  device_id     uuid not null,             -- client-generated, persisted locally
  token_hash    text not null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,       -- created_at + 60 days, slides on rotation
  revoked_at    timestamptz,
  replaced_by   uuid references refresh_tokens(id)
);
```

## Flows

### First sign-up (upgrade to paid on device A)

1. User taps "Enable sync & AI" → enters email.
2. `POST /api/auth/request-link {email}` → server mints a token, stores its
   hash + 15 min expiry, emails the link. Always returns 200 (no user
   enumeration).
3. User clicks the link → `GET /api/auth/verify?token=` → server validates,
   and since `users.email` doesn't exist yet, creates the user row **using
   the client's local `user_id`** (sent alongside email at verify time) as
   the primary key.
4. Server issues an access JWT (RS256, ~15 min TTL, `sub=user_id`) and a
   refresh token (opaque, httpOnly/Secure/SameSite cookie, 60-day sliding
   TTL, tied to a client-generated `device_id`).
5. Client connects PowerSync using this identity. Local rows already carry
   the right `user_id` — nothing to rekey.

### Second device joins an existing account

1. Same request-link/verify flow, but `users.email` already exists → server
   returns the **existing** account `user_id`, not a new one.
2. Device has no pre-existing local data → it adopts the account id and
   starts syncing, done.
3. Device *does* have pre-existing standalone local data (was used
   free-tier before linking) → client detects `local user_id != account
   user_id` after verify and asks: *"Keep N existing local transactions and
   merge them into your account?"* before touching anything.
   - Accept → rewrite `user_id` on local rows to the account id, then
     connect PowerSync.
   - Decline → those rows are never silently merged or silently discarded;
     the user is offered an explicit choice (e.g. discard, or keep as a
     separate unsynced set) rather than either extreme happening for them.

### Access token refresh (app open & online)

- `POST /api/auth/refresh`, cookie-authenticated, no body.
- Rotates the refresh token on every use (old one marked `replaced_by`),
  issues a new access JWT.
- Reuse of an already-rotated (replaced) refresh token is treated as a theft
  signal → revoke the whole chain for that device, force re-login on that
  device only (other devices unaffected).
- Client calls this on app load, roughly every 10 min while open and online,
  and on any 401.

### Reconnect after weeks offline

- Local reads/writes are untouched the entire time (local-first) — this
  section only matters for *sync* resuming.
- On reconnect, PowerSync's `fetchCredentials()` triggers
  `/api/auth/refresh` via the cookie.
  - Refresh token still valid (< 60 days since last use) → silent resume,
    zero user interaction.
  - Expired/revoked → non-blocking "sign in to sync" banner; app stays
    fully usable; the next sync just catches up the backlog once
    re-authenticated.

### PowerSync token

- `GET /api/auth/powersync-token` (requires a valid access token) mints a
  short-lived JWT (`sub=user_id`) that the PowerSync Service verifies via
  JWKS (`/.well-known/jwks.json` on our API) — no shared secret to manage
  across the two deployments, matching the "shared JWKS/secret" note in
  02-sync-architecture.md.

## Decisions locked in this doc

| # | Decision | Why |
|---|---|---|
| D10 | Auth is opt-in — free tier never contacts the server; sign-in happens exactly at the "enable sync/AI" moment | Zero server dependency for the tier that's supposed to have zero server dependency; auth piggybacks on gates D5 already requires |
| D11 | Client-generated `user_id` doubles as the Postgres `users.id` on first sign-up (no server-side id generation) | Consistent with D5's client-owned-ID philosophy; avoids a rekey on the common "single device, upgrade in place" path |
| D12 | Refresh tokens: opaque (not JWT), hashed at rest, rotating, 60-day sliding TTL, per-device | Bounds a lost/stolen-device window to ~2 months while tolerating realistic offline gaps between app opens |
| D13 | Refresh token stored as httpOnly/Secure/SameSite cookie; access JWT (RS256) kept in memory only | Standard XSS-resistant pattern; iOS home-screen PWA storage/ITP behavior noted as a thing to verify empirically once built, not assumed |
| D14 | Device joining an existing account with pre-existing standalone local data: ask before merging, never silently rekey or silently discard | User-visible financial data deserves an explicit choice, not either extreme |
| D15 | Magic-link email sent via Azure Communication Services, behind a one-function adapter (`sendMagicLinkEmail`) | Stays in the existing Azure stack for now; the adapter boundary makes swapping to SendGrid/SES/another cloud later a same-day change — the entire auth model (tokens, hashing, expiry, Postgres) is vendor-agnostic, only the send call + DNS/domain verification would move |
| D16 | Device list / per-device revoke UI deferred past v1 | Data model (`device_id` on refresh_tokens) supports it already; no UI needed until multi-device usage is common enough to justify it |

## Explicitly out of scope for v1

- Social login / passwords — magic link only.
- Household/shared accounts — this model is single-user per account; revisit
  alongside the household_id bucket noted in 02-sync-architecture.md.

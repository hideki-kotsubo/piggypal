# 42 — App-Side Auth Flow, Implemented

## What this closes

docs/41's own flagged followup: the app-side half of docs/05's sign-up/
second-device flow. `GET /api/auth/verify` was real but had no caller — a
raw browser navigation can't supply `localUserId`/`deviceId`, both purely
client-side values. This is that caller.

## What's implemented

- **`app/src/lib/identity.ts`** — `getDeviceId()`, the one piece docs/41
  flagged as missing: a client-generated UUID, separate from
  `getLocalUserId()`, persisted locally. Never rewritten by docs/25's
  own-device pairing merge — two devices that just unified their *user*
  identity are still two distinct devices for refresh-token/revocation
  purposes.
- **`app/src/lib/auth.ts`** — the API client: `requestMagicLink`,
  `verifyMagicLink`, `refreshAccessToken`, `fetchPowerSyncCredentials`,
  `uploadSyncOps` (the last two feed docs/43's connector). The access JWT
  lives in a module-level variable only (docs/05 D13: memory-only, never
  persisted) — lost on every reload, refreshed from the httpOnly cookie
  on demand. A separate, genuinely non-secret `useAuthAccount()` /
  `piggypal:auth-account` localStorage marker (email + userId only) is
  what lets Settings show "Signed in as ___" across reloads despite the
  token itself not surviving one.
- **`app/src/components/AuthVerifyScreen.tsx`**, mounted at `/auth/verify`
  — reads `?token=`, calls `verifyMagicLink`, and branches:
  - New account (`isNewUser`) → nothing to reconcile (D11: the server
    already used this device's own local id), straight to signed-in.
  - Existing account, this device has no local data → adopts the account
    id silently (D14's "skip the prompt" case — nothing to lose).
  - Existing account, this device *does* have local data → D14's merge
    prompt: "This device already has N accounts and M transactions.
    Merge them into your account, or keep this device separate?"
- **`app/src/components/SettingsScreen.tsx`** — a new "Account" section,
  docs/05 flow step 1 ("User taps 'Enable sync & AI' → enters email"):  an
  email input + "Send sign-in link" button when signed out, "Signed in
  as ___" + a live sync-connection line (`useSyncStatus`, docs/43) once
  signed in.
- **`app/src/lib/store.tsx`** — `adoptAccountId(newId)`, the auth
  equivalent of docs/25's `applyPeerDataset`'s `adoptPeerIdentity`
  rewrite, minus the peer-dataset merge (there's no other device's rows
  to insert here, just this device's own data reconciling with the
  account id the server resolved). Both now share one
  `rewriteOwnerIdentity()` helper — that logic was duplicated verbatim
  before this pass, now written once.
- Reconnect-on-load: `StoreProvider` now calls `connectSync()` once if a
  prior sign-in is remembered — docs/05's "Reconnect after weeks
  offline," implemented as "just try the refresh cookie silently"; no
  banner UI was built for the failure case (not asked for, see docs/43's
  own known-gaps note on this).

## One interpretation call D14 leaves open

docs/05 D14 says decline should offer "an explicit choice (e.g. discard,
or keep as a separate unsynced set)" — genuinely two further sub-options,
not fully specified. This pass mirrors docs/25 D126's own already-built
merge-prompt pattern exactly instead (two flat buttons: merge, or
"keep this device separate"): declining does nothing at all — no
adoptAccountId call, no auth-account marker saved, no sync connect. Local
data and identity are left completely untouched; the device just isn't
signed in. This satisfies "never silently merged or discarded" without
building the deeper discard-vs-keep-separate sub-flow docs/05 gestured at
but didn't design. Flagged, not silently decided, same as docs/41's own
two interpretation calls.

## Two real bugs found and fixed

1. **React StrictMode double-consumed the single-use magic-link token.**
   Dev-mode StrictMode double-invokes effects (mount → cleanup → mount);
   `AuthVerifyScreen`'s verify-on-mount effect had no run-once guard, so
   the second invocation's `verifyMagicLink` call always hit "already
   consumed" (docs/41's own single-use enforcement working exactly as
   designed) — and that error state landed *after* the first call's real
   success/merge-prompt state, silently clobbering it. Same bug class as
   docs/25 D136 (StrictMode's double-invoke breaking an effect that
   assumed single-invocation), different fix: a `useRef` run-once guard
   rather than D136's per-mount-DOM-node approach, since there's no
   shared external resource here, just a non-idempotent network call.
   Reproduced directly against the live dev server + real Postgres (the
   token's `consumed_at` was already set from the *first*, successful
   call — confirmed by querying `magic_links` directly — while the page
   displayed "Invalid or expired link" from the second).
2. **The merge-prompt's account/transaction counts could read zero when
   real local data existed.** `StoreProvider` flips `ready` (and mounts
   its children, including this screen) immediately after *registering*
   its `db.watch()` calls, not after their first result actually lands —
   a pre-existing timing gap that every other screen tolerates fine
   (they just re-render a moment later when the watch callback fires).
   This screen makes an irreversible one-shot decision at mount time
   based on those counts, so the gap isn't invisible here: it can skip
   D14's prompt entirely on a device that genuinely has data to lose.
   Fixed by querying SQLite directly (`db.getAll('SELECT COUNT(*)...')`,
   awaited) instead of trusting `store.accounts.length`/
   `store.transactions.length`'s current snapshot. Reproduced directly:
   the merge prompt initially read "0 accounts and 0 transactions" against
   a device seeded with 5 of each, confirmed via the same fresh-browser-
   profile Playwright run before and after the fix.

## Verified

A real end-to-end Playwright run against the live `app/` dev server (:3001)
and `api/` dev server (:3002) against real Postgres, not just `tsc`/
`oxlint`:

- Settings' Account section renders, request-link succeeds, UI switches
  to "Check your email."
- `/auth/verify` with no token shows the error state, "Back to Settings"
  navigates correctly. Zero console/page errors throughout.
- Full second-device-with-existing-local-data flow: a pre-seeded browser
  profile (5 accounts, 5 transactions from `seedIfEmpty()`) signs in as
  an email already tied to a *different* account id → merge prompt shows
  the real counts → "Merge into my account" → local `user_id` is rewritten
  to the account id (confirmed via `localStorage`) → Settings shows
  "Signed in as \<email\>."

`tsc -b` clean on `app`, `tsc --noEmit` clean on `api` (unrelated,
re-checked anyway).

## Not in scope, still open

- **Real Azure Communication Services sending** — unchanged from docs/41,
  still stubbed (logs the link).
- **A "sign in to sync" banner** for a failed silent reconnect — docs/05
  describes one; not built. `useSyncStatus()` (docs/43) exists and
  Settings surfaces it, but nothing proactively surfaces a failure
  outside of visiting Settings.
- **Sign-out** — not asked for, not designed in docs/05 beyond D16
  ("device list/revoke UI deferred past v1"). The auth-account marker has
  no clear-it-and-disconnect action anywhere yet.
- **The subscription gate** (docs/06) — still nowhere in this flow,
  matching docs/41's own note.

**2026-08-22.**

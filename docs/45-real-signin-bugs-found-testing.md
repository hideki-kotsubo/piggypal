# 45 — Four Real Bugs Found Testing a Real Sign-In, End to End

## What this closes

Nothing planned — this is the direct result of actually testing docs/42's
sign-in flow and docs/43's sync upload against a **real** Resend send and
real seeded local data, instead of only synthetic test fixtures. Bugs 1-3
were invisible to docs/41's 21/21 script and docs/43's own 11/11 script,
because both used hand-crafted UUIDs and never exercised this app's
actual seed data or a real email provider's infrastructure. Bug 4 only
surfaced after deploying and testing against the real, already-running
production app, which had pre-existing local data of its own.

## Bug 1: click-tracking auto-consumed the single-use magic-link token

**Found**: the user requested a real magic link via Resend
(`onboarding@resend.dev`) and received it wrapped in an
`r.us-east-1.awstrack.me` click-tracking redirect (Resend sends through
Amazon SES under the hood; click tracking rewrites every link). Querying
`magic_links` directly showed `consumed_at` set ~26 seconds after send —
before the user could plausibly have clicked anything.

**Root cause**: `AuthVerifyScreen` called `verifyMagicLink` from a
`useEffect` that fired the instant the page loaded — so *anything* that
visits the URL first (a click-tracking wrapper, a mail-security link
scanner running headless Chrome) burns the one-time token before a human
ever sees it. Not specific to Resend or this app — a well-known failure
mode for any single-use link behind click tracking or automated
prescanning.

**Fix**: `AuthVerifyScreen.tsx` no longer calls `verifyMagicLink` on
mount. The token now sits in a `{ kind: 'confirm' }` step with a real
"Sign in" button; the network call only happens from that button's click
handler. Automated visitors load the page (or don't even execute its JS)
but essentially never synthesize a genuine click event on a rendered
button, so this defends against the whole class of problem regardless of
which provider or scanner triggers it. The `verifiedRef` double-click
guard from docs/42 stays, now guarding the click handler instead of the
effect. A side benefit: the exhaustive-deps oxlint warning docs/42 flagged
is gone too, since the async call moved out of a `useEffect` entirely.

## Bug 2 & 3: `categories.id`/`category_keywords.id` typed `uuid`, but seed data isn't

**Found**: signing in and connecting for real (`connectSync()`) triggers
PowerSync to immediately flush the local device's queued writes —
including `seedIfEmpty()`'s initial seed data, queued the moment the app
first launched, regardless of sign-in state. That upload hit
`/api/sync/upload` and failed: `invalid input syntax for type uuid:
"cat-food"`.

**Root cause**: `db/schema.sql` (following docs/03's original design)
types `categories.id` and `category_keywords.id` as `uuid`. But
`seed.ts` deliberately gives every seed category a fixed, human-readable
slug id (`"cat-food"`, `"cat-food-groceries"`, ...) and every seed keyword
an id like `"ckw-1"` — not random UUIDs. This is intentional (docs/24's
household-merge design: seed categories share deterministic ids across
every install specifically so two independently-seeded devices dedupe by
id on merge, "the merge algorithm exploits that seed categories already
use fixed slug IDs"). Accounts/transactions/budgets all use real
`crypto.randomUUID()` and were never affected — categories and their
keywords are the one deliberate exception, and the Postgres schema never
accounted for it. This means **every real device's very first sync
upload would have failed** on its seeded categories, before this fix.

**Fix**: `db/schema.sql` — `categories.id`, `categories.parent_id`,
`transactions.category_id`, `budgets.category_id`,
`category_keywords.id`, `category_keywords.category_id` all changed from
`uuid` to `text` (`category_keywords.id` also drops its now-pointless
`default gen_random_uuid()` — D5's client-generated-id convention means
nothing ever needs the server to mint one). Applied directly to this
sandbox's local Postgres via `ALTER TABLE` (all five affected tables were
empty — zero data-loss risk locally).

**A third, related bug found immediately after fixing the above**:
`categories.sort_order int not null default 0` — but nothing in `app/`
ever populates `sort_order` (categories don't support manual reordering,
docs/12/13's same "no manual reordering" pattern), so it's SQLite-NULL on
every real local row. Explicitly writing `NULL` for a column always
overrides its Postgres `DEFAULT`, unlike omitting the column — so every
seed category's upload failed with `null value in column "sort_order"
violates not-null constraint`. Fixed in `api/src/sync/routes.ts`'s
`coerce()`: a small `COLUMN_DEFAULTS` map substitutes the column's own
intended default (`0`) only when the value is null/undefined, rather than
omitting null columns generally — omitting generally would have broken
PUT's full-row-replace semantics for every genuinely nullable column
(clearing `institution`/`merchant`/`note` client-side would silently fail
to clear them server-side).

## Bug 4 (found after deploy, against production): "Reset local data" didn't clear PowerSync's own upload queue

**Found**: after this whole pass shipped, the user's real `app-beta`
browser hit `invalid input syntax for type uuid: "acc-visa"` against
production — a *pre-migration* account id, from before `accounts.id`
switched from fixed slugs to `crypto.randomUUID()` (a much older commit,
unrelated to today's work — that device's local data simply predated the
switch and had never been re-seeded since). Tapping Settings' "Reset
local data" and signing in again did **not** fix it — the exact same
error recurred.

**Root cause**: `resetLocalData()` ran a hand-rolled
`DELETE FROM <table>` loop against the app's own visible tables only.
PowerSync tracks every write to a synced table in its own internal
pending-upload queue/oplog, separate from those tables — the DELETEs
never touched that queue. The original failed upload (containing the
stale `"acc-visa"` op) stayed queued forever, surviving every reset,
permanently blocking every subsequent upload attempt behind it, since
the SDK always retries the oldest pending operation first — a poison-pill
queue that no amount of app-table resetting could ever clear.

**Fix**: `store.tsx`'s `resetLocalData()` now calls PowerSync's own
`db.disconnectAndClear()` — the SDK's documented "use this when logging
out" API — instead of the manual DELETE loop. It clears the app's tables
*and* the pending-upload queue together in one call, and disconnects the
sync stream too. Verified the common (not-signed-in, local-only mode)
reset path still works cleanly via Playwright — reload, reseed, zero
console errors. The exact poisoned-queue scenario itself wasn't
re-reproduced from scratch (current code can no longer generate a
non-UUID account id to poison a queue with — that was only possible under
the old, since-changed seed scheme), but `disconnectAndClear()`'s
documented contract directly addresses the mechanism found: tables and
queue cleared together, not tables alone.

Same commit also fixed a smaller, related gap found along the way:
`resetLocalData()` cleared `peers.ts`'s paired-device list but left
`auth.ts`'s "signed in as ___" localStorage marker behind, so a freshly
reset device still looked signed in and auto-attempted a reconnect
against a refresh cookie the reset can't touch (server-side, httpOnly) —
a confusing 401 for what's actually a correct "fresh device" state, and
one with no visible way back to the sign-in form in Settings (the signed-
in view has no "sign out"/email-entry escape hatch). Fixed by clearing
that marker too (`clearAuthAccount()`, mirroring `peers.ts`'s own
`clearPairedPeers()`).

## Verified

A real, repeated end-to-end run (not a mocked/synthetic one) against the
live dev servers and real local Postgres: Settings → request real magic
link → receive it → confirm page load alone does NOT consume the token →
tap "Sign in" → `verify` succeeds → `connectSync()` fires →
`sync/upload` correctly lands **all** of a fresh device's real seed data
in Postgres — 44 categories, 5 accounts, 29 category_keywords, 5
transactions, 2 budgets, confirmed by direct `SELECT count(*)` against
each table. `tsc --noEmit` clean on `api`, `tsc -b`/`oxlint` clean on
`app`.

## Not in scope, still open — real and urgent

**This schema migration has NOT been applied to the real production
Postgres behind `api-beta`/PowerSync Service.** This sandbox has no
access to that host (the same standing constraint docs/39 already notes).
Until someone runs the equivalent `ALTER TABLE` statements there (see
`db/schema.sql`'s new column types for the exact target state — the
production tables are believed empty, same zero-data-loss situation as
here, since no real device has ever synced before docs/43 existed today),
**any real device's first sync will fail on its seeded categories**,
exactly as it did here before the fix. This is the single most important
followup from this whole session — tracked in `docs/00-backlog.md`.

**2026-08-22.**

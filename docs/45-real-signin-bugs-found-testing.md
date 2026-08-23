# 45 — Seven Real Problems Found Testing a Real Sign-In, End to End

## What this closes

Nothing planned — this is the direct result of actually testing docs/42's
sign-in flow and docs/43's sync upload against a **real** Resend send and
real seeded local data, instead of only synthetic test fixtures. Bugs 1-3
were invisible to docs/41's 21/21 script and docs/43's own 11/11 script,
because both used hand-crafted UUIDs and never exercised this app's
actual seed data or a real email provider's infrastructure. Bugs 4 and 5
only surfaced after deploying and testing against the real, already-
running production app — bug 5 specifically only surfaced from a second
real device and a real person reacting to the actual UI, not something
any script could have caught. Problem 6 was the direct next thing a real
merge hit, immediately after problem 5 was fixed.

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

## Problem 5: D14's "keep this device separate" option was actually a design flaw, not just under-specified

**Found**: real second-device testing — a genuinely fresh browser, which
auto-seeds demo data before ever reaching Settings (`seedIfEmpty()`),
signed in with an email already tied to an existing account. That's
exactly D14's merge-prompt case, and it correctly showed: "This device
already has 5 accounts and 5 transactions. Merge them into your account,
or keep this device separate?" The user's own reaction, verbatim: *"I
don't want to keep this device separate... there is no reason to offer a
'separate device.' It is the same email account, so it must necessarily
merge."*

**Why this was a real flaw, not a preference**: docs/42 had already
flagged the original "keep this device separate" button as an
interpretation call (docs/05 D14 only said decline should offer *some*
explicit choice, not fully specified which). But the flaw runs deeper
than under-specification — "keep separate" is *incoherent* once someone
has typed an existing account's email and tapped its magic link. That
action already asserts "this is me." There's no real device left that
"stays separate" after that; anyone who actually wants two distinct
accounts would simply use two different emails. Offering a button whose
effect is "pretend you didn't just prove who you are" is a genuine flow
error, not a missing nice-to-have.

**Also surfaced by the same testing**: even before the wording problem,
merge-vs-separate wasn't a complete pair of options anyway. The
*common* real case — a never-touched fresh device — has nothing worth
merging (just `seedIfEmpty()`'s own demo placeholders), but the old
"keep separate" path meant never actually signing in for real either.
Neither original option fit that case correctly.

**Fix**: `store.tsx` gained `discardAndAdoptAccountId(newId)` — wipes
local data via `db.disconnectAndClear()` (clearing PowerSync's pending-
upload queue too, so none of the discarded demo rows ever get uploaded)
and adopts the account id outright, no row-rewrite needed since nothing's
left to rewrite. `AuthVerifyScreen`'s merge-prompt now offers exactly two
options — "Merge into my account" or "Discard this device's data & sign
in" — and the `'declined'` step/"keep separate" button are gone
entirely, not just relabeled. docs/05 D14 revised in place to record
both the original design and why it changed.

## Problem 6: real "Merge into my account" hit budgets' unique-constraint collision

**Found**: with problem 5 fixed, the user actually completed a real merge
— "Merge into my account" on a second device signed in to their existing
account — and immediately hit `duplicate key value violates unique
constraint "budgets_user_id_category_id_month_currency_key"` on
`/api/sync/upload`.

**Root cause**: docs/43 had already flagged this exact gap as a "narrow
edge case, not fixed" — but it wasn't narrow, it was the very next thing
a real merge would hit. `seed.ts` deliberately gives every install's
seeded budgets a random `id` (docs/24 D113, specifically so two devices'
budgets for the same `(category, month, currency)` collide on that
natural key instead of silently overwriting by id) — meaning **any** two
devices signing into the same account, each with their own untouched
seed data, have colliding budgets by construction. `sync/upload`'s `PUT`
handling only ever targeted the `id` primary key's `ON CONFLICT` (Postgres
allows one arbiter per `INSERT`), so the second device's budget upload
hit the table's *separate* unique constraint and threw, uncaught.

**Fix**: `budgets`' `PUT` handling now checks for an existing row by
`(user_id, category_id, month, currency)` first. Existing row with a
different id → resolve per docs/02's stated policy (higher amount wins,
matching the exact rule `store.tsx`'s P2P merge — `applyPeerDataset` —
already implemented locally) and skip inserting the second id entirely.
No collision → falls through to the ordinary id-based upsert. Verified
against the actual failure shape: two separate browser profiles, same
email, each independently seeding a budget for `cat-food-groceries`
(both $600.00, so a real tie) — after both sync, exactly 2 budget rows
exist (one per category), not 4 and not a crash.

`category_keywords` has a matching unique constraint
(`(user_id, category_id, keyword)`) but doesn't need the same fix — its
seed ids (`ckw-<n>`) are deterministic, not random like budgets, so two
devices' seeded keywords always share the same `id` and dedupe through
the ordinary path before the separate constraint could ever be reached.

## Problem 7: discardAndAdoptAccountId (problem 5's own fix) could have reseeded fake data into a real account

**Found**: the user tapped "Discard this device's data & sign in"
(problem 5's fix) and reported "all data on the second device was lost."

**Investigation**: that report is actually *correct*, expected behavior
— discard means discard, and there's nowhere for real data to come from
yet (no working PowerSync download-sync, see docs/43's own open items),
so empty is the right state. But investigating it surfaced a real latent
bug in the same fix: `discardAndAdoptAccountId` wipes local data and
adopts the account id with no reload, and `seedIfEmpty()` — the function
that seeds demo placeholders (fake Visa/Uber/etc.) on any empty local
database — had no way to know the difference between "a genuinely fresh,
never-signed-in device" (where demo data is exactly right) and "a device
that just discarded its data and adopted a real account" (where it very
much isn't). Any *subsequent* page reload on that device — closing and
reopening the tab, a browser restart, anything — would have silently
injected fresh fake demo transactions straight into the user's real
signed-in account.

**Fix**: `seedIfEmpty()` now checks `auth.ts`'s `getAuthAccount()` first
and skips seeding entirely if the device is signed in — demo data is
only ever appropriate for a device with no account at all. Verified
directly: discard → confirmed empty (correct) → explicit page reload →
still correctly empty, not re-seeded with demo placeholders.

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

**Confirmed working against the real production stack, 2026-08-22**:
after deploying this branch's commits to `api-beta` and applying the
schema migration to production Postgres (`db/migrations/2026-08-22-
categories-id-text.sql`), the user did a final real sign-in on the
deployed `app-beta` and confirmed sync succeeds end to end — not just in
this sandbox's local reproduction. All four bugs above are resolved in
the real deployed environment, not only verified locally.

**2026-08-22.**

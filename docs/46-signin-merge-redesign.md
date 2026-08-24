# 46 — Sign-In Account Merge, Redesigned

## What this closes

A real production report: a second device signed into an already-synced
account, tapped "Merge into my account," and its accounts/categories
permanently vanished locally, not a transient flicker. Investigating it
(chat discussion, 2026-08-23, not committed as code) surfaced three
independent structural gaps in `docs/41-45`'s sign-in/sync design, not one
bug — and a fourth, separate gap found along the way: the sign-in path has
never had the own-device-vs-someone-else distinction `docs/25` D125-127
already validated for P2P pairing, so any second sign-in today
unconditionally unifies identity, which is actively wrong once two
different real household members share one login.

This doc is the redesign those four gaps point to. **Design only — nothing
below is implemented yet.** No test runner exists in this repo (same
standing note as `docs/41`/`docs/43`), and the schema change in D162 is a
real migration against production data that needs to be applied by the
user directly, the same standing constraint `docs/39`/`docs/45` already
flag for this sandbox.

## Why the current design can lose data (recap)

1. `categories.id text primary key` has no `user_id` in the key — the
   fixed-slug dedup (`docs/24`, "cat-food" shared across every install) is
   only meant to work *within one person's own devices*, but the schema
   makes it a global constraint across every unrelated account on the
   deployment.
2. `api/src/sync/routes.ts`'s `ON CONFLICT (id) DO UPDATE ... WHERE
   table.user_id = $2` silently no-ops when the WHERE fails, but still
   returns `200`. PowerSync's client can't distinguish "applied" from
   "silently skipped," so it clears the op from its pending queue either
   way — the only remaining truth becomes whatever the next download says.
3. `AuthVerifyScreen.tsx`'s `mergeAndFinish` → `store.adoptAccountId`
   rewrites local ownership and starts uploading *before* this device has
   ever seen the server's actual state for this account — upload and
   download are two unsynchronized processes with a structural race
   between them, not a reconciled step.
4. `adoptAccountId` always calls `rewriteOwnerIdentity`, unconditionally
   unifying this device's local identity with the signed-in account's —
   correct for "my own second device," wrong for "a different household
   member signing into our shared login," where it would silently
   relabel that person's own accounts/transactions as someone else's.

## D162 — Categories become genuinely per-user at the schema level

`categories` and `category_keywords` move from a bare `id text primary
key` to a composite `primary key (user_id, id)`; `transactions.category_id`,
`budgets.category_id`, and `category_keywords.category_id` become
composite foreign keys `(user_id, category_id) references
categories(user_id, id)`.

Effect: two unrelated accounts both seeding `"cat-food"` can never
collide — they're different rows by construction, and the `ON CONFLICT ...
WHERE user_id = $2` guard in `sync/routes.ts` becomes unreachable dead code
for categories specifically (safe to delete once this lands) rather than a
runtime safety net. The same-user, two-own-devices dedup-by-id behavior
`docs/24`'s merge design actually wants is unaffected — both devices'
`"cat-food"` upserts still target the same `(user_id, id)` row.

Accounts/transactions/budgets already use `crypto.randomUUID()` — no
schema change needed there; cross-user collision probability is
negligible. **Not applied anywhere yet** — needs the same care as
`docs/45`'s `categories.id` type migration: verify current row counts on
real production Postgres first, apply directly (this sandbox cannot reach
production, same note as `docs/39`).

## D163 — Upload endpoint reports per-op outcome, never a silent no-op

`/api/sync/upload`'s response changes from a bare `{ ok: true }` to
`{ applied: string[], skipped: { table, id, reason }[] }`. The connector
(`app/src/lib/connector.ts`) treats any `skipped` entry as a hard stop —
surfaced in Settings' sync status, the corresponding CRUD op **not**
marked complete client-side — rather than the current "any 200 means
everything landed" assumption. With D162 in place this should never
actually fire for categories in practice; kept as defense-in-depth for the
remaining tables' astronomically-unlikely UUID collision case, and as a
general principle: this endpoint should never again be able to say
"success" about a write it didn't make.

## D164 — Merge is download-first, diff-second, write-third

Replaces `finish()` → fire-and-forget `connectSync()` with an explicit
sequence, closing the race in gap 3 above:

1. Connect and wait for the first full download to complete
   (`db.waitForFirstSync()` or equivalent) **before** touching any local
   row. At this point the device holds the server's true state for this
   account alongside its own pre-existing local rows, unmerged.
2. Compute a merge plan client-side by diffing local-only rows against
   that now-known server state (D167/D168 below) — not just the bare
   counts today's merge-prompt shows.
3. Show the plan, get confirmation (D169).
4. Only then: identity rewrite + upload, and don't consider the merge
   done until the upload queue has actually drained (poll queue
   length/`currentStatus`), not just until the triggering call returns.

## D165 — Own device vs. household member fork, added to sign-in

Mirrors `docs/25` D125-127 exactly, on the one flow that's never had it:
when `AuthVerifyScreen` detects existing local data on a second sign-in,
**before** any merge planning, ask: "Is this your own device, or is
someone else in your household signing in?"

- **My own device** → D164's full sequence, ending in full identity
  unification (today's only path) plus D167/D168's matching cascade,
  since duplicates here are the expected case (same person, used this
  device standalone before signing in).
- **Someone else** → identity stays distinct. This device's
  `getLocalUserId()` becomes a new household-member identity under the
  shared account — never unified, and (D168) never name-matched against
  the existing account's accounts. This is the actual fix for two
  household members independently creating an identically-named account
  (a "RBC Bank — Mastercard — Credit" each): different owners means
  they're never even compared for merging, not "compared but hopefully
  not conflated."

This is a real scope addition, flagged plainly: the paid/signed-in tier
has never had a household-member concept before (only the free P2P tier
does, via `peers.ts`, entirely local). This doc only adds the minimum
needed to make D165's fork answerable and rememberable (D166) — not the
full `households`/`household_members` server-side design `docs/24`
speced. That remains unbuilt, tracked separately in `docs/00-backlog.md`.

## D166 — Household-member recognition is remembered per device

Once a device answers "someone else" and completes sign-in, that answer
is remembered locally (mirrors `docs/25` D138-139's "known peer skips the
question" — same UX precedent, already shipped and validated for P2P).
Future sign-ins from that device skip straight to sign-in, no repeat
prompt.

## D167 — Category merge cascade

Categories have no owner (`schema.ts` has no `owner_user_id` on
`categories`) — shared across the whole household account, not
per-person. An ordered cascade, falling through to manual review (D169)
only when nothing above confidently applies:

1. **Exact name match** (case/accent-insensitive — bilingual pt-BR/en,
   "Café" and "cafe" must count as exact), different id → auto-merge:
   local device adopts the server's id, rewrites every local reference
   (`transactions.category_id`, `budgets.category_id`,
   `category_keywords.category_id`, and any **child category's
   `parent_id`** if the renamed row is itself a parent) in one atomic
   transaction before uploading anything.
2. **Same id, different names** → two logically distinct categories that
   happen to collide on id (same-user collision, not the cross-user case
   D162 fixes). Auto-resolve: local device generates a fresh id, rewrites
   every local reference (same cascade as above, including child
   `parent_id`), uploads as a genuinely new category. Neither name is
   silently clobbered by the other.
3. **Fuzzy match** (singular/plural, abbreviation, misspelling) **+ same
   `parent_id`** → auto-merge, adopt server's id. Same fuzzy match but
   **different parent** → do not merge, kept as distinct categories (a
   "Gas" under Transportation and a "Gas" under Utilities are probably
   genuinely different things).
4. **Anything else** → manual review (D169).

Fuzzy-match permissiveness, confirmed 2026-08-23: normalize (lowercase,
strip accents, trim) → singular/plural stemming (pt-BR + en) + a small
built-in abbreviation table + edit-distance-1 typo tolerance. "Grocery" /
"Groceries" merges; "Cofee" / "Coffee" merges; "Restaurant" /
"Restaurants & Bars" does not auto-merge — falls to manual. Confirmed as
the right permissiveness level; exact stemming table/abbreviation list is
an implementation detail to tune during the build, not specified further
here.

## D168 — Account merge cascade, gated by owner first

Same cascade as D167 (exact → same-id-different-fields → fuzzy → manual),
but with a hard precondition: **the cascade only ever runs between
accounts already known to share the same owner** — either literally the
same `owner_user_id`, or the D165 "own device" branch about to unify
identity. It never runs across different household members' accounts,
regardless of name similarity. This is the structural fix for the
RBC/Mastercard case in "What this closes" above — different owners means
the matching logic never gets the chance to conflate them.

Within one owner's accounts: exact `{institution, name, kind}` match →
merge; same id, different fields → new id + reference rewrite (same
pattern as D167.2, rewriting `transactions.account_id`) + upload; fuzzy
institution/name match → merge; otherwise manual.

## D169 — Manual review shows context, never silently auto-resolves further

Confirmed 2026-08-23: manual means manual — no auto-resolution beyond
D167/D168's cascade, but every manual row shows both versions side by
side with enough context to decide: local value, server value, which
device/when each was last touched, and how much history references each
(transaction count, total). Requires D170.

## D170 — Local `updated_at` added

The local SQLite schema (`schema.ts`) has never tracked `updated_at` —
`docs/43` already flagged this as the reason "last-write-wins" is
actually only "last upload wins" today. D169's recency display needs a
real local timestamp to show "which is more recent," so this is added now
as part of this work rather than deferred again — closes that `docs/43`
gap as a side effect, not just a new column for this feature alone.

## Not in scope, still open

- The full `households`/`household_members` server-side design `docs/24`
  speced — D165/D166 add only the minimum device-level recognition needed
  for the fork, not the full table/sync-rule design. Tracked separately.
- Exact fuzzy-match implementation (stemming table, abbreviation list,
  edit-distance library choice) — permissiveness level confirmed (D167),
  specific implementation is a build-time detail.
- Applying D162's migration to real production Postgres — this sandbox
  cannot reach it (same standing note as `docs/39`/`docs/45`); needs to be
  run by the user directly, after verifying current prod row counts.
- Implementation and end-to-end verification of all of the above — this
  doc is the design; next step is building it, pending review.

**2026-08-23.**

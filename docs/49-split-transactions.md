# 49 — Split Transactions (Multi-Account Purchases)

**Superseded (docs/50)**: this design (`transactions.split_group_id`,
advisory sibling rows) let a split purchase's shared fields — category,
date, note, location — diverge per leg, since editing one leg never
touched the others. Confirmed as a real bug against real data, not just in
theory: this doc's own verification pass left two real rows in production
Postgres that ended up disagreeing on `category_id`/`note`. Replaced by
docs/50's parent + `transaction_splits` shape, where those fields exist
exactly once. Kept below for historical context.

## The ask

Scoping a future bulk historical import (a prior budgeting app's export),
a real sample showed purchases paid across **multiple wallets** in one
record — e.g. a $24.27 medicine purchase split $4.85 on a card + $19.42
from an insurer. `transactions` has exactly one `account_id` per row, so
this couldn't be represented before this doc.

CLAUDE.md's v1 scope explicitly deferred **"transfers-as-linked-pairs"**
under "resist expansion." Brought into v1 deliberately here (flagged, not
silent) because a transfer between two of the user's own accounts is the
same shape as a split purchase — one logical event as multiple linked rows,
mirrored signs instead of a shared category. One mechanism serves both;
CLAUDE.md's deferred list is updated accordingly.

This doc covers only the mechanism and its own display — not the bulk
import wizard that motivated it (separate, later work) and not a manual
"split this purchase" entry flow (not asked for; the near-term producer of
split rows is that later import work).

## D180 — `split_group_id`, a flat column, not a join table

`transactions.split_group_id uuid`, nullable, no FK — same
"grouping/display only" convention already used for `institution`/
`merchant`. Sibling rows, not parent/child: this schema has no join tables
anywhere else, and a parent/child model would force `account_id`/
`category_id` nullable on a parent row plus introduce a cross-row
sync-ordering hazard — exactly the bug class `docs/46`'s merge redesign
already fought to eliminate — that a flat nullable column on an otherwise-
ordinary row does not. Deliberately advisory, not an enforced invariant:
any leg can be edited or deleted independently of its siblings, which
matters offline (two devices editing different legs while apart must never
deadlock on a cross-row constraint).

`db/schema.sql`, `db/migrations/2026-08-30-transactions-split-group-id.sql`,
`app/src/lib/schema.ts` (+ `by_split_group` index), `app/src/lib/types.ts`,
and `api/src/sync/routes.ts`'s `TABLE_COLUMNS.transactions` all updated
together — no new write path, this rides the existing one write path
(`docs/43`) unchanged.

Verified safe without any changes needed: `balancesFor` (`store.tsx`) and
`BudgetBars` both pure-sum `amount_cents` grouped by account/category —
split rows compose correctly by construction. `applyPeerDataset`'s P2P
merge matches by `id` only, unaffected too.

## D181 — Duplicate-detector fix

`duplicateTransactions.ts`'s bucket key (`category|day|amount|currency`)
deliberately excludes `account_id` so cross-account duplicates get caught
— which means an even split (e.g. $50/$50 across two accounts, same
category/day) lands in exactly that bucket and would have false-positived
as a "possible duplicate." Fixed: a bucket where every member shares one
non-null `split_group_id` is skipped entirely, never proposed. A bucket
mixing a real split group with an unrelated same-signature transaction is
still flagged as before (all members shown together) — narrower fix scoped
to the one real scenario found, not a general N-way partition.

## D182 — Grouped display

`TransactionList`/`RecentList` cluster consecutive same-`split_group_id`
rows via a new `clusterSplits()` (`lib/splitGroups.ts`) before day-grouping
— legs stay flat siblings of every other row inside `.day-card` (no
wrapper `<div>`), preceded by a small header row (`Split · N` badge +
combined total via the already-generic `totalsByCurrency`), so
`.tx-row:last-child`'s existing border-removal keeps working unmodified.
`RecentList`'s `PREVIEW_COUNT` cutoff now caps by cluster, not raw
transaction, so a split's legs can never land on opposite sides of the
preview boundary — same class of fix `docs/35` already made for day
subtotals. `TransactionScreen` (one leg's detail view) shows a small note
linking to its siblings with the group's combined total when
`split_group_id` is set.

## Not in scope, still open

- The bulk import wizard that motivated this — separate, later plan.
- A manual "split this purchase" entry/edit UI — nothing today lets a user
  create a `split_group_id` group by hand; the mechanism and its display
  are ready for whatever writes one (import, and eventually transfer
  entry), but nothing in this app does yet.
- Real transfer-pair creation (matching two source records as a transfer)
  — this doc only makes the schema/display capable of representing one;
  detecting/proposing transfer pairs is import-wizard-scoped work.

**Implemented 2026-08-30.** Verified: `tsc -b` clean on both `app` and
`api` workspaces; `npm run test -w app` — 65/65 passing, including new
`splitGroups.test.ts` and the three new `duplicateTransactions.test.ts`
cases for D181. Not verified: the migration SQL against a real Postgres —
no `psql`/Postgres install exists in this sandbox (same standing
constraint `docs/39`/`docs/45`/`docs/46` already note); the statements are
plain `alter table ... add column`/`create index`, matching every prior
migration's style. Manual browser verification of D182's grouped display:
pending.

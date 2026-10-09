# 57 — Scheduled Payments (recurring + installments)

**Status: approved and implemented 2026-10-08** (branch
`feat/scheduled-payments`). See "Implementation notes" and "Verified"
at the end for where the build differs from the original proposal.

## The ask

Track future, known-in-advance payments: rent, school tuition, mortgage,
car leasing, subscriptions, and installment purchases (parcelado — "10x
de R$ 150" on a card). The user wants to see what's coming, have it
counted against budgets before it happens, and log it with one tap (or
automatically) when it's due.

**Scope flag**: "recurring transactions" is on docs/01's and CLAUDE.md's
explicitly-deferred list (and docs/00-backlog "Later"). Adopting this doc
means pulling it into scope deliberately — D205 below records that, it
isn't a silent expansion.

## Constraints that shape the design

1. **One write path (locked #3, D6).** Nothing server-side ever creates
   transactions. A server cron that "posts rent on the 1st" is ruled out
   — it would also never work for the free tier, which never contacts the
   server (locked #5).
2. **Multiple writers.** Several devices per user (PowerSync), P2P peer
   merge (docs/25), and eventually household members (docs/24) can all be
   online — or offline — when an occurrence comes due. Two of them must
   never both create "Rent — October".
3. **A `transactions` row means money moved.** Budgets, balances
   (`balances.ts`), search/filter (docs/18), day subtotals (docs/35), CSV
   export (docs/08) and the duplicate detector (`duplicateTransactions.ts`)
   all assume this. Putting not-yet-happened rows into `transactions`
   would require every one of those to learn a new filter, and missing
   one silently corrupts totals.

## Options considered

| | Approach | Verdict |
|---|---|---|
| A | Pre-materialize future occurrences as `transactions` rows with `status = 'scheduled'` | Rejected. Fine for a finite installment plan, but open-ended rules (rent) need a rolling horizon that someone must keep topping up — the same generation problem, just deferred. And it breaks constraint 3: every existing query needs `WHERE status = 'posted'`. |
| B | Server cron materializes due occurrences | Rejected. Violates locked #3 / D6 and excludes the free tier. |
| C | Rule table + read-time projection + deterministic-id materialization on posting | **Chosen** — D206. |

## D205 — Scheduled payments come into scope

Recurring transactions move from "explicitly deferred" to in-scope as
this feature. Installments are the same mechanism with a finite count,
not a separate feature. Still out: bank-feed matching ("did the real
debit happen?"), push notifications (see D214), business-day calendars.

## D206 — Rules are stored; occurrences are projected, not stored

A new synced table holds the *rule*. Upcoming occurrences are computed on
the device by a pure function — `projectOccurrences(rule, from, to)` —
at read time, and are never written anywhere. A real `transactions` row
exists only once an occurrence is **posted** (confirmed or auto-posted).
Every existing query over `transactions` stays correct without changes.

## D207 — Schema: `scheduled_payments`

```sql
create table scheduled_payments (
  id                uuid primary key,          -- crypto.randomUUID()
  user_id           uuid not null,
  name              text not null,             -- "Rent", "Civic lease", "TV 10x"
  account_id        uuid references accounts(id),
  category_id       text,                      -- text, see categories.id
  amount_cents      bigint not null,           -- signed, same convention as
                                               -- transactions (negative = expense);
                                               -- per-occurrence amount, or the
                                               -- TOTAL for installments (D211)
  amount_mode       text not null default 'fixed',  -- fixed | estimated
  currency          char(3) not null,
  merchant          text,
  note              text,
  paid_by_user_id   uuid not null,
  -- recurrence
  freq              text not null,             -- weekly | monthly | yearly
  interval_count    int  not null default 1,   -- every N freq units
                                               -- (not `interval`: a Postgres type keyword)
  anchor_date       date not null,             -- first occurrence (local date)
  occurrence_count  int,                       -- finite plans (installments); null = open-ended
  end_date          date,                      -- alternative end; null = open-ended
  start_index       int not null default 1,    -- installment already partly paid
                                               -- before Flowtab: next one is #start_index
  kind              text not null default 'recurring',  -- recurring | installment
  auto_post         boolean not null default false,
  paused            boolean not null default false,
  archived          boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  foreign key (user_id, category_id) references categories (user_id, id)
);
```

And two nullable columns on `transactions`:

```sql
alter table transactions add column schedule_id     uuid references scheduled_payments(id);
alter table transactions add column occurrence_date date;  -- the projected date this
                                                           -- row fulfils (occurred_at
                                                           -- may differ if paid late)
```

Plumbing that comes with a new synced table (all three are real
requirements, learned the hard way in docs/45 and docs/50):
`TABLE_COLUMNS` in `api/src/sync/routes.ts`, a stream in
`deploy/powersync/sync-config.yaml`, and `app/src/lib/schema.ts`. The two
new `transactions` columns go into the existing `transactions` allowlist
entry. `store.applyPeerDataset` (docs/25) needs to carry rules too.

`occurred_at` stays local wall-clock with no timezone (existing
convention), and occurrence dates are plain local dates — so "the 1st"
means the user's 1st, no UTC drift.

## D208 — Deterministic transaction ids for posted occurrences

A posted occurrence's transaction id is

```
uuidv5(namespace = FLOWTAB_SCHEDULE_NS, name = `${schedule_id}:${occurrence_date}`)
```

Two devices (or a device and a P2P peer) posting the same occurrence
independently produce the **same primary key**, so they collapse into one
row via the existing upsert + last-write-wins — no locking or
coordination needed. This already works with today's code paths:
the upload handler upserts by id, and `applyPeerDataset` already skips a
transaction whose id exists locally. It's still a client-generated UUID
(locked #6), only derived instead of random.

Implementation note: `crypto.randomUUID()` has no v5; either add the
`uuid` package or hand-roll v5 over `crypto.subtle.digest('SHA-1', …)`
(async — fine, posting is already async).

## D209 — Projection rules

- An occurrence is **open** if no `transactions` row with that
  `(schedule_id, occurrence_date)` exists. Existing rows (live *or*
  soft-deleted) suppress it.
- Monthly on day 29–31 clamps to the month's last day (Jan 31 → Feb 28/29
  → Mar 31; the anchor's day is remembered, not the clamped one).
- `paused` rules project nothing; `archived` rules are hidden entirely.
  Already-posted transactions are unaffected by either.
- No business-day shifting in v1 (D205).

## D210 — Editing semantics

| User action | What's written |
|---|---|
| Change **this occurrence only** (amount, date, account) | Post it, then edit the posted transaction — the transaction row *is* the override |
| **Skip** this occurrence | Post it already soft-deleted (`deleted_at` set). Syncs like any delete; suppresses the projection (D209). "Undo" is **Mark paid** (clears `deleted_at`): a skipped occurrence can't return to *open* without a hard delete. |
| Change **timing** (frequency, every-N, start date) on a rule with posted or skipped history | Staged on screen, then applied as a split from a chosen date after the last logged payment: the old rule gets `end_date` = the day before and is archived; a new rule starts there with `start_index` continuing the count. Posted history keeps pointing at the old rule. |
| Change anything else (name, amount, account, category, note, auto-post…), or timing on a rule with no history | Update the rule in place. Applies to every not-yet-posted occurrence, overdue ones included; posted transactions are never rewritten. |
| Delete the rule | `archived = true`. Posted transactions stay (they happened). |

## D211 — Installments

- `kind = 'installment'`, `occurrence_count = N`, `amount_cents` = the
  **total**. Per-installment amount = total / N in integer cents with the
  remainder on the **first** installment (card-issuer convention):
  R$ 1000,00 / 3 → 333,34 + 333,33 + 333,33.
- Posted rows show "3/10" — derived from `occurrence_date`'s position in
  the series plus `start_index`, not stored.
- Card installments post against the card account, one row per month,
  matching how Brazilian card statements bill them. That keeps this
  independent of the still-deferred transfers-as-linked-pairs.
- Interest-bearing plans: the user enters what they actually pay per
  month (total = N × installment). No interest math.

## D212 — Posting: confirm by default, auto-post opt-in

- **Default**: due and overdue occurrences appear in an "Upcoming / Due"
  strip on Home (Inbox-style, docs/20). One tap posts it; with
  `amount_mode = 'estimated'` (utilities, variable tuition) the tap opens
  the transaction screen prefilled so the real amount is typed first.
- **`auto_post = true`** (fixed rent, lease): on app open / foreground,
  any device posts every due occurrence that's still open. Deterministic
  ids (D208) make concurrent auto-posting from several devices safe.
- Posted rows get `source = 'schedule'` (new value alongside
  manual | ai | import).
- Catch-up after a long absence posts each missed occurrence separately,
  on its own `occurrence_date` — never one lump row.

## D213 — Budgets and the Home view

Budget-vs-spent gains a "committed" figure per category: the sum of
**open** projected occurrences in the current month, shown separately
from "spent" (stacked or hatched bar segment), never merged into it.
Same per-currency rule as budgets (docs/10) — no FX rollup.

## D214 — No push notifications in v1

Push needs the server, which free users never contact (locked #5). v1
uses an in-app badge on Home for due/overdue items. A paid-tier push
reminder can be designed later on top of the same projection.

## Open questions

Resolved at approval (2026-10-08), the user taking the proposed defaults:
splits across accounts are out of v1 (#2), overdue occurrences stay due
until posted or skipped (#3), income schedules are allowed (#5), and
household sharing (#1) is deferred to docs/24's build.

1. **Household (docs/24).** A shared rule ("our rent") needs the same
   `household_id` partitioning the other tables are waiting on. Today's
   upload handler guards bare-id tables with `WHERE user_id = …`, so if
   two household *members* post the same occurrence, the second write
   is reported as `skipped` (docs/46 D163) — correct dedupe, but the
   connector currently surfaces skips as problems. Resolve when docs/24
   is actually built.
2. **Split payments (docs/50).** Can a rule pay from 2+ accounts? Proposal:
   not in v1 — a posted occurrence can still be split by editing it
   afterwards, same as any transaction (docs/50 D185's "only split an
   already-existing transaction" rule holds).
3. **Overdue nag window.** How far back does "Due" show unposted,
   non-auto occurrences — forever, or N days then quietly skip?
4. **Twice-monthly / "last business day"** schedules (some payrolls,
   some Brazilian boletos) — out for v1, but `freq` should stay an open
   enum so they can be added without a migration.
5. **Income.** Nothing above is expense-only (signed `amount_cents`), so
   salary could use the same rules. Worth confirming the UI should offer it.

## Build order (as approved)

1. Schema: Postgres DDL, `schema.ts`, sync allowlist, PowerSync stream,
   peer-merge support. Branch first.
2. `projectOccurrences()` + installment amount split + uuidv5 helper,
   pure and unit-tested (clamping, remainder cents, start_index, skips).
3. Rule create/edit screen (including the three edit scopes of D210).
4. Upcoming/Due strip + one-tap / prefilled posting.
5. Auto-post on app open.
6. "Committed" segment on budgets (D213).
7. API redeploy — `docker compose up -d --build api`, not just
   `npm run build` — since the sync allowlist changes.

## D215 — Server: first post wins for posted occurrences

Found while building: `/api/sync/upload`'s generic PUT is a full-row
upsert, so a second device's independent post of the same occurrence
(same D208 id) would overwrite the first — including any edit made to it
in between (e.g. a corrected amount). A `transactions` PUT that carries a
`schedule_id` is therefore insert-only (`ON CONFLICT (id) DO NOTHING`)
and reported as `applied`, not `skipped`: nothing is left to retry and
nothing needs the user's attention, since the losing device converges to
the winning row on its next download. The same rule means a late *skip*
from one device can't delete an occurrence another device already paid.
Ordinary transactions keep the existing last-upload-wins upsert. This is
also why auto-post (D212) doesn't wait for a signed-in device's first
download before running.

## D216 — What a posted occurrence looks like

- `note` is stored, not derived: the rule's note (or its name), plus
  " (3/10)" for installments. It's what every list row, search and CSV
  export already show, and it reads the same on a device without the rule.
- `occurred_at` is a fixed `T12:00:00` on the occurrence date, not "now":
  auto-posting devices agree on it, and a back-dated catch-up post never
  lands near a midnight boundary.
- `source = 'schedule'`, `account_id` from the rule (a rule always has
  one; a null account on a transaction would mean docs/50's split state).

## D217 — Deleting a schedule (added 2026-10-09)

The ask: undo a schedule saved by mistake. "Stop this schedule" (archive)
only ends it — the rule stays listed under Stopped and anything it already
logged (e.g. auto-posted catch-up payments) stays in balances and budgets.

**Delete schedule** is a soft delete: a new `scheduled_payments.deleted_at`
column (migration `2026-10-09-scheduled-payments-deleted-at.sql`), set in
the same atomic write that soft-deletes every still-live transaction the
rule posted. The confirmation spells out what goes with it — "Delete "TV"
and its 2 logged payments? $666.67 will be removed from your
transactions, balances and budgets" — or just "Delete "Oops"?" when
nothing was logged. A deleted rule projects nothing (`isLive`) and is
hidden from every list; opening its URL shows "doesn't exist".

Soft, not hard, even with no history (the first proposal was a hard
delete for that case): a hard-deleted rule would be resurrected by
docs/25's insert-if-missing P2P merge from any paired device that still
has it, while a soft-deleted one is still a row that the merge skips. It
also never trips the `transactions.schedule_id` FK, whatever was posted.
Stop/Restore stays as the "end it but keep what's logged" option.

## Implementation notes

- Pure logic in `app/src/lib/schedules.ts` (projection, month-end
  clamping, installment cents, due/upcoming/committed sets, split start
  index, hand-rolled RFC 9562 uuidv5 over `crypto.subtle`), unit-tested in
  `schedules.test.ts`.
- `store.tsx`: `scheduled_payments` watch, `addScheduledPayment` /
  `updateScheduledPayment` / `splitScheduledPayment` / `postOccurrence`,
  the auto-post effect (re-runs on data changes and when the app returns
  to the foreground, since "today" may have rolled over), and
  `scheduled_payments` added to every reference-rewriting path: owner
  identity rewrite, category/account merge cascades, P2P merge (rules
  inserted before transactions), and the "untouched starter account"
  checks (an account a schedule points at counts as used).
- Screens: `/schedules` (Due, Next 30 days, the rules, Stopped) and
  `/schedules/:id` (`/schedules/new` to create) with Paid/Skip per
  occurrence, and a Location field (`merchant`, docs/15's suggestion chips,
  added 2026-10-08 after first use) copied onto every posted occurrence;
  a Home banner while anything is due (`DueBanner.tsx`);
  a Settings row; a hatched "committed" segment plus "+ $X scheduled" on
  Insights' budget bars.
- Server: `db/migrations/2026-10-08-scheduled-payments.sql`, the upload
  allowlist, boolean/date validation, D215, and a PowerSync stream.

## Verified

- `schedules.test.ts` (20 tests) plus the existing suite: 97/97 pass.
  `tsc`, `oxlint` and `vite build` clean; API `tsc` clean.
- Server, against a throwaway in-process Postgres (PGlite), not the shared
  dev database: the migration applied on top of `main`'s schema, the fresh
  `db/schema.sql` loads, and the compiled API was exercised over HTTP with a
  real signed token — 10/10 checks: a rule + its posted occurrence in one
  batch (FK order), boolean/date coercion, a malformed date skipped per-op
  rather than 500ing, D215's first-post-wins (an edit survives a later
  duplicate post; a late skip doesn't delete a paid occurrence), ordinary
  PUTs still upserting, a split's PATCH + PUT, and clearing a nullable date.
- Screens, in headless Chromium (2026-10-09) against the live :3001 dev
  server in a fresh browser profile — 25/25 checks: create a past-anchored
  rule → 2 due + Home banner → Paid / Skip → a real transaction and a
  "Skipped" history row; a timing change splits the rule; an auto-post
  installment plan logs 1/3 ($333.34) and 2/3 ($333.33) and a reload
  doesn't duplicate them; Location persists; delete with history removes
  the rule and its payments (leaving others untouched), delete without
  history is the simple confirm, and neither comes back after a reload; no
  console errors. Chromium's missing system libraries were unpacked from
  Debian's mirror into a throwaway directory, nothing installed system-wide.
  The screenshots surfaced three fixes made the same day: a signed
  "-$666.67" in the delete confirmation, rule rows saying "next Nov 1"
  while two earlier payments were overdue (now "2 due"), and the date
  field reading "New timing starts" before any timing change.
- D217's server side: both migrations applied in order on PGlite and a
  soft delete of a rule + its payment round-trips (11/11 with the above).
- **Not verified**: anything through a real PowerSync Service (same
  standing gap as docs/43), and on a real phone.

## Deploying

Run both migrations on Postgres (`2026-10-08-scheduled-payments.sql`,
then `2026-10-09-scheduled-payments-deleted-at.sql`), redeploy the API
(`docker compose up -d --build api` — not just `npm run build`), and
restart PowerSync Service so it picks up the new `scheduled_payments`
stream in `deploy/powersync/sync-config.yaml`.

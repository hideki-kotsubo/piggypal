# 50 — Account-Split Transactions

## The ask

docs/49's `split_group_id` design (a purchase split across accounts as N
independent sibling `transactions` rows) had a real flaw the user found by
testing it themselves: editing one leg's category/note/location doesn't
touch its siblings, so a purchase's shared fields can silently diverge.
Confirmed live, not just in theory — the real Postgres had exactly one
split group whose two rows already disagreed on `category_id` and `note`
by the time this redesign started. Under this app's real offline
multi-device sync, two devices editing different legs while both offline
would hit PowerSync's per-row last-write-wins with no reconciliation,
diverging permanently. The user wanted a hard guarantee this can't happen,
plus the real manual entry UX (not just the mechanism): add one
transaction, optionally split its payment across 2+ accounts, typing each
leg's amount.

## D183 — Why `split_group_id` was reverted

Advisory sibling rows meant every "shared" field (category, date, note,
merchant) actually existed once per leg, with nothing enforcing they stay
equal. The two real diverged rows above are direct proof this wasn't a
theoretical risk. Fully reverted: schema column, sync allowlist entry,
client schema, the `clusterSplits` display machinery, and the
duplicate-detector's split-exclusion fix (no longer needed — see D184).

## D184 — One transaction row + `transaction_splits`

A purchase is now always exactly **one** `transactions` row, owning every
shared field (category, date, note, merchant, currency, payer) and
`amount_cents` as the **total**, unconditionally — split or not. A new
child table, `transaction_splits` (`id`, `user_id`, `transaction_id`,
`account_id`, `amount_cents`), holds the per-account breakdown when the
purchase is split across 2+ accounts; `transactions.account_id` is `NULL`
exactly then. Shared fields can't diverge because there's only one row for
them to live on. No per-leg currency and no category-splitting — a split
purchase is one currency, one category, out of scope for now (the user's
own words: "we can talk about this later").

No DB-level CHECK enforces "2+ legs" or "legs sum to the total" — Postgres
can't express either as a plain CHECK (both are aggregate-over-siblings),
and this schema has no triggers. Enforced app-side: the UI never lets a
split drop below 2 legs (forces "Cancel split" instead), and always shows
a live "remaining to allocate" banner when `sum(legs) != amount_cents`,
never blocking autosave. **Residual, accepted risk**: two devices editing
different legs' *amounts* while both offline could transiently leave that
sum unbalanced until someone reopens the edit screen — real, but smaller
than D183's bug (nothing silently disagrees forever; the mismatch is
always visible and self-correctable), not eliminated.

## D185 — The FK is real, and why that's safe

Unlike `split_group_id`'s advisory column, `transaction_splits.transaction_id`
is a real FK to `transactions(id)`. Safe because of one procedural rule:
**a split row is only ever created by editing an already-existing,
already-uploaded transaction — never at initial insert.** `addTransaction`/
`EntryZone.tsx` are unchanged; a transaction is always born with a real
single `account_id`. This guarantees the parent's own PUT is always queued
(and, once online, uploaded — PowerSync's CRUD queue is strictly FIFO per
local commit) before any child PUT referencing it, so
`api/src/sync/routes.ts`'s existing PUT-before-DELETE ordering needs no
changes. **If a future change ever lets a transaction be born already-split,
this reasoning must be re-derived, not assumed.**

## D186 — UI model: legs are authoritative, the total is derived

`TransactionEditForm.tsx`'s "Split across accounts" toggle calls
`store.startSplit`, seeding 2 legs (the current account + full amount, and
a different account at $0) — minimal retyping for the common case. Each
leg is typed independently via its own inline keypad
(`AccountCurrencyPicker`'s new `showAccount`/`showCurrency` props let one
component serve both the top currency-only bar and each leg's account-only
row).

**Revised from the original design** (which had the total stay
keypad-edited and authoritative, with legs validated against it via a
"remaining to allocate" banner) **at the user's explicit request**: the
total is no longer directly editable while split at all — every leg edit
(`legPressDigit`/`legBackspace`/`legToggleDirection`, plus add/remove leg)
recomputes `sum(legs)` and writes it straight onto the transaction's own
`amountCents` (`syncTotalFromLegs`). The top amount keypad is replaced by a
plain read-only total display (`.amount-preview` alone, no `.keys` grid)
for exactly as long as the transaction is split — there's nothing for it
to edit once the total is a pure function of the legs. This also
eliminates the "remaining/over" banner entirely: the total can't disagree
with the legs by construction, so there's nothing to reconcile. "Cancel
split" (`store.endSplit`) still defaults the restored single account to
whichever leg carried the largest amount, and now also resyncs the
keypad's local mirror (`amountCentsLocal`) to the just-derived total so
the keypad doesn't flash a stale pre-split value once it reappears.

List rows (`TransactionList`/`RecentList`) need no clustering — a split
transaction is exactly one row, same as any other; its meta line shows
`Split · N` instead of a blank account label when `accountId` is null.

## D187 — Explicitly out of scope

- **Category-splitting** and **per-leg currency** — the user's own call,
  "we can talk more about this later."
- **The residual offline leg-sum drift** noted in D184 — real, not solved.
- **Transfers between two of the user's own accounts** — docs/49 folded
  this into the same mechanism as account-splitting (both "one event,
  multiple linked rows"). This shape doesn't obviously fit anymore: a
  transfer is two independent signed amounts on two accounts with no
  single shared total, which doesn't map onto "one total, N accounts
  summing to it." Transfers may need their own design later — not resolved
  here, not silently assumed to still work.

## Verification

`tsc -b` clean on both `app`/`api` workspaces. `npm run test -w app`:
63/63 passing — removed `splitGroups.test.ts` (subject deleted) and 3
obsolete duplicate-detector tests from D183's scenario, added
`balances.test.ts` (7 tests) for the new `computeBalances` helper
(`lib/balances.ts`) covering ordinary transactions, split legs keyed to
the parent's currency, a soft-deleted parent's legs excluded, and an
account appearing only via splits still getting a nonzero balance.
Migrations applied and verified directly against the real Postgres this
session: `transaction_splits` created with the expected shape,
`transactions.account_id` now nullable, the 2 real diverged test rows from
D183 deleted, `split_group_id` column gone. Manual browser verification of
the split-entry UI (start a split, edit legs, add/remove a leg, cancel a
split) confirmed correct against a fresh local-only instance.

## Real bugs found testing against a real signed-in device (2026-08-31)

Two real problems surfaced only once tested against the user's actual
signed-in, syncing device — invisible to every local-only check above:

1. **`deploy/powersync/sync-config.yaml` never got a `transaction_splits`
   stream.** This plan updated the Postgres schema, the hand-rolled
   `/api/sync/upload` allowlist, and the local client schema — but missed
   that PowerSync Service has its *own*, separate download-side
   configuration governing what it replicates/persists per device. Without
   a stream for it, locally-inserted `transaction_splits` rows uploaded
   fine (a real Postgres write, confirmed) but belonged to no subscribed
   bucket client-side, so PowerSync's own sync reconciliation cleared them
   back out shortly after insert — "Split across accounts" appeared to
   create legs, then immediately lost them again. Fixed by adding the
   stream (same `WHERE user_id = auth.user_id()` shape as every other
   table). **Requires restarting the PowerSync Service container to take
   effect** (`docker compose restart powersync` in `deploy/powersync/` —
   sync rules are only read at startup, confirmed via this project's own
   `README.md`, no hot-reload).
2. Diagnosing this cost real time chasing two wrong hypotheses first (a
   stale per-tab local schema, then a stale local database *file*) before
   landing on the actual cause — both were reasonable given this
   project's own history of exactly the first two problems, but neither
   explained data disappearing *after* successfully appearing, which is
   the sync-bucket-eviction signature, not a schema-staleness one. Worth
   remembering: symptom = "briefly correct, then reverts" points at sync
   reconciliation, not local schema.

**Implemented 2026-08-31.**

# 11 — Savings Goals

> **Superseded 2026-08-10 (D64).** Account-level goals (this whole doc)
> are removed. Goal/target tracking is per **category**, via the
> `budgets` table (docs/03) that already exists for category budgets —
> not a new mechanism, just the existing one covering what this doc used
> to. Kept below for historical context only; nothing on this page
> reflects current schema or UI.

## The gap this closes

`accounts.kind = 'savings'` (doc 03) has existed since the original schema,
but it's purely a label — no view in v1's scope (doc 01) computes or shows
any account's running balance, so a savings-kind account currently can't
answer "how much have I saved." Worth closing properly: "savings" is one of
the three things named in the product's own one-line description, not a
deferred nice-to-have.

## Schema: two nullable fields, not a new table

```sql
alter table accounts add column goal_amount_cents bigint;    -- null = no goal set
alter table accounts add column goal_target_date  date;      -- null = no target date
```

A goal's progress is that account's own running balance against the target
— no `goal_id` on transactions, no join, no separate table. **One goal per
account**; a second goal is a second account, consistent with the
"payment methods = accounts" granularity already locked in for Wise
(docs/10, D36/D43). A dedicated `goals` table only earns its cost if
multiple goals need to share one physical account, which would require
attributing individual transactions to a goal — meaningfully more schema
than a target amount and date need.

Goal fields work on **any account kind**, not gated to `kind='savings'` —
`kind` is cosmetic/organizational everywhere else in this design, no reason
to make it load-bearing here.

## Balance: a general capability, not goal-specific

Once "sum this account's transactions" exists for a progress bar, it's the
same computation for any account — so balance is exposed generally rather
than special-cased to goal accounts. Same currency-safety rule as budgets
(docs/10, D40): balance is per-currency, never summed across currencies.

```
balance(account_id, currency) =
  sum(amount_cents) where account_id = :account_id
    and currency = :currency
    and deleted_at is null
```

Goal progress specifically compares against `goal_amount_cents` using the
**account's own currency** (`accounts.currency`) — a stray foreign-currency
transaction on an otherwise single-currency savings account (rare in
practice) isn't counted toward the goal, same as it wouldn't roll into a
same-currency budget bar elsewhere in this design.

## Where this surfaces

Definite: the Accounts screen (see below) — both the balance and, when set,
the goal progress bar ("$3,200 / $5,000, due Dec 2026").

**Open, deliberately deferred**: whether goal progress also gets a compact
glance on Home, alongside or near the budget bars. Not deciding this now —
revisit when it's clearer whether goals turn out to be a daily-glance thing
or a periodic check-in for how this app actually gets used.

## Prerequisite gap, flagged not designed here

None of this has anywhere to live without an **Accounts management
screen** — create/edit an account's name, kind, currency, and (optionally)
its goal amount/date. This screen is already required regardless of goals,
since multi-account/multi-currency (docs/10) assumes the user can create
more than one account, and doc 07 never designed where that happens. Noting
the gap rather than designing the screen in full here — likely a simple
list + create/edit form reachable from Settings, no new interaction pattern
needed beyond what doc 07 already established (chips, pills, toast
confirmation), but worth its own pass rather than folding in as a
side-effect of this doc.

## Decisions locked in this doc

| # | Decision | Why |
|---|---|---|
| D48 | Goals are two nullable fields on `accounts` (`goal_amount_cents`, `goal_target_date`), not a separate table | Progress reuses the account's own transaction history directly; a table only pays off for multi-goal-per-account, which needs materially more schema |
| D49 | One goal per account; a second goal means a second account | Consistent with the existing accounts-as-granular-unit philosophy (D36/D43) |
| D50 | Goal fields available on any account kind, not gated to `kind='savings'` | `kind` is cosmetic elsewhere in this design; no reason to special-case it here |
| D51 | Account balance becomes a general, per-currency computed value, not goal-specific | Same computation either way; goal progress is just balance compared to a target |
| D52 | Home-screen placement for goal progress is explicitly deferred, not decided | Not yet clear whether this is a daily-glance or periodic-check-in feature. **Moot as of D64** — account-level goals removed entirely. |
| D64 | Account-level goals (D48-D52) removed; goal/target tracking is per-category via the existing `budgets` table only | An account is a payment-method identity, not a savings-target holder (docs/10 D62); category budgets already do the "target vs. actual" job this doc built a second, account-shaped version of |

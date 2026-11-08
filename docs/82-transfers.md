# 82 — Transfers between own accounts

Status: stub, 2026-11-07. **Proposals only (T-D numbers), nothing
decided or built.** Pulled forward by statement import (docs/81): the
user's former app has about 3 years of transfers, and account balances
can't be right without them.

## Why not two plain transactions

docs/03 said "model as two transactions for now", and CLAUDE.md lists
transfers-as-linked-pairs as deferred (docs/49/50 left it unresolved).
Two plain transactions (−$500 Scotiabank, +$500 Neo) fail in three ways:

- Budgets, Insights and the trend chart count them as spending and
  income.
- Paying a credit card from checking is a transfer. As an expense, the
  money counts twice: the card purchases, then the payment.
- Nothing links the halves; deleting one leaves the other and balances
  drift (the docs/49 failure class).

## The user's cases

- Moving money between banks for perks.
- Paying debts, credit cards included, from a bank account.
- Probably cross-currency (Wise CAD → Itaú BRL); to confirm whether the
  former app ever recorded one (its records hold a single `currency`).

## Proposals

- **T-D1. One record, two sides.** Shared fields (date, time, note) are
  stored once, following docs/50's rule. Each side has its own account,
  signed amount (from negative, to positive) and currency.
- **T-D2. No category; kept out of budgets, spending, Insights and the
  trend chart.** Counts in account balances (docs/12).
- **T-D3. Cross-currency without conversion.** Each side keeps its own
  currency (docs/10's never-convert rule); the gap is the real FX cost,
  shown, never computed into a rate.
- **T-D4. Statement audit matches each side separately** against its
  own account's statement (docs/81).

## To design

- Schema: a `transactions` row with `kind = 'transfer'` plus two legs
  (reuse `transaction_splits`, which today has no per-leg currency), or
  a separate table. Must fit the one-write-path rule (locked decision 3)
  and the private-records streams (docs/77).
- Entry UI: tap entry, typed/voice ("moved 500 from Scotia to Neo"),
  and the edit screen.
- Lists: how a transfer row looks, and under which account filter.
- Scheduled transfers (docs/57), e.g. a monthly card payment.
- Household: transfers between two people's accounts.
- Import mapping from the former app's `type: 3` (two `payments`, one
  negative one positive, summing to 0; docs/81).

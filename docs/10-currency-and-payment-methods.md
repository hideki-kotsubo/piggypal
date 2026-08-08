# 10 — Currency & Payment Methods

## Scope note

This revises the "Money" row of doc 01's MVP scope table. The original line
— "single currency per account, conversion math deferred" — assumed a user
stays within one currency. The actual need (frequent international travel,
expenses genuinely made in BRL/CAD/USD/JPY/etc.) requires currency to live
on the **transaction**, not just the account, and budgets to be
currency-aware. Conversion math (FX rates, unified single-number rollups)
stays deferred — this is about tracking each currency accurately side by
side, not converting between them.

## Payment methods = accounts, already

No new concept needed. Each real-world card, cash pool, or bank account the
user wants to track separately is its own `accounts` row:

- Credit card A, credit card B → two `accounts` rows, `kind='credit'`,
  distinct `name`.
- Cash → `kind='cash'`.
- A specific bank account → `kind='checking'` or `'savings'`.
- **Debit card**: not a separate account — it draws from the checking
  account behind it, same balance, so it's just checking-account spending.
  Only worth its own row if the user specifically wants that card's activity
  isolated from the rest of the checking account's — not needed for v1.
- **"Bank transfer"** isn't an account or a payment method — it's movement
  between two accounts, already modeled as two independent transactions
  (transfers-as-linked-pairs are deferred, doc 01).

## Transaction-level currency

`accounts.currency` (doc 03) is the account's own settlement currency —
e.g. a CAD credit card's statement currency. It is **not** always the
currency a given purchase was made in: a JPY lunch charged to that CAD card
is a CAD account with a JPY transaction. So currency needs to live on the
transaction too, defaulting to the account's currency but overridable.

```sql
alter table transactions add column currency char(3) not null default 'CAD';
-- default is a placeholder for existing rows / migration convenience;
-- new transactions always set this explicitly (account's currency unless
-- the user/parser overrides it)
```

"Primary currency" (used as a default for new accounts/transactions and as
the single currency the trend chart plots, below) is a **local device
preference**, not a server column — same reasoning as doc 09's UI language:
it's a pure client concern, and now that budgets themselves carry an
explicit currency (below), nothing server-side needs one canonical "the"
currency for a user.

## Budgets, per currency

Confirmed: budgets are per (category, month, currency), not just per
(category, month). A user can hold a CAD budget and a BRL budget for the
same category in the same month, and each only tracks spend in its own
currency — no forced conversion, no exclusion.

```sql
alter table budgets add column currency char(3) not null default 'CAD';
-- replaces the old constraint
alter table budgets drop constraint budgets_user_id_category_id_month_key;
alter table budgets add constraint budgets_user_id_category_id_month_currency_key
  unique (user_id, category_id, month, currency);
```

Dashboard (doc 07) shows one budget bar per (category, currency) that has a
budget or spend that month — in the common case (no travel that month)
this is invisible complexity, exactly one bar per category, same as before.
It only expands into multiple bars during a multi-currency month, which is
exactly when the user needs to see it broken out.

```
August · Mercado (CAD)     $420 / $600
August · Mercado (BRL)     R$310 / R$500     ← only appears if BRL spend/budget exists
August · Transporte (CAD)  $204 / $180  (over)
```

A transaction in a currency with no matching budget row for that
category+month is simply unbudgeted spend — shown in the transaction list
and CSV export as always, just without a bar to roll up against, same as
an uncategorized transaction has no category bar.

## Trend chart stays primary-currency only

Doc 01 scopes this as "one trend chart" (singular, minimal by design
already). Rather than turning it into a multi-line per-currency chart,
it plots primary-currency spend only — foreign-currency days show as a dip
in the line, since that spend isn't included in it, but nothing is hidden:
it's still fully visible in the transaction list, per-currency budget bars,
and CSV export. Flagging this as a scoped simplification specific to the
trend chart, not the general policy — say if a multi-currency trend view
matters more than I'm assuming.

## Worked example: Wise (multi-currency accounts)

Wise doesn't fit "one account = one currency" as literally as a normal bank
account — one Wise login holds independent balances in many currencies at
once, and its card spends directly from whichever balance matches the
purchase currency, auto-converting from a default balance (at Wise's own
transparent mid-market rate) only when you don't hold that currency.

No new schema needed — this is the existing account model (D36) applied at
finer grain: one `accounts` row per currency balance actually kept topped
up ("Wise (CAD)", "Wise (BRL)", "Wise (USD)", …), `kind='checking'`, each
with its own `currency`. Both real-world cases then fall out of decisions
already locked:

- Spend in a currency you hold a Wise balance for → logs straight to that
  account, transaction currency matches the account currency.
- Spend in a currency you don't hold (Wise auto-converts internally) →
  logs to whichever Wise-currency account is that card's default, with the
  transaction's own `currency` recording what was actually paid — D38's
  account-differs-from-transaction case.

Still out of scope regardless: showing Wise's actual conversion rate or
what an auto-converted purchase cost in a home currency. Wise being
unusually transparent about its own rate doesn't pull conversion math back
into v1 — that figure is available on Wise's own statement if wanted.

## Tap-entry currency override

The AI text path can already infer currency from words like "ienes" (doc
04's tool schema). Tap-entry (doc 07) needed the same capability without a
sentence to parse it from — see doc 07's D44/D45 for the chip-row UI and
the "last-used-per-account, resets on account switch" default rule.

## AI parser: currency extraction

Doc 04's `record_transaction` tool schema gains a `currency` field:

```typescript
currency: {
  type: "string",
  description: "ISO 4217 currency code. Infer from explicit currency words/symbols in the utterance (reais/R$ → BRL, ienes/¥ → JPY, euros/€ → EUR). If no currency is mentioned, use the account's own currency — never guess a foreign currency from amount size or vocabulary alone."
}
```

Account selection is unaffected by this change — AI-parsed entries still
default silently to the last-used account (doc 07, same as manual entry),
correctable with a tap afterward. Reliably inferring *which card* was used
from a natural-language utterance isn't attempted; currency is inferred,
the account is not.

## Decisions locked in this doc

| # | Decision | Why |
|---|---|---|
| D36 | Payment methods map 1:1 to `accounts` rows; no new schema concept | Existing table already covers it — one row per card/cash pool/bank account |
| D37 | Debit cards are not separate accounts; they draw from the checking account behind them | Same balance, same money — a separate row would double-count |
| D38 | `transactions.currency` added, independent of `accounts.currency` | A purchase's currency and its settlement account's currency are genuinely different things (foreign-currency card spend) |
| D39 | "Primary currency" is a local device preference, not a Postgres column | Mirrors doc 09's language preference reasoning; nothing server-side needs one canonical currency now that budgets carry their own |
| D40 | Budgets keyed on `(user_id, category_id, month, currency)`, one bar per combination that has budget or spend | Tracks each currency honestly with no forced conversion or silent exclusion; stays a single bar per category in the common single-currency month |
| D41 | Trend chart plots primary-currency spend only; other currencies remain visible elsewhere (list, budgets, export) | Keeps doc 01's "one trend chart" simple; not a data-hiding decision, just a chart-scope one |
| D42 | AI tool schema extracts `currency` from explicit words/symbols, defaults to account currency, never guesses | Same "never guess, degrade to friction not error" principle as category_id in doc 04 |
| D43 | Multi-currency-balance providers (e.g. Wise) get one `accounts` row per actively-held currency | Fits D36 without a new schema concept; each balance already behaves independently for budgeting regardless of its real-world login. **Revised by docs/12's D60**: "grouped only by naming convention" didn't hold at the real account scale involved (15-20+ accounts across multiple banks) — grouping is now a proper (if minimal) `institution` field, which also covers Wise's own grouping as the same mechanism, not a special case. |

## Still deferred

Conversion math (FX rates, a single unified cross-currency number) is not
part of this doc — this is tracking multiple currencies accurately side by
side, not converting between them. Revisit only if users specifically ask
for a "what did I spend total, in one number" view across currencies.

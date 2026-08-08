# 12 — Accounts Management Screen

## Why this exists

Multi-account/multi-currency (docs/10) and savings goals (docs/11) both
assume the user can create and edit accounts, but no screen for that was
ever designed — doc 07 only implied one exists behind Settings. This closes
that gap.

## Grouped by institution — revising D43

Doc 10's D43 said Wise's multiple currency balances need "no formal
grouping, just consistent naming." That held for 3 Wise balances in
isolation, but doesn't hold at the real scale this app needs to support:
several cards across Visa and Mastercard, 3+ bank accounts each in Canada
and Brazil, plus Wise — easily 15-20 `accounts` rows. A flat list stops
being usable well before that, and "name them consistently" stops being
enough once two different banks might reasonably both have an account
called "Checking." Revising D43 rather than letting a flat list stand.

```sql
alter table accounts add column institution text;  -- nullable, free text —
                                                     -- grouping/display only,
                                                     -- no FK, no new table
```

Rows display as `institution — name` when set ("TD — Visa," "Itaú —
Checking"), falling back to plain `name` when not (a standalone Cash
account doesn't need one). This doubles as the disambiguation two
same-named accounts at different banks would otherwise lack. Wise's
currency balances now group under `institution = 'Wise'` the same way any
bank's accounts do — one mechanism, not a special case.

## Layout

Reached via Settings (the app-bar kebab, doc 07). Grouped by institution,
collapsible — most-recently-used group expanded by default, others
collapsed to a single count line. Ungrouped accounts (no institution set)
list plainly, no header. Each row: name, kind, and one balance line **per
currency actually present** on that account (never merged across
currencies — same rule as budgets, docs/10 D40). If the account has a goal
set (docs/11), its progress bar shows inline in the same row, no separate
screen.

```
Accounts                                    +
─────────────────────────────────────────────
▾ TD (2)
  Visa                                credit
  $420.00 CAD
  Checking                          checking
  $1,150.00 CAD
─────────────────────────────────────────────
▸ RBC (1)
▸ Itaú (2)
▸ Wise (3)
─────────────────────────────────────────────
Trip Fund                               savings
$3,200.00 / $5,000.00 ────▓▓▓▓░░░ 64%   due Dec 2026

Cash                                       cash
$85.00 CAD
─────────────────────────────────────────────
Archived (2)                                 ›
```

Ordering within a group: most-recently-used first — the same recency
signal doc 07 already derives for account defaults (D45/D46), not a new
stored order. Groups themselves order by their most-recently-used account,
surfacing whichever bank is actually active lately. No manual drag-to-
reorder / `sort_order` column in v1 (see D59).

## Editing: expand in place, same as everywhere else in this design

Tapping a row expands it inline into an edit form — no navigation to a
separate screen, consistent with how inbox items (D26) and the entry zone
(D23) already expand in place rather than opening modals:

- Institution (text field, optional) — "TD," "Itaú," "Wise," blank for a
  standalone account like Cash. Purely a grouping/display label.
- Name (text field) — "Visa," "Checking," "Trip Fund." Combined with
  institution for display (`institution — name`), but stays meaningful on
  its own for accounts with no institution.
- Kind — chips: checking / credit / cash / savings.
- Currency — chips, same frequency-ranked pattern as everywhere else
  (docs/07, D44). Changing this **does not touch existing transactions** —
  each already carries its own currency (D38) — it only changes the
  default for new entries on this account and what currency a goal target
  is denominated in going forward.
- Goal — if one is already set, shown directly (target amount, target
  date, a "remove goal" link). If not, collapsed behind a single
  **"+ Add a savings goal"** link that expands to the same fields only when
  tapped — applying the hide-until-touched rule (D23) from the start here,
  rather than defaulting it open the way an earlier draft of the entry zone
  mistakenly did.
- **Archive account** — de-emphasized, at the bottom of the form, not a
  destructive-red delete button. Archiving, not deleting: accounts can't be
  hard-deleted once they have transaction history (the FK is `not null`),
  so this sets `archived = true` instead.

## Creating an account

Same inline-expanding form, opened via "+" in the app bar — no separate
screen for create vs. edit. Starts with no goal set, so the goal section
starts collapsed, matching the "no goal yet" state above.

## Archived accounts

Dropped from every entry-flow account picker (tap-entry chips, D46; the
AI parser's injected account list, doc 04) so they stop being offered for
new entries, but nothing about their historical data changes — their past
transactions remain fully visible in the transaction list and CSV export
exactly as before. Shown in this screen under a collapsed "Archived (N)"
line at the bottom, expandable, rather than hidden entirely — an archived
account should stay findable, just out of the way.

## Schema addition

```sql
alter table accounts add column archived boolean not null default false;
```

Mirrors `categories.archived` (doc 03) exactly — same pattern, same reason.

## Decisions locked in this doc

| # | Decision | Why |
|---|---|---|
| D53 | Accounts screen: a list showing name, kind, per-currency balance, and inline goal progress if set | Surfaces everything docs/10 and docs/11 already assume exists, in one place |
| D54 | Tapping a row expands it in place for editing — no separate screen | Consistent with the inline-expand pattern already used for inbox items and the entry zone |
| D55 | Goal fields collapse behind "+ Add a savings goal" when unset, shown directly when already set | Applies D23's hide-until-touched rule correctly from the start |
| D56 | Accounts get `archived` (mirrors `categories.archived`), not hard delete | `transactions.account_id` is a required FK — hard delete was never actually possible once an account has history |
| D57 | Changing an account's currency doesn't affect existing transactions, only new-entry defaults and the goal's denomination going forward | Each transaction already carries its own currency (D38); avoids a confusing "did this break my history" moment |
| D58 | Balance shows one line per currency actually present on the account, never merged | Same currency-honesty rule as budgets (D40) |
| D59 | No manual reordering / `sort_order` column in v1; list order = most-recently-used | Reuses the same recency signal already computed elsewhere (D45/D46) rather than adding new stored state |
| D60 | Accounts get an optional `institution` field (free text, grouping/display only) — revises docs/10's D43 | A flat list and "name consistently" both stop working at the real scale (15-20+ accounts across multiple banks) this app needs to support |
| D61 | Rows display as `institution — name`, disambiguating same-named accounts at different institutions | Two banks both having a "Checking" account is a real, not hypothetical, collision at this scale |

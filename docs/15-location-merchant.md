# 15 — Location/Merchant on Transactions

## The problem

"How much did I spend at Costco last year" (a real membership-renewal
decision) needs a *reliable* total. Today the closest thing is `note`, and
tap-entry defaults `note` to the category name (`EntryZone.tsx`) — merchant
only lands there if the user manually overwrites it every single time.
Undercounting a number that's driving a real decision is worse than the
extra schema/UI cost, which is what moved this from the backlog's original
"start cheap, note-only" lean to a structured field.

Brainstormed 2026-08-12; visual exploration in
`docs/artifacts/piggypal-location-field.html` (three frames: parse preview,
edit form, search/filter). Frame 3 (a search/filter screen keyed off
Location) and the AI parser wiring (frame 1) are **not** in this pass — see
Scope below.

## Scope for this pass — column + edit form only

This closes the storage/edit half only: a new `merchant` column and a way
to set it by hand with recency-ranked suggestions. Explicitly **not** in
this pass:

- The Tier 2 AI parser tool schema (`docs/04`) doesn't extract merchant yet
  — the AI pipeline itself isn't implemented in this repo at all yet (still
  spec-only per `docs/04`), so there's nothing to wire up today. When that
  pipeline is built, merchant extraction slots in as an additional optional
  field on the existing tool schema, Tier 2 only (see Tier boundary below).
- Merchant is not surfaced on `TransactionList`/`RecentList` rows — edit
  form only for this first pass.
- The search/filter screen (artifact frame 3) — a separate, later piece of
  work once search/filter itself is prioritized.
- Merchant-string dedup/normalization ("Costco" vs "COSTCO #412" vs "Costco
  Gas" fragmenting a spend-by-merchant total) — flagged in the artifact,
  not solved here. The recency-ranked suggestion chips reduce *new* forks
  (picking an existing string is one tap) but don't merge existing ones.

## Schema — nullable `merchant` column, no new table

```sql
alter table transactions add column merchant text;
```

Same shape as `institution` on `accounts` (docs/12 D60) — free text,
display/grouping only, no FK, no closed enum. A transaction with no
merchant set (the common case until this is populated) just has `null`,
identical to how `note` already behaves.

## Tier boundary — Tier 2 (AI) only, never Tier 1 guesses

Tier 1 (on-device, offline, rule-based) never attempts merchant extraction.
Category/account keyword-matching (`docs/04`) is a closed, known
vocabulary; merchant names are open-ended proper nouns — a materially
fuzzier extraction problem where a wrong guess is worse than leaving the
field blank. This mirrors the existing Tier 1/Tier 2 split for category and
account, and the parser's broader "ambiguity falls into the inbox, never a
wrong guess" principle. Free-tier users (Tier 1 only, docs/01) populate
`merchant` exclusively through the edit-form field below — never
automatically.

## Edit form — a field, not a picker

`TransactionEditForm.tsx` gains a "Location" field directly below Note:
free text, autosaves per keystroke using the same local-mirror pattern
already used for Note and the Institution field (`noteStr` /
`institutionStr`) — binding straight to `transaction.merchant` snaps the
cursor to the end on every keystroke once PowerSync's async write resolves,
so local state carries display and the store write happens on the side.

Below the input, a recency-ranked suggestion chip row — same convention as
the Institution-autosuggest backlog item (`docs/00-backlog.md`, "Next"):
`store.rankedMerchants()` returns every distinct merchant string in the
user's transaction history ordered by most-recent-use first (not
frequency — matches the recency signal already established for
account/currency defaults, D45/D46), and the component narrows that list
live against the typed substring, case-insensitive, contains-not-just-
starts-with. Tapping a chip fills the text field; it doesn't submit or
lock the value, so a first-time merchant is still one tap of typing away
and a chip pick can still be edited further. The row only renders once
there's at least one matching suggestion — no empty chip row.

## Decisions locked in this doc

| # | Decision | Why |
|---|---|---|
| D76 | `transactions.merchant`, nullable free text, no new table | Same shape as `institution` (docs/12 D60) — display/grouping value, not a relational entity; a structured column is what makes filtering/counting possible later, which free-text `note` can't guarantee |
| D77 | Merchant extraction is Tier 2 (AI) only; Tier 1 never guesses it | Open-vocabulary proper nouns are a fuzzier extraction problem than the closed category/account keyword lists Tier 1 already handles — wrong guesses are worse than blank, same principle as the rest of the parser |
| D78 | This pass covers the column + edit-form field + suggestions only — AI wiring, list-row display, and the search/filter screen are separate, later work | The AI pipeline itself isn't implemented yet (nothing to wire up), and list-row display / search-filter weren't part of the motivating "reliable total" use case, which the edit form alone already satisfies |
| D79 | Suggestion chips rank by recency, filtered live by case-insensitive substring | Matches the account/currency default signal (D45/D46) and the Institution-autosuggest item's already-decided filtering behavior — one convention, not a new one |

**Implemented 2026-08-12.**

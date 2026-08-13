# 18 — Transaction Search & Filter

## The problem

The Transactions list (docs/07/17) is a flat, unfiltered scroll of
everything. Location (docs/15) was designed with "how much did I spend at
Costco last year" as the motivating case, but without a way to actually
narrow the list to Costco, that question still means scrolling and eyeballing
totals by hand. This closes that gap: search + filter chips over the
existing list.

## Scope for this pass — inline on `/transactions`, not a separate screen

`docs/artifacts/piggypal-location-field.html`'s frame 3 staged this as its
own screen (`"03 · search & filter (new screen)"`). This pass deliberately
diverges: search input, filter chips, and a totals line are added directly
to the top of the existing `TransactionList.tsx` instead — the list is
already the natural home for filtering it, and a separate screen would add
a screen-hop for no benefit. Confirmed with the user.

## Filters, not just search

Free text (`q`) matches against `note` + `merchant`, case-insensitive
substring. Alongside it, four filter sections — Category, Account,
Location, Date range — each rendered as chip rows using the app's existing
`.chip`/`.chip.picked` primitives (no new visual states needed): Category
reuses `CategoryPicker` as-is (plus an explicit "All categories" chip,
since that component has no built-in clear); Account is a flat chip row
over `store.rankedAccounts()` (not `AccountCurrencyPicker` — that
component's account+currency-coupled `onChange` shape doesn't fit a
filter, and institution-grouping was built for entry speed, not browsing);
Location is a capped chip row over `store.rankedMerchants()` (same
"+N more" ghost-chip mechanic `AccountCurrencyPicker`'s Capped mode
already established, docs/13) — merchant is open-vocabulary and could
have many distinct values (docs/15 D78's still-open dedup problem); Date
range is closed preset chips (This week / This month / Last month /
Custom, the last revealing two native `<input type=date>`), matching the
app's existing closed-vocab-over-free-form-picker bias (docs/04's
relative-date terms, docs/13/14's picker patterns) rather than a bare
from/to widget with no defaults.

`app/src/lib/filterTransactions.ts` (new, pure module) does the actual
filtering/aggregation — `filterTransactions()`, `totalsByCurrency()`,
`presetRange()` — independent of the UI, so `TransactionList.tsx` just
turns URL state into a `TransactionFilters` value and renders the result.

## Filter state lives in the URL, not local `useState`

Because docs/17 made `/transactions/:id` a real route, tapping a filtered
result and hitting Back **unmounts `TransactionList` entirely** — plain
component state would be silently lost on every such round-trip. Filter
state is read from and written to `useSearchParams()` instead, so it
survives that navigation (and is bookmarkable/shareable for free). Every
`setParam()` call uses `{ replace: true }` so typing in the search box
doesn't turn every keystroke into its own browser-history entry.

## Totals: one line per currency, never blended

The artifact's mockup showed a single blended total ("$612.40") for the
filtered set — that doesn't hold up given per-transaction currency
(docs/10: currencies are tracked side by side, never summed or converted).
`totalsByCurrency()` mirrors `store.balancesFor`'s existing per-currency
`Map` grouping exactly, so a filtered view spanning CAD and BRL shows both
totals separately, the same convention account balances and budget bars
already use.

## Decisions locked in this doc

| # | Decision | Why |
|---|---|---|
| D84 | Search/filter lives inline atop `/transactions`, not a separate screen | Avoids an extra screen-hop for a list that already exists; confirmed with the user, deviating deliberately from the artifact's own staging |
| D85 | Filter state is URL-search-param driven (`useSearchParams`), not local component state | docs/17's routed `/transactions/:id` unmounts `TransactionList` on navigation to it; local state would be silently lost on every filtered-result tap + Back |
| D86 | Category/Account are closed-set chip pickers; Location is a capped chip row off `rankedMerchants()` | Category/Account are small closed lists already rankable; merchant is open-vocabulary and could grow large, so it gets the same capped "+N more" treatment as the account picker's Capped mode (docs/13) |
| D87 | Date range uses closed preset chips (week/month/last month/custom), not a bare range widget | Matches the app's existing closed-vocab-over-free-form bias; a bare two-date-input control with no defaults is slower for the common cases |
| D88 | Filtered-result totals show one line per currency present, never blended into one number | Matches `balancesFor`/`BudgetBars`' existing convention (docs/10) — a single summed total across mixed currencies would be actively misleading |
| D89 | `.chip`/`.chip.picked`/`.chip-row`/`.pill-tap` reused throughout; only new CSS is the search input row and filter-section label | No search-input or "active filter" pill styling existed before this pass; everything else was already in place |

**Implemented 2026-08-12.**

# 14 — Category Groups & Subcategories

## The problem

`store.rankedCategories()` is consumed flat by three separate pickers —
`EntryZone.tsx` (tap-entry categorize), `InboxScreen.tsx` (categorize an
inbox item), `TransactionEditForm.tsx` (edit an existing transaction's
category) — plus `CategoriesScreen`/`BudgetBars` list categories directly.
Real usage (Groceries, Meals, Dinners, Lunch, Brunch, Snacks, Coffee,
Happy-hour under "Food" alone) crowds all three pickers the same way flat
accounts crowded the account picker (docs/13).

**Key difference from docs/13**: institution grouping was *inferred* —
accounts happened to share a name string, and grouping was a side effect
of scale. Category grouping here is *authored* — the user deliberately
declares "Coffee lives under Food" in `CategoriesScreen`. That changes the
shape of the fix: no user-facing Grouped/Capped mode setting is needed:
the picker just renders whatever hierarchy has actually been built. Flat
today stays flat; add children to a category, the picker groups.

## Scope for this pass — picker only, budget rollup deferred

This pass fixes the crowded picker and the ability to build the
hierarchy. It explicitly does **not** touch how budgets compute. A budget
set on a category that has children still only counts spend logged
*directly* to that category (via `BudgetBars`' existing
`t.categoryId === b.categoryId` match, unchanged) — it does not sum
children's spend. Rollup ("Food $600" = Groceries + Meals + Coffee +
Happy-hour combined) is a real computation change to `BudgetBars.tsx` and
a separate, later decision (D74 below closes the resulting UX gap for
this pass rather than deferring it silently).

## Schema — self-referencing `parent_id`, not a new table

```sql
alter table categories add column parent_id uuid references categories(id);
```

Nullable. `parent_id = null` means the category is a group or a
standalone flat category; non-null means it's a subcategory. Depth capped
at exactly 2 levels, enforced at the **app level only** (the UI refuses to
offer a category that already has a parent as somebody else's parent) —
schema stays simple, no recursive-depth constraint needed.

This looks like docs/12 D60's `institution` field (simple nullable
addition, no new table) but is a real FK, not free text: subcategories are
full sibling category rows — they need everything a category already has
(icon, sort_order, archived, keywords for the AI parser), not a
lightweight display label the way `institution` is for accounts.

## Groups stay directly selectable

A category with children still renders as its own chip, sitting alongside
its expanded children — never forces drilling into a leaf. A one-off "Food"
purchase that doesn't cleanly fit any subcategory just gets tapped as bare
"Food." Matches the AI parser's existing never-guess-degrade principle
(docs/04) and the account picker's solo-institution handling (docs/13).

## Picker: reflects authored structure directly

No new local-device setting, unlike docs/13's Grouped/Capped mode — the
branch is just "does this category have children," not a count-based
scale trigger. Reuses the exact collapse-to-a-row / tap-to-expand
mechanics already built for `AccountCurrencyPicker`: a category with
children renders as "Food ▸ 4," tap to expand into subcategory chips
(bare names — the group header already shows "Food"); the group
containing the current selection starts expanded by default, same as
`AccountCurrencyPicker`'s institution groups.

## One shared `CategoryPicker`, three call sites

Extracting a shared component (mirroring `AccountCurrencyPicker`) means
building the grouped-chip-row logic once instead of three times, and
keeps the three surfaces from drifting the way currency handling briefly
did across files before this session's account/currency cleanup.

## `CategoriesScreen`: a Group field in the edit form

Creating/editing a category gains a "Group" chip picker: "None
(top-level)" plus every existing category with no parent of its own
(depth-1 only, enforcing the 2-level cap — a category that already has a
parent never appears as a choice). Reuses the same expand-in-place edit
pattern already in place.

## Decisions locked in this doc

| # | Decision | Why |
|---|---|---|
| D70 | `categories.parent_id`, nullable self-referencing FK; exactly 2 levels, enforced app-side only | Subcategories are full category rows (icon, keywords, sort_order), not a lightweight label like `institution` — a real FK fits better than free text; app-level depth cap keeps schema simple |
| D71 | Categories with children remain directly selectable in the picker, alongside their expanded children | Never force precision the user doesn't have — same principle as the AI parser's never-guess rule and the account picker's solo-institution handling |
| D72 | The picker reflects whatever hierarchy exists directly — no user-facing Grouped/Capped setting like docs/13's account picker | This grouping is authored (deliberately built in `CategoriesScreen`), not inferred from scale — there's no ambiguity about display preference to ask the user to resolve |
| D73 | Extract a shared `CategoryPicker` component, replacing the three separate flat `rankedCategories()` consumers (`EntryZone`, `InboxScreen`, `TransactionEditForm`) | One place to build the grouped-chip-row logic instead of three; avoids the surfaces drifting out of sync |
| D74 | Budget rollup is deferred; `CategoriesScreen` hides the budget section entirely for a category that has children, rather than showing a budget that silently only tracks direct (near-always-zero) spend | Showing a budget field on a group category without rollup would be actively misleading — the bar would look phantom/broken since almost no spend logs directly to a group once it has subcategories |

# 79 — Accounts, Categories and Settings UI refresh

Status: design, partly decided (2026-10-27). Nothing built yet.

Sketches: the canvas "Flowtab — Settings, Accounts & Categories sketches"
(https://claude.ai/artifact/4iJ5H6HMQozYyaor6mc7Wz, private to the owner).
Frames are named S1–S3 (Settings), A1–A3 (Accounts), C1–C3 (Categories)
below.

Backlog items this covers (docs/00, ⚪ Next): "Accounts Management: improve
UI", "Categories Management: improve UI", the Categories leaf-padding,
edit-mode and Archive items, and "Settings page: improve
layout/navigation".

## Decisions

| #    | Decision |
|------|----------|
| D307 | **Budgets live only on categories without subcategories; a group never shows one.** No budget bar, total or rollup on a group row (C1). Confirms docs/14 D74 instead of reopening it. |
| D308 | **Archived categories can be restored.** The archived list gets a Restore button per row (C3). Restore just clears `archived`; past transactions never lost their category, so nothing else moves. This answers the "a way to bring an archived category back" half of the Archive backlog item. What archiving itself should mean beyond that is still open. |
| D309 | **Accounts get a detail page.** Tapping an account opens its own screen (A2) instead of expanding the edit form in the list: balance per currency (never blended, docs/10), in/out this month, upcoming scheduled payments for it (docs/57), recent transactions, "See all" into `/transactions` filtered by that account (docs/18), and an Edit button. |

## Proposed, not yet decided

- **Accounts list (A1):** institution cards with a letter badge, search
  once there are many accounts (docs/12's 15-20+ scale), person filter
  chips when there's a household (docs/38), per-currency totals strip.
- **Edit in a bottom sheet (A3, C2):** replaces in-list expansion for
  both screens; a titled "Editing category" header answers the "make
  edit mode clear" item. Merge and Archive move to the sheet's footer.
- **Categories tree (C1):** Expense/Income segmented control instead of
  two stacked sections; indent guide lines for subcategories (the
  leaf-padding item); "$412 of $600" plus a bar on budgeted rows, warn
  colour when over.
- **Settings navigation:** S1 hub + sub-pages (recommended), S2 hamburger
  drawer (changes app-wide navigation, touches docs/07 D147 — only if
  chosen deliberately), S3 floating section jump bar. Not chosen yet.

## Open questions

1. Under D307, does a top-level category with no subcategories (e.g.
   Transport in C1) keep its budget, as today's code allows? Assumed yes.
2. Does Restore need any confirmation, or is it one tap?
3. The account detail page needs a route (`/accounts/:id`) — the edit
   sheet opens from there, or still from the list too?

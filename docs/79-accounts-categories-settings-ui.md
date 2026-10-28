# 79 — Accounts, Categories and Settings UI refresh

Status: built 2026-10-28 on `feat/ui-refresh`, not released. See "Built" below.

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
| D307 | **Budgets live only on categories without subcategories; a group never shows one.** No budget bar, total or rollup on a group row (C1). A top-level category with no subcategories (e.g. Transport) keeps its budget, as today. Confirms docs/14 D74 instead of reopening it. Group-level budgets are still being discussed (see Open questions). |
| D308 | **Archived categories can be restored.** The archived list gets a Restore button per row (C3). Restore asks for confirmation first (decided 2026-10-28), then just clears `archived`; past transactions never lost their category, so nothing else moves. This answers the "a way to bring an archived category back" half of the Archive backlog item. What archiving itself should mean beyond that is still open. |
| D309 | **Accounts get a detail page.** Tapping an account opens its own screen (A2) instead of expanding the edit form in the list: balance per currency (never blended, docs/10), in/out this month, upcoming scheduled payments for it (docs/57), recent transactions, "See all" into `/transactions` filtered by that account (docs/18), and an Edit button. |
| D310 | **Settings becomes a hub with sub-pages (S1).** A short main page of groups (Your money, Sync & household, Preferences, App), each row showing a one-line summary and opening its own page; sync status at the top. Sign out and Delete account move into Account & sync (S1b). The drawer (S2) and floating jump bar (S3) are not pursued. |
| D311 | **Accounts and Categories edit in a bottom sheet (A3, C2), as a trial.** Replaces in-list expansion on both screens; a titled "Editing category" header answers the "make edit mode clear" item. Merge and Archive move to the sheet's footer. Evaluated hands-on before it's kept, like docs/31. |

## Approved for the build (2026-10-28)

- **Accounts list (A1):** institution cards with a letter badge, search
  once there are many accounts (docs/12's 15-20+ scale), person filter
  chips when there's a household (docs/38), per-currency totals strip.
- **Categories tree (C1):** Expense/Income segmented control instead of
  two stacked sections; indent guide lines for subcategories (the
  leaf-padding item); "$412 of $600" plus a bar on budgeted rows, warn
  colour when over.

## Open questions

1. Group budgets on top of subcategory budgets (raised 2026-10-28)?
   Both at once double-counts in totals and lets the numbers disagree;
   the cleaner variant is either/or per group (a group is budgeted as a
   whole, counting all its subcategories, *or* per subcategory). Either
   way it needs the rollup D74 deferred. **2026-10-28: backlogged** as
   the either/or variant, after these screens ship; D307 stands for the
   first build.
2. ~~Does Restore need any confirmation, or is it one tap?~~ Decided
   2026-10-28: Restore asks for confirmation first (D308).
3. ~~The account detail page needs a route (`/accounts/:id`) — the edit
   sheet opens from there, or still from the list too?~~ Decided
   2026-10-28 (D309): a list tap always opens the account page
   (`/accounts/:id`); the edit sheet opens only from its Edit button. No
   edit icon or long-press on list rows. Categories have no detail page,
   so a category tap still opens its edit sheet directly.

## Built (2026-10-28, `feat/ui-refresh`)

- **Settings (D310):** `SettingsScreen.tsx` is the hub. The old page's
  sign-in, sync status, sign out, delete account, device name, paired
  devices and the P2P-only household list moved unchanged to
  `SyncSettingsScreen.tsx` (`/settings/sync`); "Reset local data" went
  there too, as a This device item. `PreferenceScreens.tsx` has
  `/settings/appearance`, `/settings/language` and `/settings/entry`
  (voice language, "$ means", account picker mode). Install and About
  stay in the hub's App group. Links meant for signing in (session
  banner, magic-link verify, scan-a-code, delete account) now go to
  `/settings/sync`. The hub's account card shows the sync state but has
  no Sync now button; that stays on Account & sync.
- **Edit sheet (D311):** `BottomSheet.tsx`, shared. Forms still autosave
  as you type, so Done only closes; the scrim and Escape close too. One
  difference from the D311 wording: **Merge stays on the list's ⇄
  button**, not in the sheet, since the merge flow picks the keeper first
  and the sheet only knows one account. The account form moved to
  `AccountForm.tsx`: kind is a four-way switch, owner is chips, and
  institutions already in use show as one-tap suggestions.
- **Accounts (A1, D309):** `AccountsScreen.tsx` shows institution cards
  (no more collapsing groups), search above `ACCOUNT_PICKER_SCALE_THRESHOLD`
  (6) accounts, person chips only with a household, and per-currency
  totals of what's shown. Rows link to `/accounts/:id`
  (`AccountScreen.tsx`). D308's Restore (with confirmation) was applied to
  archived **accounts** too, since they had the same no-way-back gap; an
  archived account's page also has Restore.
- **Account page (D309):** due-but-unposted and next-30-days occurrences
  of its non-paused rules; split purchases show this account's own leg.
  Known gap, pre-existing: "See all" uses `/transactions?account=`, which
  matches `accountId` only, so split purchases don't appear in that list
  (docs/18's filter predates docs/50).
- **Categories (C1, C2, C3, D307, D308):** Expense/Income switch (follows
  the keeper's kind while merging), a card per group with its
  subcategories on a guide line and "+ Add to <group>", runs of
  categories without subcategories share a card. Group rows show a plain
  spent total, never a budget. Leaves show "spent of budget" with a bar
  per budget currency, plain spent for currencies without one. Edit sheet
  has this month's total and a link to its transactions. Archived list
  with Restore.
- Month figures come from `lib/activity.ts` (`accountMonthFlow`,
  `categoryMonthTotals`), 7 unit tests. Strings in all 8 full locales.
- **Checked:** `tsc`, `oxlint` (no new warnings), 253/253 tests, `vite
  build`; headless Chromium at 390px against the dev server, light and
  dark, with accounts created through the new sheet and expenses typed
  into the entry zone: no console errors, focus stays in the sheet's
  fields while typing, Escape closes. Not yet on a phone.

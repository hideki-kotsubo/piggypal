# 23 — Quick-Add Cancel Leaves No Record, Explicit "Done" Button

## The problem

Two related reports about `/transactions/:id` (docs/17), both about leaving
the screen:

1. Home's "+" (docs/19) inserts a blank `$0.00`/uncategorized transaction
   immediately, then navigates to its edit screen. Docs/19 deliberately
   made that row "real the instant it's created," matching tap-entry's
   existing live-row convention (docs/16 D94). But if the user backs out
   without ever setting a real amount, that row survives — a real
   `$0.00`, uncategorized transaction is left behind that nobody meant to
   record. Reported directly: "if the user cancels the action, no record
   should be saved."
2. Every field in `TransactionEditForm` autosaves on change (no separate
   save step), which is correct for existing rows but gives the screen no
   visible "you're done, this is saved" affordance — the only way to leave
   is an app-bar back arrow that doesn't read as a save action. Reported:
   not clear the data has been saved while typing, or that the back arrow
   saves.

## The fix

**Cancel-cleans-up, scoped to `$0.00`.** `TransactionScreen` now owns a
single `finish()` used by both the back arrow and the new Done button: if
the transaction is still exactly `$0.00` when leaving, it's deleted before
navigating back; otherwise the (real) row is left as-is. This isn't a
general "discard unsaved edits" undo — every other field still autosaves
immediately, unchanged. `$0.00` is a safe, narrow trigger because every
other entry path in the app (tap-entry, typed/voice parse-preview) already
requires a nonzero parsed amount before it ever inserts a row — a `$0.00`
transaction can only exist here, as an untouched quick-add. Confirmed via
Playwright: tapping "+" then leaving via either the back arrow or Done
with no edits leaves the transaction list unchanged in both cases; setting
a real amount first and then tapping Done persists it as the new most-
recent transaction.

**Explicit "Done" button.** `TransactionEditForm` gained a `form-actions`
footer with a `save-btn`-styled "Done" button (same primary-action styling
`AccountsScreen`/`CategoriesScreen` already use), calling the same `onDone`
the back arrow now shares. It doesn't change what autosave already does —
it's a second, more prominent way to leave that reads as "finished," and
the one that also carries the `$0.00`-cleanup behavior.

## Decisions locked in this doc

| # | Decision | Why |
|---|---|---|
| D105 | Leaving `/transactions/:id` (back arrow or Done) deletes the transaction if its amount is still exactly `$0.00` | A quick-add row is real the instant it's created (docs/19), but every other entry path requires a nonzero amount to insert at all — `$0.00` uniquely identifies an untouched quick-add, so cleanup can key off it without a separate draft/dirty-tracking concept |
| D106 | This is not general "discard on cancel" — every other field keeps autosaving immediately, unchanged | Docs/16 D94's "everything is a live row" convention stays intact for any row that ever had a real amount; only the narrow `$0.00` case is new |
| D107 | `TransactionEditForm` gets an explicit `save-btn`-styled "Done" button at the bottom, reusing the back arrow's `finish()` | Autosave alone gave no visible confirmation the data was saved or that leaving was safe; a primary-styled button matches the pattern already used in AccountsScreen/CategoriesScreen |

**Implemented 2026-08-13.**

# 19 — Quick-Add Skips the Inline Panel

## The problem

Docs/17 made tap-entry auto-navigate to a transaction's dedicated screen
right after submit, but the submit itself still worked the old way first:
tap "+" (well, the old full-width entry-trigger) → an inline panel opens
(account/currency picker, amount keypad, category chips) → tap a category
chip → *that* both submits and triggers the navigate. In practice this
meant two full interactions (fill the pad, then tap a category) before
ever reaching the screen that actually holds every field — an unnecessary
middle step once that screen exists and already has everything editable
in one place.

## The fix — "+" creates a blank transaction immediately

`EntryZone.tsx`'s old collapsed/expanded toggle (`.entry-trigger` →
`.keypad-panel` with `AccountCurrencyPicker`/`AmountKeypad`/
`CategoryPicker`) is gone. In its place, one persistent row: a "+" button,
the typed-entry field, and the voice mic button, all always visible — no
more tap-to-reveal step.

Tapping "+" creates a transaction right away — `amountCents: 0`,
`categoryId: null`, default account/currency (`store.defaultAccountId()`/
`defaultCurrencyFor`), `occurredAt` = now — and navigates straight to its
`/transactions/:id` screen (docs/17), where amount, category, account,
currency, date/time, note, and location are all filled in directly. Same
"everything is a live row, nothing is an unsaved draft" convention docs/16
D94 already established for this app — the blank row is real the instant
it's created, exactly like tap-entry's old category-chip submit always
was, just one step earlier in the interaction. A known, accepted
consequence: backing out of a "+" tap without entering anything leaves a
real $0, uncategorized transaction behind (counted in the Inbox banner)
until it's deleted or given a category — not a bug, the same tradeoff the
rest of the app already makes everywhere else.

Typed/voice entry (docs/16) is untouched — still its own parallel path
with Tier 1 parsing and its own toast+undo, just visually merged into the
same always-visible row instead of sitting behind the old expand toggle.

## A genuine $0 edge case in `TransactionEditForm`

`TransactionEditForm`'s direction detection was `amountCents < 0 ?
'expense' : 'income'` — fine for any real, already-entered transaction
(never exactly $0), but a brand-new blank one *is* exactly $0, and `0 < 0`
is `false`, so it defaulted to income. Changed to `<= 0`, so digit entry
starts with the right (expense) sign from the first tap. No behavior
change for any existing transaction — none of them are ever exactly zero.

## Decisions locked in this doc

| # | Decision | Why |
|---|---|---|
| D95 | "+" creates a blank transaction immediately and navigates to its docs/17 screen, replacing the inline amount-pad/category-chip panel entirely | The dedicated screen already holds every field; stopping at a smaller inline panel first was a redundant middle step |
| D96 | `TransactionEditForm`'s direction defaults via `amountCents <= 0`, not `< 0` | A blank transaction is genuinely $0, a state no real transaction is ever in — expense is the right default, matching tap-entry's old behavior |
| D97 | Typed/voice Tier 1 entry (docs/16) is unchanged in behavior, only unified into the same always-visible row as "+" instead of sitting behind a collapse/expand toggle | Two parallel entry paths (quick-add-then-fill-in vs. type-or-say-and-parse) still make sense side by side; only the old two-state toggle UI was the problem |

**Implemented 2026-08-13.**

# 32 — Entry Zone: More Breathing Room in the Parse-Preview

## The ask

From the Home-directions design exploration's Polish Pass (direction A):
just the spacing half of "tighter type/spacing, soft elevation" — the
user explicitly scoped this down to spacing only, not the soft-elevation
shadow or the serif tabular amounts A also explored.

## The fix

`.parse-preview`'s outer padding, `.parse-fields`' row gap, `.parse-label`'s
bottom margin, and `.parse-actions`' top margin all increased a notch
(`app/src/styles/home.css`). The idle input row and the buttons
themselves are untouched here — docs/31 already sized those up separately
when the docked composer first read as squeezed; this pass is specifically
the "understood" fields block feeling cramped once expanded. No shadow,
no typography change — deliberately narrower than direction A's full
polish pass, per the user's explicit scope.

**Implemented 2026-08-19.** Verified: `tsc -b`/`oxlint` clean; the real
dev server hit directly and screenshotted with the parse-preview expanded,
confirming visibly more room between field rows and around the block
without affecting the idle state or any other screen.

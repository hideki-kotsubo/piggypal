# 37 — Day Groups as Sunken Cards

## The ask

After a plain full-bleed hairline rule was tried and rejected as still too
weak a section break, four bolder alternatives were mocked up
(`docs/artifacts/piggypal-day-group-separation.html`: sunken card, pill
label, bold serif heading, left accent spine). The user's call, after
also weighing whether to make it a user-selectable setting (declined —
unlike Light/Dark, this isn't something anyone would toggle session to
session, so it isn't worth carrying four parallel treatments forever for
a choice made once): **sunken card per day**.

## The fix

Each day's rows now render inside a `.day-card` — border, `--radius-lg`,
`--surface-sunken` background, `overflow: hidden` — the exact same
"sunken zone" recipe the app's own entry-zone card already uses, in both
`RecentList.tsx` and `TransactionList.tsx`. `.tx-row:last-child`'s
existing rule drops the border on each card's own final row for free,
since `:last-child` now resolves per-card instead of per-flat-list —
no new selector needed there.

One real deviation from the design mockup, flagged rather than applied
silently: the mockup showed the day-label as the card's own header,
*inside* the bordered box. Implemented instead with the label as a
**separate sticky element above the card** (unchanged from docs/34),
not inside it. Reasoning: a label that's both `position: sticky` and
enclosed inside a bordered, radius'd box looks broken once the card's
own rounded top edge has to scroll underneath a header that's pinned to
the screen edge — the two visual languages (floating sticky bar vs.
enclosed card) fight each other. Keeping the label outside preserves the
already-shipped sticky behavior (docs/34) cleanly instead of trading it
away for the card, and reads as the more coherent app-wide pattern.

**Implemented 2026-08-19.** Verified: `tsc -b`/`oxlint` clean; both real
screens screenshotted, confirming the card renders identically to the
approved mockup; re-confirmed sticky headers still work correctly
stacked with the new cards — screenshotted at three scroll depths on
`/transactions` with 10 seeded transactions across 7 days, each label
pinning until its own day's card fully scrolls past and the next label
takes over, same mechanism as docs/34, now with cards scrolling
underneath instead of a flat row list; Settings re-checked unaffected.

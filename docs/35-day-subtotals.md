# 35 — Per-Day Subtotals

## The ask

The third idea from docs/33's "make a new section clearer" discussion,
logged to the backlog and now built: a running total next to each day
divider, e.g. "TODAY  -$41.25."

## The fix

`.day-label` is now a flex row: the existing label text on the left,
`totalsByCurrency()` (already existed, `filterTransactions.ts`, used by
the totals-row elsewhere) on the right — one amount per currency present
that day, joined with " · ", never blended across currencies (docs/10,
same rule as everywhere else in this app).

One real correctness risk, specific to Home's `RecentList`: it caps to
`PREVIEW_COUNT` (5) transactions, so the *last* visible day group can be
a partial slice of that day's real transactions — summing only the
visible rows would silently show the wrong total for a day that has more
entries than made it into the preview. Fixed by computing subtotals from
the full unfiltered `active` list, keyed by `formatRelativeDate`'s label
(a stable per-day string — the same property `groupByDay` itself already
relies on for its own grouping), and looking each rendered group's total
up from there rather than summing whatever subset happened to render.
`TransactionList` doesn't have this problem — `filtered` is the complete
result set, never truncated — so its subtotal is just
`totalsByCurrency(group.items)` directly.

**Implemented 2026-08-19.** Verified: `tsc -b`/`oxlint` clean; added a
same-day transaction via the real entry flow and confirmed Today's
subtotal updated to the correct sum (-$32.00 + -$9.25 = -$41.25, not just
one or the other); confirmed a multi-currency day (CAD + BRL) renders
both amounts separated correctly, not blended; Settings re-checked
unaffected.

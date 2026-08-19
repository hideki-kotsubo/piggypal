# 33 — Day-Grouped Timeline, Home and Transactions

## The ask

From the Home-directions design exploration's direction B (day-grouped
timeline): the user asked for it implemented in both places a transaction
list appears with a date attached — Home's Recent list and the full
`/transactions` search/filter screen (docs/18) — not just Home.

## The fix

`groupByDay()` (`app/src/lib/format.ts`) buckets an already
occurred-at-descending-sorted list into day groups, one per calendar date.
It keys each bucket by the transaction's actual local `YYYY-MM-DD` date
(not `formatRelativeDate`'s display string) so two transactions on the
same month-day a year apart never collide into one group — a real edge
case this app's own 18-month local retention window makes plausible, not
hypothetical. `formatRelativeDate` still supplies each bucket's display
label ("today"/"yesterday"/"N days ago"/"Mon D"), reused as-is — its
existing output already reads correctly as a day-divider heading once
CSS uppercases it, no new formatting needed.

Both `RecentList.tsx` and `TransactionList.tsx` now render
`groupByDay(...)` instead of a flat `.map`, each list's rows wrapped in a
`<Fragment key={group.label}>` under a new `.day-label` divider (small-caps
mono, matching `.section-label`'s vocabulary but scoped for use *inside*
`.recent`, which already carries the horizontal margin). Each row's own
meta line drops the now-redundant relative-date text the divider already
conveys: Home's rows show just the account; the Transactions list keeps
`category · time · account` — time-of-day is still genuinely new
information the divider doesn't carry, so it stays.

**Implemented 2026-08-19.** Verified: `tsc -b`/`oxlint` clean; both real
screens hit directly on the dev server and screenshotted — Home's Recent
(collapsed to 5 items, still spans 4 day groups) and `/transactions`
unfiltered (5 items, same 4 groups, `category · time · account` meta
confirmed correct) — plus Settings re-checked unaffected.

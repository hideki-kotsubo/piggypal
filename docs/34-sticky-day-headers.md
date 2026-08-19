# 34 — Sticky Day Headers

## The ask

Following up on docs/33's day-grouped timeline: how to make a new
section's start clearer. Discussed three options (a hairline rule, sticky
headers, a per-day subtotal) — the other two logged to
`docs/00-backlog.md`, this one built: sticky headers, since it's the one
that actually solves "clearer when a new section begins" while scrolling,
not just in a static screenshot.

## The fix

`.day-label` (`app/src/styles/home.css`) gets `position: sticky; top: 0`
plus an opaque `background: var(--surface)`. Standard browser behavior
handles the header-stacking for free — each label sticks to the top of
the viewport until the next group's rows push it off, same pattern as
iOS Contacts/Messages date headers — no JS/scroll-listener needed, since
every group's label and rows are plain siblings in one continuous list
(`RecentList`/`TransactionList` already render them that way for
docs/33).

One real detail that would've broken it silently: the label's vertical
spacing was `margin`, not `padding`. Margin sits outside an element's own
box — transparent, no background — so a stuck label with margin would let
rows scrolling underneath show through the gap above it. Switched to
`padding` so that space is inside the label's own opaque box instead;
`.day-label:first-child`'s override moved from `margin-top` to
`padding-top` to match.

**Implemented 2026-08-19.** Verified against real content, not just the
existing 5-row seed (too short to meaningfully scroll): added 7 more
transactions spanning back to "9 days ago" via the real typed-entry
parser, confirmed on `/transactions` (12 transactions, 9 day groups) by
screenshotting at several scroll positions — "Today" stays pinned past
its natural scroll position, then gets cleanly pushed off and replaced by
"Yesterday" once its rows scroll past, matching the intended stacking
behavior exactly. `tsc -b`/`oxlint` clean (CSS-only change).

# 20 — Inbox Matches the Search List's Row Style

## The problem

`InboxScreen` predates docs/17's dedicated transaction screen. When it was
built (docs/07 D26), there was no full edit screen to send someone to, so
each inbox row carried its own always-expanded `CategoryPicker` inline —
tap a chip, categorize in place. That meant every pending row rendered a
full category-group chip cluster (7 top-level groups from the current seed
taxonomy) stacked one after another, which reads as cluttered/heavy with
more than a couple of pending items, and reported as "weirdly displayed
with categories exposed."

Reported alongside it: previously-categorized items appearing to resurface
as uncategorized. The actual mechanism (not a data-corruption bug):
`InboxScreen` snapshotted the list of uncategorized ids **on mount** and
kept rendering that frozen list for the rest of the visit, dimming an item
to "✓ Categorized as X" once picked rather than removing it — deliberately,
per D26, so a row didn't vanish out from under a picker you were mid-tap
on. Revisiting the screen re-snapshots fresh, so nothing was ever actually
losing its category — but a long-lived visit accumulating several
now-dimmed "done" rows next to genuinely-pending ones is easy to misread
as "categorized things coming back."

## The fix — same tappable-row style as TransactionList/RecentList/Search

`InboxScreen` now renders each pending item with the exact same
`.tx-row.tx-row-tappable` markup docs/17/18 already established elsewhere
— note/raw-utterance, date+time, account, amount — as a `<Link
to={`/transactions/${t.id}`}>`. Tapping a row goes to the transaction's
full edit screen (docs/17) to pick a category (or fill in anything else)
there, instead of an inline picker.

This also **supersedes docs/07 D26's snapshot/dim mechanic entirely** —
worth flagging since it's a real reversal, not just a restyle. The
snapshot existed only to keep a row from disappearing out from under an
inline picker on the same screen. Once categorizing happens on a different
screen, coming back via Back naturally remounts `InboxScreen` and
recomputes its list fresh — a plain live filter (`categoryId === null`,
matching every other list in this app) is simply correct now, no
bookkeeping needed. Confirmed via Playwright: categorizing an item from
its edit screen and returning to Inbox drops the count immediately and
correctly, with nothing stale left behind.

`t.aiRaw ?? t.note ?? 'Uncategorized'` is kept as the row's main line
(rather than switching to `TransactionList`'s plain `t.note`, which would
just read "Uncategorized" for every row here) — the raw-utterance
visibility D26 valued is still worth keeping, only the inline-picker/
stays-put mechanism is gone.

## Decisions locked in this doc

| # | Decision | Why |
|---|---|---|
| D98 | Inbox rows use the same tappable-row style as TransactionList/RecentList/Search, linking to the docs/17 edit screen, instead of an inline always-expanded `CategoryPicker` per row | A full category-group chip cluster per row reads as cluttered once there's more than a couple of pending items; the dedicated edit screen (which didn't exist when D26 was written) is the better place to pick a category |
| D99 | Supersedes docs/07 D26's snapshot-on-mount/dim-to-done mechanic — Inbox is now a plain live filter, like every other list in the app | The mechanic only existed to protect against a row disappearing out from under an inline picker on the same screen; that scenario no longer exists once categorizing happens on a separate screen |
| D100 | The row's main line stays `aiRaw ?? note ?? 'Uncategorized'`, not a plain copy of `TransactionList`'s `note`-only line | An uncategorized row's `note` is almost always empty/generic — the raw utterance is the actually-useful context D26 was right to surface |

**Implemented 2026-08-13.**

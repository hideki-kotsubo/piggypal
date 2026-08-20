# 38 — Household Payer/Owner UI, Implemented

## The problem

docs/26 sketched where `paid_by_user_id`/`created_by_user_id`/`owner_user_id`
(docs/24 D110) become visible once a household has 2+ members, but was
explicitly "sketch only — no component/JSX/schema changes." Those columns
have been real and populated since docs/25's P2P merge landed
(2026-08-14) — but with no UI ever built against them, a real merge with
another person showed every account/transaction exactly as if it were
still solo: no payer badge, no owner label, nothing to say whose data any
of it was. Reported 2026-08-19 after the user actually merged two
real people's devices and noticed the columns' effects were invisible.

## What "household" means here, concretely

docs/24's `households`/`household_members` tables and `household_id`
sync-partition column are still fully unbuilt — this doc doesn't touch
either. Instead, "does a household exist" and "who's in it" are both
derived from `peers.ts`'s `PairedPeer` list, filtered to
`identityMode === 'someone-else'` (`lib/household.ts`):

- **`hasHousehold(peers)`** — true once this device has synced with at
  least one real other person. Operationalizes D110's "only shown once a
  household has 2+ members" gate without the still-missing data model.
  `'own-device'` peers are deliberately excluded — per docs/25 D125-127
  they're the same person under a unified identity, never a second member.
- **`householdMembers(peers)`** — you (`getLocalUserId()` +
  `effectiveDeviceLabel()`) plus each `someone-else` peer.
- **`personLabel(userId, peers)`** — resolves any `paidByUserId`/
  `createdByUserId`/`ownerUserId` value back to a display name. Works
  because `PairedPeer.id` is the peer's real `getLocalUserId()` (docs/25
  D138), the same id docs/24's merge writes into these columns — no new
  identity mapping needed.

## What's implemented

Following docs/26's D121-124 exactly, reusing its mockup's own CSS
(`docs/artifacts/piggypal-household-sharing.html`) near-verbatim:

1. **Payer badge on list rows** (`RecentList.tsx`, `TransactionList.tsx`,
   new `PayerBadge.tsx`) — filled/accent circle = paid by you, outline =
   paid by the other member, absent entirely below 2 members (D121).
2. **Transaction edit screen** (`TransactionEditForm.tsx`) — "Paid by"
   as a tappable chip row (`paid_by_user_id` is mutable), "Logged by
   `<name>`" as an italic caption with no tap target (`created_by_user_id`
   is immutable) (D122).
3. **Accounts list** (`AccountsScreen.tsx`) — `owner_user_id` renders as a
   name prefix in the row's existing name slot ("Bob's Phone —
   Checking"), for every account once a household exists, not only
   others' — matches D123 and docs/24's own worked example (D110's
   worked-example line: `owner_user_id` shown "only once a household has
   2+ members"). Applied to both the active and archived-accounts lists.
4. **Settings → Household** (`SettingsScreen.tsx`) — new read-only
   section, badge + name per member, "you" tag on your own row. No
   invite/leave actions, same as D124.

## One deliberate deviation from the docs/26 mockup

The mockup's "Logged by Bob · yesterday, 6:42pm" caption pairs the name
with a creation timestamp. This app has no such timestamp locally —
`transactions` has no `created_at`/`logged_at` column, only
`occurred_at` (the user-editable transaction date/time, not a log time).
Rather than add a new synced column and fold it into docs/24's merge
rules as an unplanned scope expansion, or fabricate a fake time, the
caption here is narrower: **"Logged by `<name>`"**, name only. Flagged
here rather than silently diverging from the sketch, per this project's
own working-style rule.

## Verified

Real Playwright pass (not just `tsc`/`oxlint`, though both are clean) —
since a live two-person merge isn't practical to script, a fake
`someone-else` peer was added via `localStorage` and a fake account +
transaction inserted directly through the app's own `PowerSyncDatabase`
instance (`db.execute`, dynamically imported the same way the app itself
does), simulating exactly what a real docs/24 merge writes:

- Solo state (no peers) renders with zero badges/prefixes/sections and no
  layout shift — confirmed via screenshot against unmodified seed data.
- Once a `someone-else` peer exists: list-row badges render with the
  correct computed styles (`payer-badge theirs` → white fill/gray border;
  `payer-badge mine` → accent fill), the account owner prefix appears
  correctly per-account (including on the device's *own* accounts, not
  only the peer's), and Settings' Household section lists both members
  with the right badge/label/you-tag.
- Tapping a different "Paid by" chip commits immediately and the
  Recent/Transactions list badge updates live with no manual reload
  (PowerSync's live query reactivity) — verified by reading the DOM
  before/after the click plus a follow-up navigation.
- Dark theme re-checked (Settings' Household section) — correct contrast,
  no washed-out badges.
- Zero console errors across the whole pass.

Not verified because there's no UI to produce the case yet: a real
account whose `owner_user_id` differs from its own device's local
history but *isn't* the peer currently paired (would require a real
three-way merge) — considered low-risk since `personLabel`'s fallback
("Household member") already covers an unresolvable id gracefully.

## Not in scope, still open

- No UI to *edit* `owner_user_id` after account creation — docs/24 line
  63 calls it "editable in the account edit form," but docs/26 never
  designed that control and this pass didn't add one. An account's owner
  is set once at creation (`getLocalUserId()`) or arrives fixed via merge.
- No creation timestamp for "Logged by" (see deviation above).
- Everything docs/26 itself already scoped out: invite/pair/leave UI
  (docs/25's territory), balance/settlement math, per-person color system
  beyond mine/theirs.

## Follow-up, same day: Reset local data forgot to forget peers

Reported right after the above shipped: Settings' "Reset local data" (a
dev-stage wipe-and-reseed, `store.tsx`'s `resetLocalData`) deletes every
SQLite table but never touched `peers.ts`' `localStorage`-backed paired-
peers list — so resetting left a peer row pointing at data that no longer
existed, and the new Household section above kept showing a "household"
that, from this device's fresh-seed perspective, had never actually
happened. Fixed with a new `clearPairedPeers()` export (`lib/peers.ts`),
called from `resetLocalData` alongside the table wipes; the confirm
dialog's copy was also updated to say it forgets paired devices, since
that's a real, user-visible consequence of tapping it now. Verified with
Playwright: seeded a fake peer via `localStorage`, confirmed Settings'
Paired-devices/Household sections both render, tapped Reset, confirmed
the dialog copy, and confirmed `localStorage`'s peers key is `null` and
both sections are gone post-reload — zero console errors.

**2026-08-19.**

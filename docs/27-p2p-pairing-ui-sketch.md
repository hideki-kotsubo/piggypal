# 27 — P2P Device Pairing: UI Sketch

## The problem

docs/25 locked the transport (WebRTC + QR-code signaling) and its D125-D127
addendum locked the identity fork ("your own device, or someone else's?"),
but neither doc said what a person actually taps through. Before writing
any WebRTC/camera code, this sketches the screen sequence — same
brainstorm-before-build pattern docs/07, 12, 13, 15, and 26 already used.

## The sketch

`docs/artifacts/piggypal-p2p-pairing.html` — five frames, same phone +
numbered-pin + legend format as the sketches before it:

1. **Settings entry point** — a single "Connect a device" action, plus a
   paired-devices list showing a returning peer's last-synced time. Same
   entry point regardless of what happens next (own device, new household
   member, or re-syncing someone already paired).
2. **The fork (D125)** — "Who are you connecting with?" as two large
   tappable cards, not a buried toggle, since it's the one choice that
   decides everything downstream: identity unification vs. staying
   distinct.
3. **Show your code** — this device's QR (its WebRTC offer), a live
   "Waiting for scan…" status, and an explicit "works with no internet
   connection" note — the fully-offline case D117 designed for, made
   visible rather than assumed.
4. **Scan + merge prompt (D126)** — the other device's camera view, with
   the "merge this device's existing data?" sheet appearing on top once
   connected. Only appears in own-device mode with pre-existing data;
   mirrors docs/05 D14's exact non-destructive default ("keep separate"
   discards nothing).
5. **Synced** — the confirmed state, gated on both sides' acks per D118,
   with the peer list from frame 1 now showing the new device. Establishes
   that every sync *after* the first is a one-tap action on that peer row,
   not a repeat of frames 2-4.

## What this doc is not

Not a transport or identity-model change — docs/25's D115-D127 are
untouched, this only sequences the screens that already-locked design
implies. Not an implementation — no component, JSX, or WebRTC/camera code
was written, only the standalone mockup. Two things stay deliberately
undesigned here, both already flagged in docs/25 and repeated in the
artifact's own scope note: relay-assisted remote signaling (every frame
assumes both devices are physically together) and peer management — rename
/forget/manual re-sync affordances on frame 1's peer row aren't drawn
beyond the minimum needed to establish that a "returning" state exists.

## Decisions locked in this doc

| # | Decision | Why |
|---|---|---|
| D128 | The own-vs-someone-else fork (D125) is a full-screen choice between two large cards with consequence copy, not a compact toggle or radio pair | It's the single highest-stakes tap in the whole flow — gets identity wrong here and everything downstream (badges, account ownership) is wrong too. Deserves more visual weight than a settings toggle |
| D129 | The QR screen explicitly states "works with no internet connection" | D117's fully-offline capability was a real design decision, not just a fallback — surfacing it in the UI is what makes it a felt guarantee rather than trivia buried in a doc |
| D130 | The merge-prompt sheet (frame 4) reuses a bottom-sheet pattern over a dimmed camera view, rather than blocking navigation to a separate screen | Keeps the physical pairing moment (both people holding phones up) uninterrupted — a full screen transition here would break the "scan and you're basically done" feel the QR ceremony is going for |
| D131 | Frame 5's peer list is the same component as frame 1's, just with a new row | Establishes explicitly that pairing is a one-time ceremony per peer — subsequent syncs reuse the entry point, they don't re-enter the fork |

**Implemented, 2026-08-14** — `PairingScreen.tsx` builds this sketch for
real (frames 2-5; frame 1's entry point lives in `SettingsScreen.tsx`).
One deviation from the sketch surfaced during implementation and is
documented in the component's own top comment: a real handshake needs
both devices to show *and* scan (whoever goes first shows-then-scans, the
other scans-then-shows-back), so there's an added "show mine first / scan
theirs first" choice between frames 2 and 3 that the sketch simplified
away. Frame 4's D126 merge-prompt sheet is not built yet — deferred along
with the rest of D125-D127's identity unification, see docs/25's own
updated status note. See docs/00-backlog.md for the full verification
summary.

**2026-08-14.**

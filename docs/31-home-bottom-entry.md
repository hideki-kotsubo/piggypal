# 31 — Home Entry Zone Docked to the Bottom

## Status: kept — merged into main 2026-08-19

Built on its own branch (`home-bottom-entry-overlay`) at the user's request
after reviewing the Home-directions design exploration
(`docs/artifacts/piggypal-home-directions.html`, direction C and its two
composing-state variants), evaluated hands-on, and confirmed: "Like it.
keep it and merge." This graduates the trial into a real decision,
superseding docs/07's original entry-zone placement (D22-26) — the entry
zone now docks to the bottom of Home instead of living at the top.

## What changed

The entry zone (`EntryZone.tsx`, unchanged internally) is no longer the
first thing on Home — it's docked to the bottom of the screen instead,
chat-input style. `App.tsx` moved it after `RecentList` in source order
and wraps it in a new `.entry-zone-dock`, `position: fixed; bottom: 0`,
centered independently to match `.home`'s own `max-width: 480px` column
(`.home` never sets its own `position`, so a fixed child positions
relative to the viewport, not to it). `InboxBanner`/`RecentList` now
render right after the app bar, matching the design exploration's layout.

This implements the **overlay** variant specifically, not push/shrink:
the dock sits on top of the scrolling content via `position: fixed`, not
inside the normal document flow, so Recent's scroll extent is never
reflowed. The tradeoff discussed with the user before building this:
nothing is ever hidden behind a scrim, but the parse-preview's expansion
(unchanged mechanic — it's the exact same card, same `<sc-if>`-equivalent
React conditional as before, just now anchored bottom instead of top)
genuinely covers whatever's behind it. No scrim was added on purpose —
matches this app's "quick capture, data still visible" feel, and dimming
would fight the "still see your data while typing" reasoning docs/07 D24
already established for the old top-anchored version. Deliberately
untouched: the "+" quick-add flow — it navigates straight to
`/transactions/:id` (docs/19) and never touched the inline preview to
begin with, so anchor-edge doesn't affect it.

Two real integration bugs found and fixed while building this against the
actual running app (not just the mockup):

1. **The parse-preview does genuinely cover Recent rows while composing**
   — confirmed directly (typed "12.50 coffee at Starbucks," the expanded
   card covered everything below "Salary"), exactly as flagged in the
   design exploration. Not a bug, the expected tradeoff — recorded here
   as the thing to actually judge during the trial.
2. **`.toast`'s existing `bottom: 1.5rem` rendered underneath the new
   dock** (both fixed to the screen bottom, dock stacks on top) — the
   "Added · Undo" toast was invisible behind the composer on every save.
   Fixed with `.toast-above-dock` lifting it to `bottom: 5.5rem`,
   Home-only. First attempt used a single-class selector and silently
   lost the cascade to `.toast`'s own later-declared rule at equal
   specificity (same-specificity, source-order tiebreak) — fixed by
   raising specificity (`.toast.toast-above-dock`) instead of relying on
   file ordering.

`.home-with-dock` (Home-only, not bumped onto every screen sharing the
bare `.home` class) adds `padding-bottom: 5.5rem` so Recent's last row/
"see all" link doesn't sit flush against the dock at rest.

## Open items, not resolved by the decision to keep this

The user's "keep it" call was made from this sandboxed environment's
browser checks — the same real-device open items flagged during the
trial are still genuinely open, not settled by the decision itself:

- Whether the parse-preview genuinely covering Recent rows (not just
  docs/07's original "still see your data" framing, now literally
  obscured while composing) holds up in extended real use.
- One-handed reach — the actual motivating reason for this direction —
  on a real phone, not just the desktop browser check this was verified
  with here (no real-device pass done yet).
- Whether the keyboard-competition risk flagged in the design exploration
  (an on-screen keyboard is typically 260-330px, stacked under an already
  ~300px-tall expanded card) is a real problem on an actual device — not
  reproducible in this sandboxed check.

## Decisions locked in this doc

| # | Decision | Why |
|---|---|---|
| D159 | Home's entry zone docks to the bottom of the screen (fixed, chat-input style), superseding docs/07 D22-26's top-of-page placement | User's explicit call after reviewing the Home-directions design exploration and trying the live implementation |
| D160 | The overlay variant specifically (composer floats over Recent, no scrim, list never reflows) rather than push/shrink | Matches the "quick capture, data still visible" reasoning docs/07 D24 already established; push/shrink's per-keystroke layout reflow was the less-preferred alternative surfaced during the design review |

**Revised same day**: the initial pass reused `.entry-zone`'s original
sizing (2.2rem buttons, tight row padding) verbatim, which read as
squeezed once docked against the screen edge — the user flagged it after
trying the live version. Bumped docked-only (`.entry-zone-dock
.entry-input-row/.add-btn/.mic-btn/.entry-input`, not the shared base
rules, which stay their original size for wherever `.entry-zone` is used
un-docked): buttons 2.2rem → 2.5rem, more row/input padding, dock's own
outer padding roughly doubled. `.home-with-dock`'s bottom spacer and
`.toast-above-dock`'s offset both bumped to match the taller idle dock
(confirmed via real bounding boxes: toast's bottom edge and the dock's
top edge now have an ~11px gap, not touching).

**Implemented 2026-08-19, branch `home-bottom-entry-overlay`.** Verified:
`tsc -b`/`oxlint` clean; the real dev server hit directly and screenshotted
through idle → typed → expanded-preview → Save states, confirming the
toast fix and that other screens sharing `.home` (checked: Settings) are
unaffected. Not verified: a real mobile device, or the keyboard-overlap
scenario itself (no real virtual keyboard in this environment).

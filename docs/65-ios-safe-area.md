# 65 — iOS safe area (status bar overlap)

Reported 2026-10-09 from the first native iOS run (and visible on the
home-screen PWA): the app bar sat under the iPhone's status bar, with the
clock and signal icons drawn over the title.

## Cause

The viewport didn't opt in with `viewport-fit=cover`, so iOS reported
every `env(safe-area-inset-*)` as 0, and no CSS padded for the top inset
anyway. Capacitor's web view (default `contentInset: never`) fills the
whole screen, status bar included.

## Fix (D241)

- `index.html`: `viewport-fit=cover`.
- `.home` (every screen and the loading skeleton use it) pads its top by
  `env(safe-area-inset-top)`.
- `body::before`: a fixed strip of that height in `--surface`, so content
  scrolling up doesn't show through behind the clock.
- Sticky day headers (docs/34) stick at `top: env(safe-area-inset-top)`,
  below the strip; the toast clears `safe-area-inset-bottom`. The bottom
  dock already did (docs/31).

Everything is 0 where there's no inset (desktop, Android), so nothing
moves there.

Verified with headless renders: no inset (unchanged), a simulated 47px
inset, and scrolled with sticky headers. Not verified on a real iPhone.

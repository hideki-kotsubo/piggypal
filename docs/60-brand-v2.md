# 60 — Brand v2: new icon, wordmark and app name

Replaces docs/52 D195's "flowing line to a dot" mark, and the "F" mark
that followed it (2026-09-14). Applied 2026-10-09.

## The assets

The user supplied three rasters in `docs/logo/`:

| File | Size | What |
|---|---|---|
| `v2-icon.png` | 637×637, opaque | Full-bleed square: three waves on a green gradient |
| `v2-logo.png` | 1093×335, transparent | Rounded-square icon + wordmark |
| `v2-wordmark.png` | 841×332, transparent | Script "flow" (greens) + "tab" (grey) |

Colours sampled from them: gradient `#2fcba4` → `#6be9a9`, dark wave
`#125251`, light wave `#cbf7de`.

There's no vector source, and the icon is smaller than the 1024×1024 the
App Store requires, so the master is upscaled with lanczos3 (D227). Flat
shapes and a soft gradient survive that well, but a ≥1024px (ideally
vector) export should replace it before the first store submission.

## What changed

**One generator, from `docs/logo/`** (D227): `app/scripts/build-brand-assets.mjs`
writes every input from `v2-icon.png`. Re-run it, then
`npx capacitor-assets generate --ios --android --assetPath resources`,
whenever the icon changes.

- `resources/icon-only.png`: the 1024² master (iOS rounds it itself).
- `resources/icon-background.png` + an empty `icon-foreground.png`: Android
  adaptive icons. Capacitor's `ic_launcher.xml` insets both layers 16.7%,
  so a layer image fills exactly the visible window, and the full icon
  works as the background as-is. The waves stay inside the middle 60%,
  clear of circle and squircle masks (checked on renders of both).
  An earlier attempt pre-shrank the icon for the 108-unit canvas; with
  the inset that shrank it twice, so it was dropped.
- `resources/splash(-dark).png`: the rounded icon on the app's own `--bg`
  (light `#eef0ea`, dark `#141713`), so the splash matches the first
  screen it hands over to.
- PWA: `public/icons/icon-*.webp` (48–512, 192/512 still
  `any maskable`), `apple-touch-icon.png` (180², opaque), and
  `favicon.png` (64², rounded), which replaces `favicon.svg`. The favicon
  crops in to the middle 64% so the waves stay readable at 16px.
- The old inputs (`icon.png`, `icon-source.svg`, `splash-source.svg`) are
  deleted; git history keeps them.

**Theme colour** (D228): manifest `theme_color` and `index.html`'s
`theme-color` move from the `#3f7d69` placeholder (docs/01 item 5) to the
logo's dark teal wave, `#125251`. `background_color` stays the app's
`--bg`.

**App name** (D229): the native display name was still `piggypal`.
`capacitor.config.ts` `appName`, Android `strings.xml` and iOS
`Info.plist` `CFBundleDisplayName` are now `Flowtab` (`cap sync` doesn't
update existing native projects, so all three are edited).

**Not changed, on the user's call**: the app's own UI colours (sage
palette in `tokens.css`). Only icons, splash and manifest moved to v2.

## Decisions locked in this doc

| # | Decision | Why |
|---|---|---|
| D227 | Every icon/splash input is generated from `docs/logo/v2-icon.png` by one script; the 637px source is upscaled to 1024 | Reproducible; no hand-edited images. Replace the source with a ≥1024px export before store submission |
| D228 | Theme colour is the logo's dark teal `#125251` | Retires the docs/01 item 5 placeholder with a real brand colour |
| D229 | The native app name is `Flowtab` everywhere | Was still the parked `piggypal` brand |

## Verified

- Renders of the generated master, Android adaptive background under
  circle and squircle masks, legacy launcher icons, the iOS 1024 icon,
  both splashes, and the favicon at 64/32/16px on light and dark.
- `tsc -b`, 109/109 tests, `vite build` (manifest has the new theme
  colour and favicon).

Not verified: a real device or simulator install (no Android SDK or
Xcode here), and how iOS/Android launchers actually render it.

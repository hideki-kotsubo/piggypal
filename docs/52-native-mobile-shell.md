# 52 — Native iOS/Android Shell (Capacitor)

## What this closes

The user wants real App Store/Play Store apps, not just the installable
PWA. Weighed Capacitor (wrap the existing `app/` codebase in a native
shell) against a React Native rewrite — Capacitor wins here because it
reuses 100% of the built UI/logic (Home, Inbox, Accounts, Categories,
transaction screens, the Tier 1 parser, P2P pairing) with no rewrite,
versus RN requiring the entire UI layer to be rebuilt from scratch.

## Decisions

- **D191**: Capacitor, not React Native. One codebase, native app-store
  binaries, near-zero UI rewrite.
- **D192**: App ID is **`com.myflowtab.app`** — confirmed directly with the
  user, since Bundle ID (iOS) / `applicationId` (Android) is effectively
  permanent once the first TestFlight/Play Console build is uploaded.
  Note this doesn't match "piggypal" (docs/01 item 5's parked brand) or
  either of the two untracked landing-page explorations sitting in the
  repo root as of this writing (`sayslate-site/`, `wealthkin-site/`) —
  naming is evidently more in motion than the 2026-08-07 "parked" call
  reflects. Not resolved here; flagged in the backlog.
- **D193**: storage backend is **`@powersync/capacitor`** (beta), not the
  plain `@powersync/web` SDK already used elsewhere in this app. Reason:
  the web SDK's OPFS storage has a documented bug specific to Capacitor
  WebViews — OPFS access handles can be closed when the app is
  backgrounded, breaking on resume. PowerSync's own Capacitor SDK
  sidesteps this by auto-detecting the runtime and using native SQLite
  (via `@capacitor-community/sqlite`) on iOS/Android, while still using
  the same WA-SQLite path as `@powersync/web` in a plain browser — so
  `npm run dev:app` is unaffected. **Flagging loudly per this repo's own
  working-style rule**: this SDK is beta. Its web-SDK foundation is
  stable; the native SQLite driver portion is documented as
  "production-ready for tested use cases," not unconditionally.
- **D194** (superseded same day, see D195): app icons/splash were
  initially left as Capacitor's stock template defaults rather than
  generated from piggypal's `favicon.svg`, reasoning that a placeholder
  built from a brand that might not survive contact with
  `com.myflowtab.app` would bake in a probably-wrong identity.
- **D195**: the user confirmed the app's real name is **Flowtab** (not
  piggypal) and asked directly for a real icon, superseding D194's
  wait-and-see call — naming wasn't actually still in flux, it had
  already landed on Flowtab, just not yet said out loud. New mark: a
  single continuous flowing line rising to a point-in-time dot (cash
  "flow" reaching today's running "tab"), white on a teal→indigo
  gradient, deliberately distinct from piggypal's purple. Built as pure
  vector paths (`resources/icon-source.svg`), not a lettered monogram,
  so it rasterizes identically everywhere without depending on which
  fonts happen to be installed wherever it's generated. Checked directly
  against a simulated circular safe-zone crop before use, not assumed —
  the mark clears Android's adaptive-icon safe circle with real margin.

## What's implemented

- `app/capacitor.config.ts` — `appId: 'com.myflowtab.app'`, `appName`
  left as the existing `'piggypal'` placeholder (trivial to change later,
  unlike appId), `webDir: 'dist'` (native shell loads the bundled
  production build directly — fully offline, consistent with docs/01 D1;
  no remote dev-server URL wired in).
- `app/src/lib/db.ts` — `PowerSyncDatabase` import swapped from
  `@powersync/web` to `@powersync/capacitor` (schema/`Table`/`Schema`
  imports stay on `@powersync/web` per the SDK's own docs).
- `app/android/` and `app/ios/` — real native platform projects, added
  via `npx cap add android` / `npx cap add ios`. Both picked up
  `@capacitor-community/sqlite` as a plugin automatically. iOS used
  **Swift Package Manager** (`Package.swift`), not CocoaPods — Capacitor
  8's default — so there's no `pod install` step or Ruby/CocoaPods
  dependency at all, better than expected going in.
- New dependencies in `app/package.json`: `@capacitor/core`,
  `@capacitor/ios`, `@capacitor/android`, `@capacitor/cli` (dev),
  `@powersync/capacitor`, `@capacitor-community/sqlite`.
- **The Flowtab icon (D195)**: `app/resources/icon-source.svg` (1024×1024
  master) and `splash-source.svg`, rasterized via `sharp` to
  `resources/icon.png` / `splash.png`, then run through
  `@capacitor/assets generate` (new devDependency — all of its flagged
  `npm audit` issues are dev-tooling-only, `npm audit --omit=dev` is
  clean). That regenerated every iOS/Android launcher icon and splash
  screen in `app/android/`/`app/ios/` in place, plus a PWA `icons/` set
  (webp, 48–512px). Wired into the web app too, not just native: the
  generator's own PWA-icon output landed outside `public/` and included
  a stray, wrong-path `manifest.webmanifest` assuming a non-Vite-plugin
  workflow — moved the icons into `public/icons/` and deleted the stray
  manifest rather than keep dead/misleading output. `vite.config.ts`'s
  manifest `icons` array now lists the full webp set (192/512 marked
  `any maskable`, matching the verified safe-zone check), `favicon.svg`
  is the same mark instead of piggypal's old artwork, and a generated
  180×180 `apple-touch-icon.png` is linked from `index.html` for iOS
  home-screen installs. `name`/`short_name`/`theme_color`/
  `background_color` deliberately untouched — still say "piggypal,"
  since renaming those is a separate task from making an icon.

## Verified

Only what's possible without a native toolchain:

- `npx tsc -b`, `npm run -w app lint` (oxlint), `npm run -w app build`
  all clean after every change above (one pre-existing, unrelated
  fast-refresh lint warning in `store.tsx`, unchanged).
- `npx cap add android` / `npx cap add ios` both completed with no
  errors or manual fixups needed.
- The icon's circular safe-zone survival was checked directly (composited
  the rasterized icon against a simulated Android adaptive-icon mask and
  visually confirmed no clipping), not just asserted from the source
  coordinates.
- `tsc -b`/`oxlint`/`vite build` re-verified clean after the icon/manifest
  changes, and `npx cap copy` re-run so both native projects carry the
  rebuilt web bundle.

**Explicitly not verified — could not be, from this environment**: this
sandbox has no Java/Android SDK/Gradle, no Xcode, and no Ruby/CocoaPods
(confirmed by direct checks before starting). Nothing native has actually
been compiled, run on a simulator/device, or tested against real
PowerSync sync or the P2P QR-pairing camera flow inside an actual
Capacitor WebView. That's real, meaningful risk still open — see below.

## Still open (the user's next step, on their own machine)

1. **Android**: open `app/android/` in Android Studio, let Gradle sync,
   run on an emulator or real device.
2. **iOS**: open `app/ios/App/App.xcworkspace` in Xcode (macOS only),
   run on a simulator or real device.
3. **Re-verify inside the real native shell, not assumed from the web
   build**: local read/write through `@powersync/capacitor`'s native
   SQLite path, background/foreground behavior (the exact scenario the
   OPFS bug this doc avoided was about), and the P2P QR-pairing camera
   flow (`PairingScreen.tsx`) — camera permissions and `getUserMedia`
   behave differently inside a native WebView than a mobile browser tab,
   untested either way.
4. ~~Real app icons/splash once naming/branding actually resolves~~ —
   done, see D195. Real icons are in place on both native platforms and
   the PWA manifest; only actually seeing them rendered by a real
   Xcode/Android Studio build is still outstanding.
5. **App Store / Play Console accounts, signing certificates, and actual
   store listings** — none of that exists yet; this doc only covers
   getting a native project that can build.
6. `name`/`short_name`/`theme_color`/`background_color` in
   `vite.config.ts`'s manifest, the Home wordmark pool (docs/51), and
   `capacitor.config.ts`'s `appName` all still say "piggypal" — D195
   confirmed the real name is Flowtab, so this is now a real rename
   backlog item, not a hedge against unresolved naming.

**2026-09-10.**

# 54 — Magic-Link Deep-Linking Across PWA, iOS, and Android

## What this closes

With docs/52's native Capacitor shells now planned alongside the existing
PWA, the emailed magic link (docs/41/44) needs to open into whichever of
the three installed targets — home-screen PWA icon, native iOS app,
native Android app — the user actually has, rather than always landing
in a bare browser tab. This doc covers what's now implemented and, since
most of the real work here is external account setup, exactly what's
still needed and from whom.

## The mechanism

All three targets converge on one URL — the existing
`${APP_BASE_URL}/auth/verify?token=...` (docs/41). Nothing mints a
different link per platform; each platform is separately configured to
claim that URL when its own app is installed:

- **iOS**: Universal Links, via an Associated Domains entitlement plus a
  hosted `apple-app-site-association` file.
- **Android**: App Links, via an `autoVerify` intent-filter plus a hosted
  `assetlinks.json` file.
- **PWA**: Chrome's link-capturing for an installed WebAPK (Android
  only — no iOS equivalent, see below).

## What's implemented now

- **`app/src/main.tsx`** — `@capacitor/app` added as a dependency; an
  `appUrlOpen` listener (native platforms only, via
  `Capacitor.isNativePlatform()`) takes the full URL a Universal/App Link
  hands to the native shell and reassigns `window.location` to just its
  path+query, since a Capacitor app always runs from its own bundled
  webDir (`capacitor://`/`https://localhost`), never the linked host
  itself.
- **`app/vite.config.ts`** — the web manifest now sets `scope`,
  `start_url`, and `id` explicitly (all `'/'`) instead of relying on
  VitePWA's defaults, so Android's installed-PWA link-capturing has an
  unambiguous scope to match `/auth/verify` against.
- **`app/src/components/AuthVerifyScreen.tsx`** — the sign-in success
  step now shows a hint ("if you've added Flowtab to your home screen,
  you can close this tab and open it from there") whenever it renders
  outside a native app and outside standalone display mode — the one
  case where a separate installed icon might exist that this tab isn't
  it. Sign-in itself still applies either way, since a plain Safari/
  Chrome tab and a same-origin standalone PWA share the same
  localStorage/IndexedDB/OPFS.
- **`app/public/.well-known/apple-app-site-association`** and
  **`app/public/.well-known/assetlinks.json`** — scaffolded with
  placeholder values (`REPLACE_WITH_APPLE_TEAM_ID`,
  `REPLACE_WITH_SHA256_CERT_FINGERPRINT`), confirmed to pass through
  Vite's build unchanged into `dist/.well-known/` (same passthrough
  `app/public/` already uses for `favicon.svg`/`apple-touch-icon.png`/
  `icons/`). Inert until the placeholders are replaced with real values —
  no functional effect on anything else.

## Why iOS's PWA path can't be fixed in code

Apple doesn't extend Universal Links to home-screen-installed web apps —
only to a real native app installed via TestFlight/App Store with its
own Associated Domains entitlement. A magic link tapped in Mail on iOS
will always open Safari when only the PWA is installed, regardless of
any manifest or meta tag. This is a platform restriction, not a gap in
this app's setup. It stops being a problem once the real native iOS app
(below) exists and is what the user has installed instead.

## Not implemented — real external setup still needed, from the user

None of this can be done unattended from this sandbox (same standing
constraint docs/39 already flagged for Stripe/email-provider accounts):

- **An Apple Developer Program account** ($99/yr) — needed for a Team ID
  and to add the Associated Domains capability
  (`applinks:<app-domain>`) in Xcode. `ios/App/App/` has no
  `.entitlements` file at all yet.
- **A Google Play Console account** ($25 one-time, if distributing via
  Play Store) — needed for the real release signing certificate's SHA256
  fingerprint. If using Play App Signing, this is the *Play-generated*
  certificate visible after the first upload, not a local debug/upload
  keystore.
- **`android/app/src/main/AndroidManifest.xml`'s App Links intent-filter**
  (`android:autoVerify="true"`, `<data android:scheme="https"
  android:host="<app-domain>" android:pathPrefix="/auth/verify"/>`) —
  not added yet. Only a bare `MAIN`/`LAUNCHER` intent-filter exists today.
- **The production app domain itself** — still undecided (docs/39's own
  open question). Every value above (`appID`'s domain half, the
  intent-filter's `android:host`, and where the two `.well-known` files
  actually need to be hosted) depends on it.
- **Confirming `.well-known/*` actually reaches the browser as static
  files** on whatever host ends up serving `app.*` — a common footgun is
  an SPA catch-all rewrite rule in nginx-proxy-manager sending
  `/.well-known/apple-app-site-association` to `index.html` instead of
  serving the real file. Not checked against the real host config yet.

## Next steps, in order

1. Decide the production app domain (docs/39).
2. User creates the Apple Developer (and, if needed, Google Play)
   accounts.
3. Replace both `.well-known` placeholder files with real values (Team
   ID; real release cert's SHA256 fingerprint).
4. Add the Associated Domains entitlement (iOS, in Xcode) and the App
   Links intent-filter (Android, `AndroidManifest.xml`).
5. Build and install a real signed app on each platform (TestFlight for
   iOS; a signed APK/AAB, or Play Store, for Android) and verify a real
   magic-link tap actually opens it — nothing above has been exercised
   against a real device yet.

## Verified

`tsc -b`/`vite build` clean, `vitest run` 63/63 passed, `oxlint` clean
(one pre-existing warning in `store.tsx`, unrelated to this change). The
built `manifest.webmanifest` and `dist/.well-known/*` were both checked
directly against the build output. **Not verified**: an actual Universal
Link or App Link opening a real installed app — no native build has ever
been produced in this sandbox (docs/52's own standing note: no Xcode/
Android SDK available here).

**2026-09-21.**

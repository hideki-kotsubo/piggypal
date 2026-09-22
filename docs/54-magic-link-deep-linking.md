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
- ~~The production app domain itself~~ — **resolved, 2026-09-22**:
  `app.myflowtab.com` is live (docs/39's open question, at least for this
  purpose), fronted by Cloudflare in front of the host-level nginx above.
  This is the domain every value above (`appID`'s domain half, the
  intent-filter's `android:host`) needs to reference. One thing to watch
  once real Universal/App Link testing starts: Cloudflare's own
  protections (Bot Fight Mode, WAF rules) sit in front of Apple's/
  Google's AASA-fetching crawlers too — not expected to be a problem
  (both `.well-known` files already fetch cleanly via plain `curl`), but
  unverified against Apple's/Google's actual verification fetchers
  specifically, which is a separate thing from a browser or curl request
  succeeding.
- ~~Confirming `.well-known/*` actually reaches the browser as static
  files~~ — **done, 2026-09-22**: `app.myflowtab.com` turned out to be a
  host-level nginx config (not proxied through nginx-proxy-manager,
  fronted by Cloudflare), serving `app/dist` directly. Its `location /`'s
  `try_files $uri $uri/ /index.html;` was indeed swallowing
  `/.well-known/*` into the SPA fallback at first — fixed with an
  explicit `location ^~ /.well-known/ { default_type application/json;
  try_files $uri =404; }` block, high-priority-matched ahead of the
  catch-all. A second real issue surfaced once that was in place: the
  location block started returning a clean `404` instead of falling back
  to `index.html`, revealing that the deployed `dist/` on the host
  predated these two files (a stale build, not a config bug) — rebuilding
  and redeploying fixed it. Both files now confirmed live with `curl -I`:
  `200`, `content-type: application/json`, non-zero `content-length`, for
  both `apple-app-site-association` and `assetlinks.json`.

## A real gotcha hit deploying this: stale OPFS lock after a redeploy

Right after the nginx fix and redeploy above, the app got stuck showing
loading skeletons forever in one already-open Chrome profile — full
`index.html`/JS/CSS loaded fine (confirmed in Network tab: `200` on all
8 shell requests), but **zero requests for the SQLite WASM engine, its
worker, or any VFS chunk** ever fired, and the Console stayed completely
empty. Not a server or deploy bug: an already-open tab/window from
before the redeploy was still holding an exclusive OPFS lock on the
local SQLite file (docs/01 D1's on-device storage) — OPFS access
handles are exclusive per origin, so a new tab's attempt to open the
same file just hangs with no error and no timeout, since "Clear site
data" wipes storage but can't force-close another tab's already-open
in-memory handle. Confirmed by elimination: an incognito window (fresh
storage partition, no lock contention) loaded fine the whole time.
**Fixed by fully quitting Chrome** (not just closing the tab/window —
a lingering service worker/background process can keep the handle
alive) and reopening fresh.

Worth knowing for any future redeploy during active testing: if the app
gets stuck on loading skeletons with a clean Network tab and empty
Console, check for other open tabs/windows on the same origin before
assuming the deploy broke something.

## Next steps, in order

1. ~~Decide the production app domain~~ — done, `app.myflowtab.com`.
2. User creates the Apple Developer (and, if needed, Google Play)
   accounts.
3. Replace both `.well-known` placeholder files with real values (Team
   ID; real release cert's SHA256 fingerprint) and redeploy — same
   rebuild-and-redeploy step already exercised for real getting the
   placeholder files live.
4. Add the Associated Domains entitlement (iOS, in Xcode) and the App
   Links intent-filter (Android, `AndroidManifest.xml`), both pointed at
   `app.myflowtab.com`.
5. Build and install a real signed app on each platform (TestFlight for
   iOS; a signed APK/AAB, or Play Store, for Android) and verify a real
   magic-link tap actually opens it — nothing above has been exercised
   against a real device yet.

## Verified

`tsc -b`/`vite build` clean, `vitest run` 63/63 passed, `oxlint` clean
(one pre-existing warning in `store.tsx`, unrelated to this change). The
built `manifest.webmanifest` and `dist/.well-known/*` were both checked
directly against the build output. **2026-09-22, against the real
production host**: both `.well-known` files confirmed live at
`https://app.myflowtab.com/.well-known/{apple-app-site-association,assetlinks.json}`
via `curl -I` — `200`, `content-type: application/json`, non-zero
`content-length` for both, through Cloudflare, after fixing the host
nginx's SPA-catch-all swallowing them and redeploying a `dist/` that
actually included the two files. **Still not verified**: an actual
Universal Link or App Link opening a real installed app — no native
build has ever been produced in this sandbox (docs/52's own standing
note: no Xcode/Android SDK available here), and the two files still hold
placeholder values, not a real Team ID or cert fingerprint.

**2026-09-21, revised 2026-09-22.**

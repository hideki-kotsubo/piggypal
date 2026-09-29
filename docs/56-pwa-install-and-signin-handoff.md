# 56 — PWA Install Prompt and Sign-In Handoff to the Installed App

**Status: implemented 2026-09-29 (plan approved same day). Real-device checks still pending, see Verification.**

## The ask

1. Make installing Flowtab to the home screen something the app itself
   offers, not something users have to find in a browser menu.
2. When a user has the PWA installed, the emailed magic link should sign
   in *that installed app*, not a random browser tab.

## Where things stand

The app is already a valid, installable PWA. `vite-plugin-pwa` in
`app/vite.config.ts` emits `manifest.webmanifest` (standalone,
explicit `id`/`scope`/`start_url`, 192/512 maskable icons) plus a
Workbox service worker that precaches the whole app including the
wa-sqlite WASM (docs/01 D1, fully offline cold start). Chrome/Edge
already show their own install UI; iOS users can already use
Share → Add to Home Screen. What's missing is the app *driving* either
of those, plus a few `index.html` gaps (`<title>` is still `app`, no
`theme-color`, no iOS web-app meta tags).

docs/54 already covers magic-link deep-linking for the native shells
(Universal Links / App Links) and set the manifest scope Android's
installed-PWA link capturing needs.

## A correction to docs/54: iOS home-screen apps do not share storage

docs/54 (and the comment on `AuthVerifyScreen.tsx`'s `done` step) says
a Safari tab and a same-origin home-screen PWA "share the same
localStorage/IndexedDB/OPFS," so signing in via the tab also signs in
the icon. **That's true on Android Chrome (a WebAPK shares Chrome's
profile) but not on iOS**: a home-screen web app on iOS gets its own
isolated storage *and* cookie jar, separate from Safari.

That matters because `/api/auth/verify` binds the session to whoever
opens the link: it takes the opening context's `localUserId`/`deviceId`
and sets the httpOnly refresh cookie on that context. On iOS the link
always opens in Safari (docs/54: Apple doesn't route Universal Links to
home-screen web apps), so today an iOS PWA user who taps the link signs
in **Safari**, not their installed app. The app stays signed out, and
Safari's own local data becomes a second "device" on the account.

No manifest setting or meta tag fixes this. The fix has to be a way to
finish sign-in *inside the context that asked for it*, without going
through the link at all.

## Plan

### Part A — install prompt (web only)

**D201: capture `beforeinstallprompt` at module load, surface it in
Settings.** Chromium fires the event once, often before React mounts,
so it has to be captured at import time rather than in a component.

- `app/src/lib/installPrompt.ts` (new):
  - At module load, add a `beforeinstallprompt` listener that calls
    `preventDefault()` and stores the event. Add an `appinstalled`
    listener that clears it.
  - The pure mode choice lives in `lib/installMode.ts` so vitest's
    Node environment can test it. `installPrompt.ts` collects the
    real inputs.
  - Export `useInstallPrompt()`, which returns
    `{ mode: 'prompt' | 'ios-instructions' | 'installed' | 'unavailable', install() }`:
    - `installed` when running under `display-mode: standalone`, under
      `navigator.standalone` (iOS), or on
      `Capacitor.isNativePlatform()`.
    - `prompt` when a deferred event exists. `install()` calls
      `event.prompt()`, awaits `userChoice`, then drops the event
      (each event can prompt only once).
    - `ios-instructions` for iOS Safari that isn't standalone. Check the
      UA for iPhone/iPad, including iPadOS reporting itself as Mac with
      touch points.
    - `unavailable` otherwise (Firefox desktop, already dismissed, etc.).
  - `main.tsx` imports it for side effects, next to `./lib/settings`.
- `SettingsScreen.tsx`: add an "Install Flowtab" row, shown only when
  mode is `prompt` or `ios-instructions`. With `prompt` it triggers the
  native dialog. With `ios-instructions` it expands short steps: tap
  Share, then "Add to Home Screen". It's a Settings row, not a nagging
  banner, which fits the app's quiet tone. An optional one-time
  dismissible hint on Home can come later.

**D202: `index.html` meta fixes.**
`<title>Flowtab</title>`, `<meta name="theme-color" content="#3f7d69">`
(same value as the manifest, since both are still placeholders per
docs/01 item 5), `apple-mobile-web-app-title` = `Flowtab`,
`apple-mobile-web-app-capable` / `mobile-web-app-capable` = `yes`, and
`apple-mobile-web-app-status-bar-style` = `default`.

**Deferred:** manifest `screenshots` (narrow + wide) for Chrome's
richer install dialog. They need real app screenshots, so this is a
follow-up task and not part of this change.

### Part B — magic link → installed app

Two layers. The link keeps working wherever the platform can route it,
and a code in the same email works everywhere, iOS included.

**D203: manifest link-capturing hints (Chromium).** Add to the
manifest in `vite.config.ts`:

```ts
launch_handler: { client_mode: ['navigate-existing', 'auto'] },
handle_links: 'preferred',
```

- **Android, installed via Chrome (WebAPK):** Android already routes
  in-scope links tapped in *other apps* (e.g. the Gmail app) to the
  installed app, because of the `scope` docs/54 set. It does **not**
  capture links tapped inside Chrome itself (webmail in a Chrome tab).
  Gmail's "open web links in Gmail" in-app browser may also bypass it.
  Both have to be verified on a real device.
- **Desktop Chrome/Edge:** `handle_links: 'preferred'` opts into
  desktop link capturing (the user still controls it through the
  browser's "open supported links" setting). `navigate-existing`
  reuses an already-open Flowtab window rather than opening a second
  one. A second window would contend for the exclusive OPFS lock and
  could reproduce the stuck-on-skeletons symptom docs/54 documented.
- **iOS:** no effect. Handled by D204.
- Samsung Internet / Firefox Android "installs" are plain shortcuts
  with no link capturing. Also handled by D204.

**D204: a 6-digit code in the magic-link email, entered in the app
that requested it.** The requesting context already knows the email
(`requestMagicLink` stores it under `flowtab:pending-auth-email`), so
the code needs no extra state on the client, and the session lands
exactly where the user started. The same approach works in every
browser and platform.

*Database* — `db/migrations/2026-09-29-magic-links-code.sql`, plus a
matching update to `db/schema.sql`:

```sql
alter table magic_links add column code_hash text;
alter table magic_links add column code_attempts int not null default 0;
```

*API* — `api/src/auth/routes.ts`:
- `/request-link` also generates a 6-digit code (`crypto.randomInt`,
  zero-padded) and stores `sha256(code)` in `code_hash` on the same row.
  `sendMagicLinkEmail(email, verifyUrl, code)` gets the extra argument.
- New `POST /api/auth/verify-code` with
  `{ email, code, localUserId, deviceId }`:
  - Only the **newest** unconsumed, unexpired row for that email is
    checked. Requesting a new link invalidates the old code this way.
  - On a mismatch, increment `code_attempts`. At 5 attempts the row is
    marked consumed (dead). Compare with `timingSafeEqual`. Five
    guesses against 10⁶ codes within a 15-minute TTL bounds brute force
    per issued link.
  - The response is the same generic `400 Invalid or expired code`
    whether the email is unknown, the code is wrong, or the row is dead
    (no enumeration, same as docs/05).
  - On success, it runs the same "consume row → existing-or-new user →
    refresh token → cookie → access token" path as `/verify`. That path
    moves into a shared function, so the two endpoints can't drift apart.
- The link and the code are two credentials for **one** row. Using
  either one consumes it.

*Email* — `api/src/auth/email.ts`: show the code prominently, formatted
like `482 913`, under the link. Wording along the lines of: "Using
Flowtab from your home screen on iPhone? Don't tap the link. Open the
app and enter this code instead." Plain text and HTML bodies both
change. Using a code also sidesteps docs/45's click-tracking concern,
since nothing auto-consumes a code.

*App*:
- `lib/auth.ts`: add `verifyMagicCode(email, code)`, returning the same
  `VerifyResult` and setting `accessToken` the same way. Also record
  when the link was sent (`flowtab:pending-auth-sent-at`) and add
  `getRecentPendingEmail()`, so Settings reopens straight into the code
  field for 15 minutes. Found while building this: on iOS, switching to
  Mail and back often reloads a home-screen PWA from scratch, which
  would otherwise drop the user back on a blank email form halfway
  through signing in.
- `SettingsScreen.tsx`, in the `sent` state: under "Check your email",
  add a code field (`inputMode="numeric"`,
  `autoComplete="one-time-code"`, 6 digits, spaces stripped). Submit
  navigates to `/auth/verify` with `{ email, code }` in router `state`,
  **not** in the URL, so the code never lands in history.
- `AuthVerifyScreen.tsx`: the `confirm` step's credential becomes a
  union, `{ via: 'link', token } | { via: 'code', email, code }`.
  `initialStep` reads `location.state` first, then `?token=`. A code
  submission skips the confirm tap (the user already acted) and goes
  straight to verifying. The profile/merge steps after that run
  unchanged.
- `AuthVerifyScreen.tsx`, `confirm` step, when opened via link in iOS
  Safari (not standalone, not native): above the Sign In button, show
  "Using Flowtab from your home screen? Don't sign in here. Open the
  app and type the code from the email." The existing tap-to-confirm
  step (added for the Resend click-tracking bug) means the link isn't
  consumed until the user chooses, so the code stays valid.
- `AuthVerifyScreen.tsx`, `done` step: correct the comment, and on iOS
  change the hint text. Signing in here signs in **this browser only**,
  not the home-screen app.

### Not doing

- **Polling / "approve on another device" handoff** (the app polls
  while the link approves it elsewhere). It needs no typing, but it
  enables a phishing pattern: an attacker starts a sign-in with your
  email and you approve their session. It only becomes safe with
  matching-number confirmation, which is more complexity than a code.
- **Detecting "PWA installed" from a browser tab**
  (`navigator.getInstalledRelatedApps`). It's Chromium-only and the
  place it would help (iOS) is exactly where it doesn't exist.

## Verification

**Done, 2026-09-29:**
- App: `tsc -b` and `vite build` are clean. `oxlint` is clean apart from
  the old `store.tsx` warning. `vitest run` passes 77/77, including the
  new `installMode.test.ts` (iPhone, iPadOS reporting as a Mac, real
  Mac, Android, and all four modes).
- The built `manifest.webmanifest` contains `launch_handler` and
  `handle_links`. The built `index.html` has the new title and meta
  tags.
- API, run against a **throwaway in-process Postgres (PGlite)**, not the
  shared dev database. The migration was applied on top of the
  pre-migration `magic_links` shape, then the scratch API was exercised
  with `curl`. All of these behaved as expected:
  - A correct code, entered with a space (`482 913`), signs in a new
    user (200, `isNewUser: true`). Reusing it returns 400.
  - Five wrong codes, then the correct one: 400 on the last try, and
    the row ends with `code_attempts = 5`, consumed.
  - Link first, then code: 400. Code first, then link: 400.
  - An older code after a newer request: 400. The newer code: 200.
  - A second code sign-in to an existing account returns the same
    `userId` with `isNewUser: false`.
  - A bad format, a missing `localUserId`/`deviceId`, or an unknown
    email all return 400. An unknown email gets the same generic
    message as a wrong code.
  - The refresh cookie set by `/verify-code` works with `/refresh`
    (200).
- **Not done here:** a browser-level UI check. Neither Playwright's
  Chromium nor its WebKit can launch in this sandbox (missing system
  libraries such as `libglib`/`libnss3`). The Settings code field,
  install row, and iOS hints are covered by `tsc`/`build` only, not by
  a rendered page.

**Still needed, on real devices (the user):**
  - iPhone: install from Safari, request a link from the installed app,
    enter the code in the installed app, and confirm the app (not
    Safari) is signed in.
  - Android with Chrome WebAPK: tap the link in the Gmail app and check
    whether it opens the installed app, with Gmail's in-app browser
    setting both on and off.
  - Desktop Chrome: installed app with "open supported links" enabled,
    link clicked from webmail in a tab.

## Deploy notes

API and DB change together. Apply the migration on the production
Postgres **before** deploying the api. Then redeploy the api with
`docker compose up -d --build api` (not just `npm run build`), and
rebuild and redeploy `app/dist`. The old app keeps working against the
new api, since `/verify` is unchanged and the code is additive.

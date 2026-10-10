# 66 — Releasing the iOS app to the App Store

Plan written 2026-10-09, after the first successful native iOS run
(docs/64, docs/65). Nothing here has been submitted yet. Android / Google
Play gets its own doc when we get there.

## Part A: Blockers before the first submission

Checked against the project and Apple's App Review Guidelines.

| # | Blocker | Why | Who | Status |
|---|---|---|---|---|
| 1 | No in-app **account deletion** | Apps that let users create an account (email sign-in does, docs/41) must let them delete it from inside the app, guideline 5.1.1(v). A very common rejection. Deletes server data, so it needs a design pass first | Claude: api endpoint + Settings button | To do |
| 2 | No **privacy policy** page | App Store Connect requires a privacy policy URL | Claude writes `website/privacy.html`; the user reviews the wording | To do |
| 3 | Production api doesn't allow the native apps' origins (`CORS_ORIGIN`) | Sign-in and sync fail inside the app, and the reviewer will try them | User, on the production server (below) | To do |
| 4 | **iPad support** is on (`TARGETED_DEVICE_FAMILY = "1,2"`) | iPad screenshots become mandatory and reviewers test on iPad; the UI is a 480px phone column | Claude: iPhone-only for v1 | To do |
| 5 | **Encryption** question on every upload | The binary includes SQLCipher (via `@powersync/capacitor`). Usually exempt, but the answer has to be given | User answers in App Store Connect; then add `ITSAppUsesNonExemptEncryption` to `Info.plist` so it isn't asked every upload | To do |
| 6 | App icon upscaled from 637px (docs/60 D227) | Acceptable, but the store page shows it large | User: export `docs/logo/v2-icon.png` at ≥1024px (or SVG), then re-run the brand script | Optional |

Blocker 3 on the production server: in `deploy/.env`, add the native
origins to the existing list, then rebuild the api.

```
CORS_ORIGIN=<existing origins>,capacitor://localhost,https://localhost
```

```bash
cd flowtab
deploy/up.sh api
```

(`capacitor://localhost` is the iOS app's origin, `https://localhost`
Android's.)

## Part B: Accounts and one-time setup

1. **Apple Developer Program** (https://developer.apple.com/programs/),
   $99/year. *Individual*: the user's name is shown as the seller, quick.
   *Organization*: a company name, needs a D-U-N-S number, takes days.
2. **Xcode** → App target → Signing & Capabilities → Team: switch from
   "Personal Team" to the paid team. With automatic signing, Xcode
   registers the bundle ID `com.myflowtab.app` (docs/52 D192).
3. **App Store Connect** (https://appstoreconnect.apple.com) → Apps → + →
   New App: platform iOS, name Flowtab (if available), primary language
   English, bundle ID `com.myflowtab.app`, SKU e.g. `flowtab-ios`.

## Part C: Build and upload (every release)

On the Mac. First check `app/.env.production.local` there points at the
**production** api and PowerSync, not staging.

```bash
cd ~/Projects/flowtab
git pull
npm ci
npm run build -w app
cd app
npm run release:ios
```

`release:ios` (docs/55 D198, docs/58 D222) stamps the app's version
(e.g. 0.3.4) as the iOS marketing version and bumps the build number,
which must increase on every upload. It edits the iOS project, so commit
that:

```bash
git add ios
git commit -m "ios: build for App Store"
git push
```

Then in Xcode:

1. Run destination: **Any iOS Device (arm64)**.
2. **Product → Archive**; the Organizer opens when it's done.
3. **Distribute App → App Store Connect → Upload**, defaults.
4. Wait for the "build processed" email (10–30 minutes).

## Part D: TestFlight (before submitting)

App Store Connect → the app → TestFlight → add yourself as an internal
tester, install the TestFlight app on the iPhone, and test the real store
build: sign-in with the 6-digit code (the emailed link doesn't open the
app yet, docs/54), voice entry (prompts once, never again, docs/62), QR
pairing.

## Part E: Store listing and submission

| Field | Notes |
|---|---|
| Screenshots | 6.9" iPhone (1320×2868), at least 3. Simulator "iPhone 16 Pro Max", ⌘S |
| Description, keywords, support URL | Support URL can be the website (docs/61) |
| Privacy policy URL | Blocker 2 |
| App Privacy questionnaire | Email address (only if the user signs in); financial data (only when synced). Otherwise data stays on the device (docs/01 D1) |
| Category | Finance |
| Age rating | Short questionnaire; likely 4+ |
| App Review notes | The app works without an account; give a reviewer email they can sign in with (6-digit code by email) |
| Build | Select the uploaded build → **Submit for Review** (usually 1–3 days) |

## Order

1. User: start the Developer Program enrollment now (can take days).
2. Claude: blockers 1 (design with the user first), 2 and 4.
3. User: blocker 3, then TestFlight (Part D).
4. User: listing and submission (Part E); blocker 5 at the first upload.

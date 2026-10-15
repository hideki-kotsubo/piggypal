# 70 — Releasing the Android app on Google Play

Plan written 2026-10-14, the Android companion to docs/66 (iOS). Nothing
here has been submitted yet. Checked against the project as of `main`
(`app/android/`: `applicationId com.myflowtab.app`, `targetSdkVersion 36`,
`versionCode 2`, `versionName 0.3.3`).

## Part A: Blockers before the first submission

Several are shared with docs/66 and only need doing once.

| # | Blocker | Why | Who | Status |
|---|---|---|---|---|
| 1 | No in-app **account deletion** | Same as docs/66 #1. Play also requires a **web link** where people can request deletion without the app (Data safety form) | Claude: api endpoint + Settings button + a `website/delete-account.html` page | To do (shared) |
| 2 | No **privacy policy** page | Play Console requires a privacy policy URL | Claude: `website/privacy.html` (docs/66 #2) | To do (shared) |
| 3 | Production `CORS_ORIGIN` lacks `https://localhost` | Android's WebView origin; sign-in and sync fail without it | User, on the production server (docs/66 #3) | To do (shared) |
| 4 | **Closed test: 12 testers for 14 days** | Personal developer accounts created after Nov 2023 must run a closed test with at least 12 opted-in testers for 14 days in a row before production access is granted. This is the long pole | User: recruit testers (friends, family, a Google Group) | To do |
| 5 | **Voice entry** probably doesn't work | Android's WebView has no Web Speech API, so `speechInput.ts` likely reports "unsupported". Typing still works | Test first (docs/62); if broken, add `@capacitor-community/speech-recognition` | Check on device |
| 6 | **16 KB page size** | Apps targeting Android 15+ must ship native libraries aligned for 16 KB pages. The only native library is PowerSync's SQLite core (`powersync-sqlite-core 0.5.2`) | Check: Android Studio → Build → Analyze APK on the release bundle warns on misaligned `.so` files; Play Console also flags it on upload | Check at first build |
| 7 | Never built for release | The Android project has been synced but not yet run on a real device or emulator (docs/52) | User: run it once in Android Studio before the first upload | To do |

## Part B: Accounts and one-time setup

1. **Google Play Console** (https://play.google.com/console), $25 one-time.
   *Personal*: quick, the user's name is shown as the developer, and
   blocker 4 applies. *Organization*: needs a D-U-N-S number, takes days,
   but skips the 12-tester rule. Google verifies identity either way
   (government ID, and a real Android device for the Play Console app).
2. **Create app** → name Flowtab, default language English (United States),
   App, Free. Free can't later be changed to paid; in-app subscriptions
   are still allowed.
3. **Upload key** (once, on the Mac). Play App Signing is mandatory: Google
   holds the real signing key; this key only proves uploads come from you.
   If it's lost it can be reset through Play support, but back it up
   anyway (password manager plus the file somewhere outside the repo).

   ```bash
   mkdir -p ~/keys
   keytool -genkeypair -v -keystore ~/keys/flowtab-upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
   ```

   Never commit the `.jks` file or its passwords.

## Part C: Build and upload (every release)

On the Mac. As for iOS, first check `app/.env.production.local` points at
the **production** api and PowerSync, not staging.

```bash
cd ~/Projects/flowtab
git pull
npm ci
npm run build -w app
cd app
npm run release:android
```

`release:android` stamps the app version as `versionName`, bumps
`versionCode` (must increase on every upload), commits and pushes that
bump to `main`, then runs `cap sync android`. Same refusals as
`release:ios` (docs/66 Part C).

Then in Android Studio (open `app/android`):

1. **Build → Generate Signed App Bundle or APK → Android App Bundle**.
2. Key store: `~/keys/flowtab-upload.jks`, alias `upload`. Tick
   "Remember passwords" if you like.
3. Build variant **release** → Create. The file lands at
   `app/android/app/release/app-release.aab`.
4. Play Console → the app → Testing → (closed testing track for now) →
   Create new release → upload the `.aab` → release notes → Review →
   Roll out.

## Part D: Testing tracks

1. **Internal testing** first (up to 100 testers, available in minutes,
   no review): install from the opt-in link and test sign-in with the
   6-digit code (the emailed link doesn't open the app, docs/54), voice
   entry (blocker 5), QR pairing camera prompt, background/foreground,
   Sync now (docs/69).
2. **Closed testing** with at least 12 testers for 14 days (blocker 4).
   Testers must opt in through the link and stay opted in.
3. **Apply for production** (Dashboard). Google asks a few questions about
   the closed test; approval usually takes a few days.

## Part E: Store listing and App content

Play Console → Grow → Store listing, and Policy → App content.

| Field | Notes |
|---|---|
| App icon | 512×512 PNG (docs/66 #6: a ≥1024px export helps here too) |
| Feature graphic | 1024×500 PNG, required |
| Phone screenshots | At least 2, 9:16, e.g. 1080×1920 from the emulator (Pixel) |
| Short / full description | 80 / 4000 characters |
| Privacy policy | Blocker 2 |
| Data safety | Email address (account, only if signing in); financial info (only when synced), encrypted in transit; deletion link = blocker 1's web page. Otherwise data stays on the device (docs/01 D1) |
| Financial features | Declare "budgeting / personal finance management", no lending or payments |
| Content rating | IARC questionnaire; likely Everyone |
| Target audience | 18+ (keeps it out of the Families policy) |
| Ads | No ads |
| App access | The app works without an account; give a reviewer email they can sign in with (6-digit code) |
| Category | Finance |

## Later: magic-link App Links

docs/54's Android App Links intent-filter isn't in `AndroidManifest.xml`
yet. When it's added, `assetlinks.json` must carry the SHA-256 of the
**Play App Signing** key (Play Console → Test and release → App integrity),
not the upload key, or links from Play installs won't open the app.

## Order

1. User: create the Play Console account now and start verification; line
   up 12 testers.
2. Claude: blockers 1 and 2 (shared with iOS).
3. User: blocker 3, upload key, first build, internal test (checks
   blockers 5, 6, 7).
4. User: closed test for 14 days, filling in Part E meanwhile.
5. User: apply for production, then roll out.

# 55 — Per-Component Versioning, Deploy-Time Tags, Native Build Numbers

## The ask

Deploys are manual and run separately per component (api, web app,
website, iOS, Android — never a single "release everything" step), and
the user had no way to tell what's actually live in production versus
what's merged to `main`. Also wanted iOS/Android version numbers to be
free to diverge from web/from each other (a platform-specific rejection
or hotfix shouldn't force the others to bump), and a curated changelog
published on `website/` for real user-facing releases.

## The fix

**D153 (docs/29) is superseded.** One shared semver version across
root/app/api `package.json` made sense pre-launch with no deploy
history to track; it stopped fitting once components started deploying
independently. `app/` and `api/` now version independently — each
bumped only when that component actually changes, no more forced sync.
`root/package.json`'s version is no longer treated as authoritative for
anything; it's just the workspace root.

**Deploy-time tagging, not merge-time.** `main` can sit ahead of
production for a while (manual deploys), so tagging on merge would
record "when was this written," not "what's running." Tags are created
at the moment a deploy actually happens instead:
- `scripts/deploy-api.sh [patch|minor|major]` — must be run from a clean
  `main`. Bumps `api/package.json` via `npm version --tag-version-prefix
  api-v`, pushes the commit + `api-vX.Y.Z` tag, then prints the manual
  deploy steps from `deploy/README.md` step 3 (SSH in, `git pull`,
  `docker compose up -d --build`) plus a `curl .../health` check —
  `api/src/index.ts`'s existing `/health` endpoint already returns
  `{ status, version }` (docs/29), so once this habit sticks, hitting
  `/health` on the real host answers "what's live" directly.
- `scripts/deploy-app.sh [patch|minor|major]` — same shape for `app/`:
  bumps `app/package.json`, tags `app-vX.Y.Z`, builds `app/dist`, then
  prints the manual upload/serve steps from `deploy/README.md` step 5.
  Neither script touches the actual production host — no SSH
  credentials or host address are known here; the printed steps are a
  reminder of the existing manual process, not automation of it.

**iOS/Android get their own two-number scheme**, independent of
`app/`'s semver and of each other:
- A marketing version (Android `versionName`, iOS `MARKETING_VERSION`)
  that normally mirrors `app/package.json`'s version.
- A build number (Android `versionCode`, iOS `CURRENT_PROJECT_VERSION`)
  that increments on every submitted build regardless of the marketing
  version — required by both stores to be strictly increasing, even for
  a same-version resubmission after a rejection.

`app/scripts/sync-native-version.mjs <android|ios>` stamps the current
`app/package.json` version onto the platform's marketing-version field
and increments that platform's build number by one. Wired into
`npm run sync:android` / `npm run sync:ios` (runs the version stamp,
then `npx cap sync <platform>`) — the existing pre-store-build step, now
version-aware. Because the two platforms' build numbers are independent
counters, iOS and Android can legitimately end up on different numbers
(a rejected iOS build needing a same-code resubmission bumps only iOS)
without needing any special-casing.

**Changelog**: not automated, not a raw commit dump. Publish curated,
user-facing entries by hand to `website/` (mostly `app`-facing
changes, plus backend/infra changes when they're actually relevant to
users — e.g. an outage fix, not a refactor). No fixed cadence or format
decided yet — first real entry will set the pattern.

## Decisions locked in this doc

| # | Decision | Why |
|---|---|---|
| D196 | `app/` and `api/` version independently (supersedes D153's single shared version) | Deploys are separate and manual; forcing one number across both just meant bumping the untouched component too |
| D197 | Git tags (`api-vX.Y.Z`, `app-vX.Y.Z`) are created at deploy time, not at merge-to-main time | `main` can be ahead of what's actually live for a while; a merge-time tag would answer the wrong question |
| D198 | iOS/Android carry a marketing version (mirrors `app/`'s semver) and a separately-incrementing build number, per platform | Store rules require monotonic build numbers even across same-version resubmissions; keeping them separate lets platforms diverge (e.g. an iOS-only hotfix) without forcing Android/web to bump too |
| D199 | `deploy-api.sh`/`deploy-app.sh` stop short of the actual host deploy step (SSH/upload) | No production host address or credentials are available in this environment to automate safely; scripts do the part that's safe to automate (version/tag/push/build) and print the existing manual steps for the rest |
| D200 | Website changelog is hand-curated, not generated from commits or `CHANGELOG.md` files | The audience is end users, not developers — most commits aren't changelog-worthy, and auto-generation would need editorial pass anyway |

## What's implemented

- `scripts/deploy-api.sh`, `scripts/deploy-app.sh` — executable, verified
  the branch/clean-tree checks and `npm version --tag-version-prefix`
  behavior manually; not run for a real deploy (no host access here).
- `app/scripts/sync-native-version.mjs`, wired into `app/package.json`'s
  new `sync:android`/`sync:ios` scripts — verified against copies of
  `app/android/app/build.gradle` and
  `app/ios/App/App.xcodeproj/project.pbxproj` in a scratch dir (both
  Debug/Release config blocks in the `.pbxproj` update consistently,
  bad-platform-argument case exits non-zero with a usage message). Not
  yet run against the real native project files — first real run will
  move Android off its untouched `1.0`/`versionCode 1` Capacitor
  placeholders and iOS off its `1.0`/`CURRENT_PROJECT_VERSION 1`
  placeholders (docs/52 scaffolded both, never touched since).

Not implemented: the changelog page on `website/` itself (no entries
written yet), and no CI/branch-protection automation around any of this
(see the separate, still-uncommitted `add-ci-workflow` branch).

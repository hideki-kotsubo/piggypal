# 64 — PowerSync's native plugin missing from the iOS/Android projects

Found 2026-10-09 on the first iOS run (simulator): the app stayed on the
loading skeleton and Xcode logged `flowtab: seed transaction FAILED,
rolled back {}`.

## Cause

`@powersync/capacitor` (docs/52 D193) has native iOS and Android code
(SQLCipher + PowerSync's SQLite core extension, which PowerSync's
tables are built on). Its native part was never in either project:
`ios/App/CapApp-SPM/Package.swift` and `android/capacitor.settings.gradle`
listed only `@capacitor-community/sqlite`, so every write failed on
device, starting with the seed.

Why `cap sync` skipped it: the Capacitor CLI resolves each plugin with
`require.resolve('<plugin>/package.json')` from `app/`. The package's
`"exports"` doesn't list `./package.json`, so that throws
`ERR_PACKAGE_PATH_NOT_EXPORTED`; the CLI's fallback only looks in
`app/node_modules/<plugin>`, but npm workspaces hoist it to the root
`node_modules/`. The CLI then drops it without a warning (`cap ls`
showed 2 plugins, not 3). Still the case in the latest 0.9.3.

The same stale files also lacked `@capacitor/app` (docs/54's deep-link
listener), added after the projects were last synced.

## Fix

| # | Decision | Why |
|---|---|---|
| D239 | A root `postinstall` (`scripts/link-capacitor-plugins.mjs`) links any hoisted Capacitor plugin the CLI can't resolve into `app/node_modules` | Makes the CLI's own fallback find it, on every machine, after every `npm ci`; nothing else changes |
| D240 | The native plugin lists are regenerated (`npx cap update`) and committed with all three plugins | They were stale and incomplete |

Seed failures now log the error's message and stack: Capacitor's native
console bridge prints a bare `Error` as `{}`.

Verified here: `npx cap ls` finds 3 plugins (was 2); the generated
`Package.swift` / Gradle files include PowerSync and `@capacitor/app`;
the link script is idempotent. Not verified: an actual Xcode / Android
Studio build and run.

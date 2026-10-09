# 63 — Lockfile missing other platforms' native binaries

Found 2026-10-09: the user's first build on a Mac (step 4 of the native
build steps) crashed in `npm run build -w app` (`tsc -b && vite build`).

## Cause

Several build tools ship one native-binary package per OS/CPU as
`optionalDependencies`: `rolldown` (Vite 8's bundler), `lightningcss`,
`oxlint`, and TypeScript 7 (api). Because `app/` and `api/` need different
versions from the root, those packages live nested under
`app/node_modules/` and `api/node_modules/`, and for those nested copies
`package-lock.json` had recorded only the Linux binaries (the lockfile is
always updated on the Linux dev server), a known npm quirk. `npm ci` on a
Mac then installed `rolldown` without `@rolldown/binding-darwin-arm64`,
and the build crashed loading it.

Confirmed by installing for macOS here (`npm ci --os=darwin --cpu=arm64`):
with the old lockfile no Mac binaries were installed; with the fixed one
all four were (rolldown, lightningcss, oxlint, typescript).

## Fix

| # | Decision | Why |
|---|---|---|
| D237 | `scripts/lockfile-platforms.mjs --fix` adds every missing optional platform binary to the lockfile, at the exact versions already locked, with registry `resolved`/`integrity`; existing entries are never changed or moved | Regenerating the lockfile from scratch would also have bumped 107 unrelated packages |
| D238 | CI runs `lockfile-platforms.mjs --check` before `npm ci` | The quirk comes back whenever the lockfile is updated on Linux |

The first fix added 57 entries, nothing else changed (verified: removing
them gives a byte-identical file).

**If CI fails on it**, or a Mac/Windows install crashes on a native binding:

```bash
node scripts/lockfile-platforms.mjs --fix
git add package-lock.json && git commit -m "Lockfile: add missing platform binaries"
```

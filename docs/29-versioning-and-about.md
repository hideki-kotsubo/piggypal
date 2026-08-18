# 29 — App Versioning, About Screen

## The ask

Two related requests: show the app's current version somewhere in the UI
(and start actually tracking it — root/app/api `package.json` all carried
mismatched placeholder versions, 1.0.0/0.0.0/1.0.0), and add an "About"
surface with information about who built the app and how to reach them.

## The fix

**Versioning.** All three `package.json` files (root, `app/`, `api/`) now
share one real starting version, `0.1.0` — semver, pre-launch, bumped by
hand across all three together whenever a release-worthy change ships
(there's no CI/tag automation yet, see docs/00-backlog's GitHub/Gitea
item). `app/` reads its own version via a plain JSON import
(`app/src/lib/version.ts` imports `../../package.json`, `APP_VERSION`),
which needed `resolveJsonModule: true` added to `tsconfig.app.json`.
`api/` reads its version at startup from its own `package.json` via
`readFileSync` (`api/src/version.ts`) and now returns it on `/health`
(`{ status: 'ok', version }`) — this is the first thing `/health` reports
beyond a bare status. Version is displayed inline on Settings' new "About
piggypal" row (`v0.1.0`) and again, unprefixed, on the About screen's own
"Version" row.

One real dead end during the build, worth recording: the first attempt
injected the version via Vite's `define` config (reading `package.json` in
`vite.config.ts`, `define: { __APP_VERSION__: ... }`) — this is the
standard pattern and worked correctly for `vite build`, but silently
**did not** get replaced in `vite dev`'s per-file transform on this
Vite 8.2.1 (confirmed by requesting the raw dev-server module output: the
literal identifier `__APP_VERSION__` came back unreplaced, not a build
error). Traced into `vite`'s own `definePlugin` source — its transform
handler explicitly no-ops for `environment.config.consumer === "client"`
outside the bundled/build path in this version, so `define` only reliably
works in dev for values Vite treats as pre-bundled/env-injected, not
arbitrary custom identifiers. Switched to a native JSON import instead
(no `define`, no custom global, no dev/build behavioral gap) and confirmed
identically in both `vite dev` (raw module fetch showed `pkg.version` and
the resolved `package.json` module both correct) and `vite build` (grepped
`0.1.0` in the built bundle).

**About screen.** New `/about` route (`AboutScreen.tsx`), reached from a
new "About piggypal" row at the bottom of Settings. First-person, matching
the project's actual solo-developer reality rather than a "team" framing:
a one-line positioning blurb, "Built by Hideki Kotsubo, an independent
software developer based in Vancouver, Canada," a `mailto:` contact row,
and the version row. Reuses existing `settings-row`/`settings-row-static`/
`accounts-list` classes for the contact/version rows (same visual pattern
as every other Settings sub-screen); one new class, `.about-text`, for the
two body paragraphs (mirrors `.qr-caption`'s sizing/line-height, with its
own margin since it isn't nested in a centered flex container).

## Decisions locked in this doc

| # | Decision | Why |
|---|---|---|
| D153 | Single shared semver version, `0.1.0` to start, synced by hand across root/app/api `package.json` | One number for the whole product rather than three independently-drifting placeholders; no build tooling exists yet to enforce sync automatically, and this is a small enough repo that manual is fine for now |
| D154 | `app/`'s version is read via a native JSON import of `package.json`, not Vite `define` | `define` doesn't reliably replace custom identifiers in `vite dev`'s per-module transform on the installed Vite version (confirmed directly, see above) even though it works in `vite build` — JSON import behaves identically in both, no dev-only bug surface |
| D155 | About screen framed as "built by one person," first person, not "our team" | Matches CLAUDE.md's actual owner context — a false "team" framing would be misleading copy for a single-developer app |
| D156 | Contact is a real `mailto:` email (`hideki.kotsubo@gmail.com`), not deferred | User's explicit call when asked; no support inbox exists separately yet, this is it |

**Implemented 2026-08-18.** Verified: `tsc -b`/`oxlint` clean on both
workspaces; `vite build` bundle and `vite dev`'s raw module output both
grepped for the real version string; `api`'s running `/health` endpoint
hit directly and confirmed via `tsx watch`'s hot reload (no restart
needed); Settings and About screens screenshotted end-to-end in a real
Chromium instance via Playwright (installed ad hoc for this check, not
added as a project dependency) against the real running dev server —
confirmed the About row/version pairing on Settings and the full About
screen layout render correctly, not just compile clean.

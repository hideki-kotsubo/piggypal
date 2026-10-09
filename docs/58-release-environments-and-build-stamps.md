# 58 — Release environments, build stamps and migration tracking

Builds on docs/55 (independent `app/`/`api/` versions, release tags,
native marketing-version + build-number pairs), which stays in force
except where noted below. Discussed and agreed 2026-10-08.

## The problem

docs/55 left gaps that showed up once releases were actually discussed:

- **Production isn't on this machine.** docs/55 and `deploy/REDEPLOY.md`
  assumed production ran on the dev machine. It doesn't: the stack here is
  a prod-like staging environment, and production runs on its own server,
  a `git clone` of this repo.
- **No way to tell exactly what's running.** A version number alone can't
  tell two builds of the same version apart, or a release build from a
  local one.
- **The database had no version at all.** `db/migrations/` were applied
  by hand with `psql`, and nothing recorded which ones a database had.
  Production would have to be checked table by table.
- **PowerSync ran `:latest`.** Any rebuild on a new host could silently
  upgrade it.
- **Native build numbers were burned by dev syncs.** `npm run sync:ios`/
  `sync:android` bumped the build number every time, even when nothing was
  being submitted.

The user also asked about bumping the version automatically on every
commit. That was considered and rejected (D218): it would add a "bump"
commit after every commit, make `package.json` a merge-conflict hot spot,
and turn version numbers into noise. Build stamps give the same
traceability without any of that.

## The design

### Three environments

| | Dev | Staging | Production |
|---|---|---|---|
| Where | this machine | this machine | its own server |
| Domain | `app-beta.codexbase.dev` | `app.codexbase.dev` | `app.myflowtab.com` or `app.flowtab.it` (not decided) |
| Code | any branch | `main`, at the new tag | a release tag, checked out |

A release goes: merge to `main` → `scripts/deploy-api.sh` /
`scripts/deploy-app.sh` (bump, commit, tag, push, as in docs/55) →
roll out on staging → test → `git checkout <tag>` on the production
server and rebuild there. `deploy/REDEPLOY.md` has the exact commands.

### Build stamps (D218)

Every build carries the short commit hash it was built from:

- **App:** `vite.config.ts` injects `__APP_COMMIT__` at build time
  (`lib/version.ts`'s `APP_COMMIT`). About shows `0.2.1 (a428ee8)`;
  Settings keeps the plain `v0.2.1`.
- **api:** `version.ts`'s `API_COMMIT`. A dev process asks git directly;
  the Docker image has no `.git`, so it gets `GIT_COMMIT` as a build arg
  from `deploy/up.sh`, a thin wrapper around `docker compose up -d --build`.
  `/health` returns `{ status, version, commit, schema }`.

`-dirty` is appended when the working tree had uncommitted changes, and
`unknown` is used when there's no git at all. A release build is never
dirty: the release scripts refuse a dirty tree.

### Tags mean "released," not "live" (D219)

docs/55 D197 tagged at deploy time so a tag meant "this is live." With a
staging step before production, a tag is created when a release is cut,
before either environment runs it, so it now means "this is a released
version." Production always runs a tag, never `main`, so "what's live in
production" is still exactly one tag, readable from `/health`.

### Migration tracking (D220)

- A `schema_migrations (filename, applied_at)` table records which
  `db/migrations/*.sql` files a database has had.
- `api/src/migrate.ts` applies every missing file, in filename order,
  when the api starts and before it takes traffic, under a Postgres
  advisory lock. Files keep their own `begin`/`commit` and run as-is.
- A failed migration stops the api (exit 1). That's better than serving
  new code against a half-migrated schema. An unreachable database
  doesn't stop it, matching how the api behaved before; `/health` then
  reports `schema: null`.
- `/health`'s `schema` is the newest applied filename. That's the
  database's version.
- `db/schema.sql` creates the table and inserts every migration it
  already includes, so a fresh database starts fully marked. Adding a
  migration now means three edits: the file, `schema.sql`'s DDL, and
  `schema.sql`'s insert list.
- **Existing databases need a one-time `baseline`.** A database without
  the table is left alone with a warning, never guessed at: some
  migrations aren't safe to re-run (one deletes rows, one drops a column).
  `migrate-cli.js baseline [through-file]` marks files as applied without
  running them, optionally only up to a given file, so a database that's
  behind still gets the rest applied.

### PowerSync pinned (D221)

Both compose files use `journeyapps/powersync-service:1.26.1`, the
version `:latest` pointed at since 2026-09-14. Upgrading is now a
deliberate edit to both files.

### Native build numbers only on release (D222)

`npm run sync:android`/`sync:ios` are plain `cap sync` again.
`npm run release:android`/`release:ios` stamp the app version and bump
the build number (docs/55 D198's script), then sync. Use them only for a
build that's actually going to a store.

## Decisions locked in this doc

| # | Decision | Why |
|---|---|---|
| D218 | Every app/api build is stamped with its commit hash. Versions are still bumped only at release, never per commit. | Traceability without a bump commit after every commit, `package.json` merge conflicts, or meaningless version numbers |
| D219 | Three environments: dev, staging (this machine) and production (own server). Tags mean "released version", and production only ever runs a tag. | Refines docs/55 D197, whose "tag = live" assumed production was on this machine |
| D220 | `db/migrations/` are tracked in `schema_migrations` and applied by the api at startup; existing databases are baselined once by hand | Removes the manual `psql` step and gives each database a readable version; never re-runs migrations that aren't safe to repeat |
| D221 | PowerSync's image is pinned to a version, not `:latest` | A rebuild must never upgrade a beta-adjacent sync service by accident |
| D222 | Native build numbers bump only via `release:*`, not `sync:*` | Dev syncs were burning store build numbers |

## What's implemented

All of the above, on 2026-10-08. Verified:

- api builds; `/health` on the dev api reports `version`, `commit` and
  `schema`.
- Migrations against the dev database: `status`; `baseline` (dev was
  checked first to have all 11 migrations); `up` applying a throwaway
  migration and recording it; a deliberately broken one rolled back, not
  recorded, non-zero exit. Both test files and their tables were removed
  afterwards.
- `schema.sql` on a throwaway database (created and dropped on the dev
  Postgres server) yields 11 rows in `schema_migrations`.
- App: `tsc -b`, oxlint, 98/98 tests, and a `vite build` (into a scratch
  directory, not `app/dist`, which staging serves) whose bundle contains
  the commit stamp.

Not verified here: this sandbox has no Docker CLI, so the image build
(`COPY db/migrations`, the `GIT_COMMIT` arg), `deploy/up.sh`, and the
pinned PowerSync image are untested until the first staging rollout.
Staging and production still need their one-time `baseline`.

## Next

- The changelog pipeline: one source file, a generated page on the
  public website, "What's new" on About, and the same text reused as
  store release notes. `deploy-app.sh` will require an entry for the
  new version.
- The public website refresh (`website/` is out of date).
- Later: `minAppVersion` from the api, so old store builds can ask users
  to update instead of breaking.

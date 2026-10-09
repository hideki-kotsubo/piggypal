# Redeploying Flowtab

Day-to-day checklist for shipping changes. First-time host setup lives in
[README.md](README.md). There are three environments (docs/58):

| | Dev | Staging | Production |
|---|---|---|---|
| Where | this machine | this machine | its own server |
| Domain | `app-beta.codexbase.dev` | `app.codexbase.dev` | `app.myflowtab.com` (not final) |
| App | Vite dev server, `:3001` (`npm run dev:app`) | `app/dist`, served by nginx | `app/dist`, served by nginx |
| App env | `app/.env.development.local` | `app/.env.production.local` | `app/.env.production.local` (on that server) |
| api | host process, `:3002` (`npm run dev:api`) | `flowtab-api` container | `flowtab-api` container |
| api env | `api/.env` | `deploy/.env` | `deploy/.env` (on that server) |
| Postgres | `flowtab-dev-postgres` (host port `5433`) | `flowtab-postgres` | `flowtab-postgres` |
| PowerSync | `flowtab-dev-powersync` | `flowtab-powersync` | `flowtab-powersync` |
| Compose | `docker-compose.dev.yaml` + `.env.dev` | `docker-compose.yaml` + `.env` | `docker-compose.yaml` + `.env` |
| Code | any branch | `main`, at the new tag | a release tag, checked out |

All real env files are gitignored; only the `*.example` templates are
committed.

How a release flows: merge to `main` → run a release script (bumps the
version, tags, pushes) → staging on this machine → test → check out the
same tag on the production server. Only ever release from `main`, and
only ever run production from a tag.

---

## Release (this machine)

The release scripts refuse to run unless you're on `main` with a clean
working tree, and they push to `origin`. Merge your feature branch first.

### 1. Merge to main

```bash
cd ~/projects/flowtab
git checkout main
git merge --no-ff <branch>
git push origin main
```

### 2. Cut the release and roll it out to staging

Only for the component(s) that changed. Each script prints the exact next
steps, including the production ones.

```bash
./scripts/deploy-api.sh            # bump api, tag api-vX.Y.Z, push
deploy/up.sh api                   # rebuild the staging api container
curl https://api.flowtab.codexbase.dev/health

./scripts/deploy-app.sh            # bump app, tag app-vX.Y.Z, push, build app/dist
```

- Both scripts take `patch` (default), `minor` or `major`.
- **Database migrations apply themselves** when the api container starts
  (docs/58 D220). Check the log for `migrate: applying ...`; `/health`
  reports the newest one as `"schema"`.
- Always rebuild through `deploy/up.sh`, never `npm run build` alone (that
  leaves the container on the old code). `deploy/up.sh` is
  `docker compose up -d --build` plus the commit stamp; a bare
  `docker compose up -d --build` still works but `/health` then shows
  `"commit":"unknown"`.
- `deploy/up.sh` also runs `docker image prune -f` afterwards, removing the
  untagged images earlier builds left behind. Docker's build cache is kept
  (it's what makes rebuilds fast); trim it by hand now and then with
  `docker builder prune -f --filter until=168h`.
- `/health` returns `version`, `commit` and `schema`. The app's About
  screen shows the version and commit.
- Only changed the sync rules (`deploy/powersync/*.yaml`)? Then
  `docker compose restart powersync` is enough.

### 3. Smoke test staging

```bash
curl https://api.flowtab.codexbase.dev/health
curl -o /dev/null -w '%{http_code}\n' https://powersync.flowtab.codexbase.dev/probes/liveness
```

A `502` from either means the nginx-proxy-manager proxy host doesn't reach
the container. Point it at the container name (`flowtab-api`,
`flowtab-powersync`), not the bare service name (`api`, `powersync`). Both
stacks share the Docker networks, so service names are ambiguous there.

Then use the app on `app.codexbase.dev` and check About shows the new
version.

---

## Production (its own server)

Production is a `git clone` of this repo. Roll out the **same tag** you
just tested on staging, never `main` directly.

```bash
cd flowtab
git fetch --tags

# api (migrations apply on startup)
git checkout api-vX.Y.Z
deploy/up.sh api
curl <prod-api-host>/health        # version, commit and schema as on staging

# app
git checkout app-vX.Y.Z
npm ci && npm run build -w app     # reads app/.env.production.local
```

Check out each tag right before building that component: the checkout
moves the whole tree, so building the app while the api tag is checked
out would build the wrong app code.

### One-time: start tracking migrations on an existing database

Databases created before docs/58 have no `schema_migrations` table. Until
they get one, the api logs a warning and applies nothing. Run this once
per database (staging and production):

```bash
docker compose exec api node api/dist/migrate-cli.js status     # "does not exist yet"
# check the live schema has every file in db/migrations/ (\d <table> in psql)
docker compose exec api node api/dist/migrate-cli.js baseline   # marks all as applied
```

If the database is behind (e.g. production hasn't had the newest
migrations), mark only what it really has, and let the api apply the rest:

```bash
docker compose exec api node api/dist/migrate-cli.js baseline 2026-09-29-magic-links-code.sql
docker compose restart api
```

---

## Dev

Code changes need no deploy: `tsx watch` restarts the api and Vite
hot-reloads the app.

### What to rerun after a change

| What changed | Do this |
|---|---|
| `api/src` | nothing, `tsx watch` restarts it |
| `app/src` | nothing, Vite hot-reloads |
| `api/.env` | restart `npm run dev:api` (reads `.env` only at startup) |
| `app/.env.development.local`, `vite.config.ts` | restart `npm run dev:app` |
| `deploy/powersync/*.yaml` | `docker compose -f docker-compose.dev.yaml --env-file .env.dev restart dev-powersync` |
| `deploy/.env.dev`, `docker-compose.dev.yaml` | rerun the `up -d` command below |
| new file in `db/migrations/` | restart `npm run dev:api`, it applies pending migrations on startup |

All `docker compose` commands below run from `deploy/`.

### Start the dev backend (first time, or after a reset)

```bash
cd ~/projects/flowtab/deploy
cp .env.dev.example .env.dev       # first time only: set POSTGRES_PASSWORD, PS_ADMIN_API_TOKEN
docker compose -f docker-compose.dev.yaml --env-file .env.dev up -d
docker compose -f docker-compose.dev.yaml --env-file .env.dev ps
```

Then make sure `api/.env` points at it and restart `npm run dev:api`:

```
DATABASE_URL=postgres://flowtab:<password>@<host>:5433/flowtab
```

Use `127.0.0.1` as `<host>`, or the host's private IP (`10.71.71.55`) if
`DEV_PG_BIND` in `.env.dev` is set to it. Use it when the dev api can't
reach the host's loopback.

### Migrations in dev

`npm run dev:api` applies pending `db/migrations/` files on startup, same
as staging/production (docs/58). To check or apply without a restart:

```bash
npm run migrate -w api -- status
npm run migrate -w api -- up
```

When you add a migration, also update `db/schema.sql` to match and add the
filename to the `schema_migrations` insert at its end. Otherwise a fresh
database would apply it on top of a schema that already has it.

### Reset dev to an empty database

```bash
docker compose -f docker-compose.dev.yaml --env-file .env.dev down -v   # -v deletes the dev volume
docker compose -f docker-compose.dev.yaml --env-file .env.dev up -d
```

This rebuilds from the current `schema.sql`, so no migrations are needed
afterwards. Browsers signed in to `app-beta` must sign in again. If uploads
stay stuck, use Settings → "Reset local data".

Dev never uses the release scripts. They're for staging/production only.

---

## Handy commands

```bash
# psql shells
docker exec -it flowtab-postgres     psql -U flowtab -d flowtab   # staging (or prod, on its server)
docker exec -it flowtab-dev-postgres psql -U flowtab -d flowtab   # dev

# logs
docker compose logs -f api powersync                                              # staging/prod
docker compose -f docker-compose.dev.yaml --env-file .env.dev logs -f dev-powersync  # dev
```

If you changed `POSTGRES_USER`/`POSTGRES_DB` in an env file, use those values
instead of `flowtab`.

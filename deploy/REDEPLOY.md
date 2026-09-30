# Redeploying Flowtab

Day-to-day checklist for shipping changes to an already-running setup.
First-time host setup lives in [README.md](README.md). Both environments run
on the same machine from the same checkout:

| | Production | Dev |
|---|---|---|
| App | `app/dist`, built by `vite build`, served by nginx | Vite dev server, `:3001` (`npm run dev:app`) |
| App env | `app/.env.production.local` | `app/.env.development.local` |
| api | `flowtab-api` container (`docker-compose.yaml`) | host process, `:3002` (`npm run dev:api`) |
| api env | `deploy/.env` | `api/.env` |
| Postgres | `flowtab-postgres` | `flowtab-dev-postgres` (host port `5433`) |
| PowerSync | `flowtab-powersync` | `flowtab-dev-powersync` |
| Compose | `docker-compose.yaml` + `.env` | `docker-compose.dev.yaml` + `.env.dev` |
| Proxy hosts | `api.*` → `flowtab-api:3002`, `powersync.*` → `flowtab-powersync:8090` | `powersync-beta.*` → `flowtab-dev-powersync:8090` |

All real env files are gitignored; only the `*.example` templates are
committed.

---

## Production

The deploy scripts refuse to run unless you're on `main` with a clean
working tree, and they push to `origin`. Merge your feature branch first.

### 1. Merge to main

```bash
cd ~/projects/flowtab
git checkout main
git merge --no-ff <branch>
git push origin main
```

### 2. Apply new database migrations (before the api)

`db/schema.sql` only runs on a brand-new volume, so every new file in
`db/migrations/` has to be applied by hand. To see what's new since the
last api deploy:

```bash
git diff --name-only $(git describe --tags --match 'api-v*' --abbrev=0) main -- db/migrations
```

That needs at least one `api-v*` tag. Before the first `deploy-api.sh`
run there is none: list `db/migrations/` and check each against the live
schema instead (`\d <table>` in psql).

Apply each one, oldest first:

```bash
docker exec -i flowtab-postgres psql -U flowtab -d flowtab < db/migrations/<file>.sql
```

Apply migrations **before** deploying the api. New api code that expects
new columns fails against an old schema.

### 3. api (plus PowerSync and Postgres config)

```bash
./scripts/deploy-api.sh            # bump api version, tag api-vX.Y.Z, push
cd deploy && docker compose up -d --build
docker compose ps                  # all three healthy
docker compose logs --tail 50 powersync
curl https://api.flowtab.codexbase.dev/health    # shows the new version
```

- Always use `docker compose up -d --build`. `npm run build` alone leaves the
  container on the old code.
- `deploy-api.sh` takes `patch` (default), `minor` or `major`.
- Compose only recreates containers whose config changed. Postgres data lives
  in the `pgdata` volume and survives this.

Only changed the sync rules (`deploy/powersync/*.yaml`)? Then
`docker compose restart powersync` is enough.

### 4. App

```bash
./scripts/deploy-app.sh            # bump app version, tag app-vX.Y.Z, push, build app/dist
```

- `vite build` reads `app/.env.production.local`. Check its URLs point at
  the **production** api and PowerSync, not the `-beta` (dev) hosts.
- If nginx serves `app/dist` straight from this checkout, it's live once the
  build finishes. Otherwise copy `app/dist/` (and `website/` if it changed)
  to where nginx serves it.
- Verify: reload the app and check Settings → About shows the new version.

### 5. Smoke test

```bash
curl https://api.flowtab.codexbase.dev/health
curl -o /dev/null -w '%{http_code}\n' https://powersync.flowtab.codexbase.dev/probes/liveness
```

A `502` from either means the nginx-proxy-manager proxy host doesn't reach
the container. Point it at the container name (`flowtab-api`,
`flowtab-powersync`), not the bare service name (`api`, `powersync`). Both
stacks share the Docker networks, so service names are ambiguous there.

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
| new file in `db/migrations/` | apply it to the dev database (below) |

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

### Apply a migration to dev

```bash
docker exec -i flowtab-dev-postgres psql -U flowtab -d flowtab < db/migrations/<file>.sql
```

### Reset dev to an empty database

```bash
docker compose -f docker-compose.dev.yaml --env-file .env.dev down -v   # -v deletes the dev volume
docker compose -f docker-compose.dev.yaml --env-file .env.dev up -d
```

This rebuilds from the current `schema.sql`, so no migrations are needed
afterwards. Browsers signed in to `app-beta` must sign in again. If uploads
stay stuck, use Settings → "Reset local data".

Dev never uses the version/tag scripts. They're production-only.

---

## Handy commands

```bash
# psql shells
docker exec -it flowtab-postgres     psql -U flowtab -d flowtab   # prod
docker exec -it flowtab-dev-postgres psql -U flowtab -d flowtab   # dev

# logs
docker compose logs -f api powersync                                              # prod
docker compose -f docker-compose.dev.yaml --env-file .env.dev logs -f dev-powersync  # dev
```

If you changed `POSTGRES_USER`/`POSTGRES_DB` in an env file, use those values
instead of `flowtab`.

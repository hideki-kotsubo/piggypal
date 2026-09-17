# Deploying the backend — two options

## Option A: `docker-compose.yaml` (this directory) — fresh, self-contained stack

Postgres + `api` (built from source) + PowerSync Service, all in one file.
Use this to stand up the whole backend on a clean machine with one command.
It creates its own Postgres with its own named volume — the one thing it
does expect to already exist is the host's `docker-stack_frontend` /
`docker-stack_backend` Docker networks (same ones `powersync/docker-compose.yaml`
already joins as `docker-stack_backend`, below): `api` and `powersync` join
both so nginx-proxy-manager, running on `docker-stack_frontend`, can reach
them directly by container name; `postgres` joins `backend` only. If your
host's networks are named differently, update the `networks:` block at the
top of `docker-compose.yaml` to match (`docker network ls` to check).

```bash
cd deploy
cp .env.example .env

# Fill in .env:
#  - POSTGRES_PASSWORD, PS_ADMIN_API_TOKEN — pick real values
#    (PS_ADMIN_API_TOKEN: openssl rand -hex 32)
#  - JWT_PRIVATE_KEY / JWT_PUBLIC_KEY — generate once:
npm run -w api generate-jwt-keys
#    paste the two printed lines into .env as-is (already \n-escaped)
#  - APP_BASE_URL / CORS_ORIGIN — wherever app/'s built static files
#    (app/dist) end up served from
#  - RESEND_API_KEY — optional; unset just logs magic links instead of
#    emailing them, fine for a first smoke test

docker compose up -d --build
docker compose logs -f
```

What's pre-baked in vs. the manual runbook below, based on real problems
hit deploying this stack the first time (see `powersync/README.md`'s "Real
problems hit and fixed"):

- Postgres starts with `wal_level=logical` and `md5` auth already set —
  both are the exact things that bit the original deploy (scram-sha-256
  incompatibility, and a restart-required WAL setting).
- `CREATE PUBLICATION powersync FOR ALL TABLES;` runs automatically on
  first boot (`postgres-init/02-create-publication.sql`), right after
  `db/schema.sql` — the original deploy hit `PSYNC_S1141` from missing
  this.
- `PS_JWKS_URL` defaults to the internal `http://api:3002/...` address,
  not a public domain — PowerSync and `api` share this compose's network,
  so no DNS record is needed just for token verification. (This is the
  exact gap that broke sync after the piggypal → flowtab domain rename:
  `api`'s own public subdomain hadn't been created yet, and PowerSync had
  no way to reach it internally either, since the two were deployed as
  separate, unrelated stacks.)

Still manual, same as any fresh deploy:
- A real JWT keypair (never generated at container boot, deliberately —
  see `api/src/jwt.ts`'s comment on why).
- `api`/`powersync` publish no host port by design (only reachable over
  `docker-stack_frontend`) — in nginx-proxy-manager's UI, add a proxy host
  per public domain pointing at the container name/port directly (e.g.
  `http://api:3002`, `http://powersync:8090`), same as any other container
  already proxied on that network. Not needed at all if `app/` is
  configured to reach them by internal container address instead.
- `app/`'s own `VITE_API_BASE_URL` / `VITE_POWERSYNC_URL` build-time env
  vars, pointed at whichever public domains you give them above.

## Option B: `powersync/` — PowerSync only, against an existing Postgres

The original setup: assumes Postgres and `api` already exist and run
elsewhere (an external `docker-stack_backend` network), and only adds
PowerSync Service to that existing stack. Use this if you already have a
running deployment and just need to (re)point PowerSync at it — see
`powersync/README.md` for its own runbook, including every real problem
hit getting it running the first time.

Untouched by Option A above — the two don't share a Postgres instance or
a network, so running both against the same data isn't what this repo's
layout does today. Pick one per environment.

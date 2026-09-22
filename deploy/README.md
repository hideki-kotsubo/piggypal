# Deploying Flowtab

## Fresh host, start to finish

Everything below assumes a bare Linux host with nothing installed yet —
app, api, and the Docker-based backend (Postgres + PowerSync). If you
already have Docker/nginx-proxy-manager running and just need the backend
stack, skip to "Option A" below.

### 0. Base host prep

```bash
# Docker Engine + Compose plugin (Debian/Ubuntu — adjust for your distro)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # log out/in after this

# Node.js — only needed for one-off JWT keygen and building app/'s static
# files; nothing in the Docker stack itself needs Node on the host
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git
```

### 1. Reverse proxy + networks

`docker-compose.yaml` (this directory) expects two **already-existing**
external Docker networks — `docker-stack_frontend` / `docker-stack_backend`
— so nginx-proxy-manager can reach `api`/`powersync` by container name. If
this host doesn't have nginx-proxy-manager yet:

```bash
mkdir -p ~/nginx-proxy-manager && cd ~/nginx-proxy-manager
docker network create docker-stack_frontend
docker network create docker-stack_backend
```

```yaml
# ~/nginx-proxy-manager/docker-compose.yaml
services:
  npm:
    image: jc21/nginx-proxy-manager:latest
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
      - "81:81"   # admin UI
    volumes:
      - ./data:/data
      - ./letsencrypt:/etc/letsencrypt
    networks:
      - docker-stack_frontend
networks:
  docker-stack_frontend:
    external: true
```

```bash
docker compose up -d
# admin UI at http://<host-ip>:81 — default login admin@example.com /
# changeme, change immediately
```

Already running nginx-proxy-manager elsewhere with different network
names? Don't recreate it — just edit the `networks:` block at the top of
`docker-compose.yaml` to match your actual network names (`docker network
ls` to check) and skip this step.

### 2. Get the code

```bash
git clone <your-repo-url> flowtab
cd flowtab
npm install
```

### 3. Backend: Postgres + api + PowerSync

See "Option A" below for the full `.env` walkthrough — short version:

```bash
cd deploy
cp .env.example .env
# fill in .env: POSTGRES_PASSWORD, PS_ADMIN_API_TOKEN (openssl rand -hex 32),
# JWT_PRIVATE_KEY/JWT_PUBLIC_KEY (npm run -w api generate-jwt-keys — a
# FRESH keypair per environment, never reuse another deploy's keys)
docker compose up -d --build
docker compose logs -f
```

Clean start looks like: Postgres healthy → `api listening on :3002` →
PowerSync logs replication starting, no `"level":"error"` lines.

Verify before exposing anything publicly:

```bash
docker compose exec api node -e "fetch('http://localhost:3002/health').then(r=>r.json()).then(console.log)"
docker compose exec powersync node -e "fetch('http://localhost:8090/probes/liveness').then(r=>console.log(r.status))"
```

### 4. Expose api/powersync publicly

In nginx-proxy-manager's UI (port 81), add a **Proxy Host** for each,
pointing at the container name/port directly (same network, no host port
needed):
- `api.yourdomain.com` → `http://api:3002`
- `powersync.yourdomain.com` → `http://powersync:8090`

Point DNS `A` records for both at the host's IP *before* requesting SSL
(Let's Encrypt) on them in the same dialog, or the cert request fails.

### 5. Frontend: `app/` and `website/`

Not containerized yet (no Dockerfile for either) — static output served
directly by nginx, same pattern as the existing production setup.

```bash
cd flowtab/app
cp .env.example .env
```

Edit `app/.env`:
```
VITE_API_BASE_URL=https://api.yourdomain.com
VITE_POWERSYNC_URL=https://powersync.yourdomain.com
VITE_RELAY_WS_URL=wss://api.yourdomain.com/relay
```

```bash
npm run build -w app   # outputs app/dist
```

To actually serve `app/dist` and `website/`, pick one:
- a plain nginx container bind-mounting both folders, added as another
  service on `docker-stack_frontend` and proxied from nginx-proxy-manager
  like `api`/`powersync` above (not built yet — ask if you want this
  added to `docker-compose.yaml`), or
- a host-level nginx `conf.d` file with `root` pointing directly at
  `flowtab/app/dist` and `flowtab/website/` — the exact pattern the
  current production nginx configs already use.

### 6. DNS

Point `A` records for every domain used above (`api.*`, `powersync.*`,
`app.*`, and the root marketing domain) at the new host's IP.

### 7. Smoke test

Sign in through the real UI, confirm a magic-link log appears in
`docker compose logs api` (or a real email if `SMTP2GO_API_KEY` is set in
`deploy/.env`), click through, and confirm PowerSync sync connects with
no 401s in `docker compose logs powersync`.

---

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
#  - SMTP2GO_API_KEY — optional; unset just logs magic links instead of
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

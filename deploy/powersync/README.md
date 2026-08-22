# Deploying PowerSync Service — runbook

Companion to `docs/39-production-deployment.md` step 3. **Confirmed
working end-to-end 2026-08-22**: PowerSync Service is running for real
against the production `postgres` container on `docker-stack_backend`,
replicating (`"Initial replication already done"`, actively streaming
WAL ops, zero errors). This README reflects the real deploy, not the
theoretical one — see "Real problems hit and fixed" below for what
actually went wrong along the way, since none of it was guesswork after
the fact.

Written/run on the real host with Docker (this dev sandbox can't run any
container runtime at all, see docs/39). Config schema verified against
[powersync-ja/self-host-demo](https://github.com/powersync-ja/self-host-demo)'s
Postgres-bucket-storage variant, not guessed; column names verified
against this repo's *actual* live `db/schema.sql` (`psql \d`), not
docs/03's stale inline SQL.

## Pre-flight (all confirmed done 2026-08-21/22 — nothing left here)

- `wal_level=logical` on `postgres` — already set.
- `piggypal` role has `REPLICATION` — granted (`\du piggypal`).
- **`CREATE PUBLICATION powersync FOR ALL TABLES;`** run against the
  `piggypal` database, as the superuser. Standard logical-replication
  requirement PowerSync doesn't create automatically — without it,
  replication fails with `PSYNC_S1141: Publication 'powersync' does not
  exist`, a clear error, but easy to miss the first time.
- `docker-compose.yaml` joins the `docker-stack_backend` network
  explicitly (`networks: default: external: true`) — needed for the
  `postgres` hostname in `.env`'s connection URIs to resolve via
  Docker's embedded DNS.

## Deploy

```bash
cd deploy/powersync
cp .env.example .env
# edit .env: real PS_DATA_SOURCE_URI / PS_STORAGE_SOURCE_URI (see the
# md5-auth note below — don't assume scram-sha-256 just works), a real
# PS_ADMIN_API_TOKEN (openssl rand -hex 32), a free PS_PORT.

docker compose up -d
docker compose logs -f powersync
```

A clean start looks like: modules load, `Starting Replication Engine`,
`Running on port <PS_PORT>`, `Loaded sync config`, then (once the
publication exists) `Initial replication already done` /
`Replicating op 0 <lsn>`, no `"level":"error"` lines after that point.

## Real problems hit and fixed (2026-08-21/22, on the actual deploy)

1. **`no port specified: :<empty>`** — `.env` didn't exist yet, only
   `.env.example`. Compose needs the real `.env` (`cp .env.example .env`)
   to resolve `${PS_PORT}` etc.
2. **Stale "Created" container, never actually started** — a leftover
   from the failed attempt above. Fixed with `docker compose down`
   before retrying (not just `up -d` again).
3. **`port is already allocated`** — `PS_PORT=8080` collided with
   another service already on that host. `PS_PORT` is arbitrary (ends up
   behind nginx-proxy-manager eventually), so just pick a free one —
   `.env.example` now defaults to `8090` instead, with a comment.
4. **`password authentication failed for user "piggypal"`, repeatedly,
   even with a confirmed-correct password.** The real cause, found by
   comparing `pg_hba.conf` against where the connection actually
   originates: connections from `127.0.0.1` hit a `trust` rule (no
   password check at all — this is why an earlier same-container `psql`
   test gave a false "it works," see the mistake noted below), while
   PowerSync's connection (from a different container, over
   `docker-stack_backend`) hits the real `host all all all
   scram-sha-256` rule. A throwaway `docker run --rm --network
   docker-stack_backend postgres:17 psql ...` from the *same* network
   path confirmed real `psql` succeeds there with scram-sha-256 — so the
   password, network, and Postgres config were all genuinely correct.
   PowerSync's own Postgres client library (`pgwire`) still failed
   identically every time regardless — a real client-library/SCRAM
   incompatibility, not a config mistake. **Workaround**: added an
   `md5`-specific `pg_hba.conf` rule for `piggypal` ahead of the
   `scram-sha-256` catch-all, and re-set the role's password with
   `SET password_encryption = 'md5'` first so the stored hash actually
   matches. Confirmed working immediately after. If a future PowerSync
   version fixes SCRAM support, this workaround could probably be
   reverted — not verified either way, not worth chasing right now.
   **Mistake worth flagging**: an early "verification" step
   (`docker exec -it postgres psql -h 127.0.0.1 ...`) looked like a
   real password test but wasn't — it hit the `trust` rule and would
   have "succeeded" with any password. Don't trust a same-container
   loopback test for this; test from the actual network path instead
   (the throwaway-container trick above).
5. **`Unknown function, Invalid SQLite cast` on the `transactions`
   stream.** Not a syntax error — `sync-config.yaml`'s original 18-month
   window (`occurred_at >= (now() - interval '18 months')`) used
   `now()`/`interval`, and PowerSync sync rules must be fully
   deterministic — no time-based or random functions at all, confirmed
   against PowerSync's own docs and a maintainer discussion
   ([powersync-ja discussion #445](https://github.com/orgs/powersync-ja/discussions/445)).
   **Dropped the window entirely for now** (syncs full transaction
   history) rather than hack around it — the real fix needs either a
   cron-maintained `sync_active` boolean column or client-computed
   time-bucket parameters, genuine schema/app work tracked as a followup
   in `docs/00-backlog.md`, not something to improvise mid-deploy.

## Verify

```bash
curl http://localhost:${PS_PORT}/probes/liveness
# {"ready":true,"started":true,"touched_at":"..."} — confirmed real, not aspirational.

curl -H "Authorization: Bearer $PS_ADMIN_API_TOKEN" \
  http://localhost:${PS_PORT}/api/status
```

Still not verified: an actual client sync round-trip from `app/`. That
needs the JWKS blocker below resolved first, plus wiring a real
connector into `app/src/lib/db.ts` (still local-only mode).

## What's still blocking real client use

**The JWKS endpoint's code exists (docs/40), but has no production
keypair behind it.** `GET /.well-known/jwks.json` is real on `api/` —
but 500s until `JWT_PRIVATE_KEY`/`JWT_PUBLIC_KEY` are generated
(`npm run -w api generate-jwt-keys`) and deployed wherever `api/`
actually runs in production, which hasn't happened. PowerSync itself is
fully healthy without this — it just can't authenticate any real client
yet. `deploy/powersync/.env`'s `PS_JWKS_URL` already points at the right
URL for once this is done.

## Expose it

Reverse-proxy through the same nginx-proxy-manager instance already
fronting `app.piggypal.codexbase.dev` / `api-beta.piggypal.codexbase.dev`,
onto a new subdomain — TLS the same way those two already get it.
Subdomain name is docs/39's open question #4, not decided here.

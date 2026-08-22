# 39 — Production Deployment Runbook

## Why this doc exists

The server phase (docs/02-06) is fully specified but nothing beyond
`api/src/relay.ts`'s WebSocket relay (docs/28) is actually deployed
anywhere. This is the operational runbook for standing up the rest:
Postgres, PowerSync Service, and the auth/sync/Stripe/AI routes on `api/`.
It doesn't relitigate any architecture — everything here follows directly
from what docs/02-06 already locked. Where a real choice is still open
(which host, secrets storage, etc.), it's flagged as a question, not
guessed at.

## What's already live vs. what's net-new

Already running somewhere real (not this dev sandbox), behind
nginx-proxy-manager, per `app/.env`/CLAUDE.md:

- `app.piggypal.codexbase.dev` — the Vite dev build (docs/07 etc.)
- `api-beta.piggypal.codexbase.dev` — `api/`, currently just `/health`
  and docs/28's WebSocket relay (`/relay`)

Net-new for this phase:

- A real Postgres instance with `db/schema.sql` applied
- PowerSync Service (self-hosted Open Edition, Docker) pointed at it
- `api/` growing three real route groups: auth (docs/05), sync upload +
  PowerSync's JWKS endpoint (docs/03), Stripe checkout/webhook
  (docs/06) — plus `/api/parse` (docs/04) once Tier 2 AI is built
- Azure Communication Services account (magic-link email, docs/05 D15)
- A Stripe account + product/price (docs/06)
- The client (`app/`) actually passing a PowerSync connector instead of
  running in local-only mode (`app/src/lib/db.ts`)

## A real constraint discovered building this doc

This dev sandbox cannot run Docker or Podman — its outer container was
started without `CAP_SYS_ADMIN` (blocks overlay mounts) or the
`unshare`/`clone(CLONE_NEWUSER)` syscalls (blocks rootless user
namespaces), confirmed by directly attempting both `dockerd` and
rootless `podman run`. Neither is fixable from inside the sandbox — it's
set at container-creation time by whatever launched it. **db/schema.sql
was instead verified against a native (non-containerized) `apt install
postgresql` in this sandbox** — functionally identical to what
`docker-compose.yml` does, just without the container layer; all 9
tables (`accounts`, `budgets`, `categories`, `category_keywords`,
`magic_links`, `refresh_tokens`, `subscriptions`, `transactions`,
`users`) created cleanly. **PowerSync Service itself still needs a real
host with working Docker** — it only ships as a Docker image, so it
can't be smoke-tested in this sandbox at all. Whatever host already
serves `api-beta.piggypal.codexbase.dev` is the leading candidate,
*if* Docker actually works there (open question below).

## Step-by-step

### 1. Postgres — done

**Resolved 2026-08-21**: self-hosted, not managed Azure Postgres —
docs/02 named Azure Database for PostgreSQL as the target, but a
self-hosted instance also satisfies its architecture (deployment-target
choice, not a locked D-decision), and a real one already existed: a
`postgres` container on the `docker-stack_backend` Docker network,
alongside whatever else that stack already runs.

Full pre-flight checklist confirmed against it, step by step in this
session:
- `piggypal` role + database created
- `db/schema.sql` applied — `\dt` shows all 9 tables
- `wal_level=logical` — already set, no restart needed
- `piggypal` role granted `REPLICATION` — confirmed via `\du piggypal`

No migration tool exists yet (docs/00-backlog's Vitest-adjacent
housekeeping item list doesn't even cover this) — fine for this one-time
clean apply; becomes a real gap the moment this schema needs to change
post-launch. **Worth deciding before the first schema change ships, not
deferred indefinitely** — flagging, not solving here.

### 2. Secrets & environment variables

Everything below is determined by docs/05/06's locked design; naming is
this doc's own proposal, not previously fixed anywhere:

| Variable | Used by | Per docs |
|---|---|---|
| `DATABASE_URL` | `api/` (all routes), PowerSync Service config | 02 |
| `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` (RS256 keypair) | `api/` signs access JWTs; also served at `/.well-known/jwks.json` for PowerSync Service to verify | 05 D13 |
| `MAGIC_LINK_TOKEN_SECRET` (or DB-only, hashed at rest per D12 — pick one) | `api/`'s magic-link issuance | 05 D12 |
| Azure Communication Services connection string | `sendMagicLinkEmail` adapter | 05 D15 |
| `STRIPE_SECRET_KEY` | Checkout session creation | 06 |
| `STRIPE_WEBHOOK_SECRET` | `/api/stripe/webhook` signature verification — **not** JWT-authenticated, this is its only auth | 06 |
| `STRIPE_PRICE_ID` | Checkout session creation | 06 |
| `COOKIE_DOMAIN` | Refresh-token httpOnly cookie (D13) — needs to cover whatever subdomain the app is actually served from | 05 |
| `PORT` | `api/` — already exists (`api/.env`, currently `3002`) | — |

Where these actually live (a secrets manager, `.env` on the host, Azure
Key Vault) is unset — `api/.env` today is a plain gitignored file,
fine for the relay's one `PORT` value, not something to keep doing by
hand once real secrets (Stripe keys, a private signing key) are
involved. **Open question, worth deciding before step 4.**

### 3. PowerSync Service — running for real

**2026-08-22: actually deployed and confirmed healthy** against the real
`postgres` container — `"Initial replication already done"`, actively
replicating, zero errors, `{"ready":true,"started":true}`. Not a
theoretical deploy; see `deploy/powersync/README.md`'s "Real problems
hit and fixed" section for the full blow-by-blow (a pgwire/SCRAM
incompatibility worked around with `md5` auth, a missing
`CREATE PUBLICATION`, and dropping the 18-month transaction window
entirely since PowerSync sync rules can't express relative-time
filters — `now()`/`interval` are unsupported by design, not a syntax
bug). `deploy/powersync/` has the full config
(`docker-compose.yaml`/`service.yaml`/`sync-config.yaml`/`.env.example`)
plus that runbook.

One real thing dropped along the way, tracked as a followup (see
docs/00-backlog.md): the transactions stream now syncs **full history**,
not the originally-designed 18-month rolling window — re-adding that
needs either a cron-maintained boolean column or client-computed
time-bucket parameters (PowerSync's own recommended patterns), genuine
schema/app work, not done here.

Still not verified: an actual client sync round-trip from `app/` — needs
the JWKS blocker just below resolved, plus a real connector wired into
`app/src/lib/db.ts` (still local-only mode as of this writing).

**Remaining real blocker**: `client_auth.jwks_uri` points at
`https://api-beta.piggypal.codexbase.dev/.well-known/jwks.json`. The
route's code is real on `api/` (docs/40, `GET /.well-known/jwks.json`,
verified with a live sign→fetch→verify round trip) — but it 500s until
a real production `JWT_PRIVATE_KEY`/`JWT_PUBLIC_KEY` are generated
(`npm run -w api generate-jwt-keys`) and deployed wherever `api/`
actually runs, which hasn't happened. PowerSync itself doesn't need this
to be healthy — only real client authentication does.

Reverse-proxy through the same nginx-proxy-manager instance already
fronting `app`/`api-beta`, its own subdomain (open question #4 below,
not decided).

### 4. `api/` — auth, sync upload, Stripe, JWKS

All net-new routes on the already-deployed `api/` (same service that
serves `/health` and `/relay` today, so this is additive, not a new
deployment target):

- `POST /api/auth/magic-link` (request), `GET /api/auth/verify` (or
  similar — exact routes docs/05 doesn't pin down to the URL level)
- `GET /.well-known/jwks.json` — publishes the RS256 public key from
  step 2
- `POST /api/sync/upload` — PowerSync's write path (docs/03): verify
  JWT -> validate each op -> `insert ... on conflict ... where
  excluded.updated_at > table.updated_at` -> subscription gate
- `POST /api/stripe/webhook` — signature-verified, not JWT
- `GET/POST` around Stripe Checkout session creation

Ship behind the same deploy process already used for the relay (no
gap to close there — this sandbox doesn't have visibility into how that
host actually runs `api/`, e.g. `pm2`/systemd/Docker/bare `node`, so
match whatever that already is rather than introducing a second
pattern).

### 5. Stripe & Azure Communication Services accounts

Both are real external accounts to set up (product/price in Stripe,
a verified sending domain in Azure Communication Services) — outside
anything this repo can do unattended. **Needs the user directly.**

### 6. Client cutover

`app/src/lib/db.ts` currently passes no connector to `PowerSyncDatabase`
— that's the entire meaning of "local-only mode." Wiring a real
connector (pointed at step 3's PowerSync Service, gated behind sign-in
per docs/05's opt-in design) is the last step, and should happen only
after 1-5 are confirmed working independently — a broken connector
should never be able to touch a working local-only user's data, so this
is worth a feature flag or a separate build initially rather than
flipping it for everyone at once.

## Suggested order

1 (Postgres) -> 2 (secrets, at least generate the JWT keypair) -> 4's
JWKS endpoint specifically (needed before 3 can verify anything) -> 3
(PowerSync Service) -> rest of 4 (auth/sync/Stripe routes) -> 5 (external
accounts, can happen in parallel with 1-4) -> 6 (client cutover, last,
behind a flag).

## Open questions — need the user's answer, not assumed here

1. ~~Does the host serving `api-beta.piggypal.codexbase.dev` have working
   Docker?~~ **Resolved 2026-08-21: yes.**
2. ~~Managed Azure Database for PostgreSQL, or self-hosted?~~ **Resolved
   2026-08-21: self-hosted**, on the existing `docker-stack_backend`
   Docker network — see step 1 above.
3. Where do production secrets actually live — plain `.env` on the host
   (matches today's pattern, doesn't scale to Stripe keys), or a real
   secrets manager? *(Still open — `deploy/powersync/.env` and a real
   `api/.env` both currently assume plain host files.)*
4. Subdomain for PowerSync Service, following the existing
   `<name>.piggypal.codexbase.dev` convention. *(Still open.)*
5. Who sets up the Stripe product/price and Azure Communication Services
   sending domain, and when — before or after the API code that needs
   their keys is written? *(Still open.)*

**2026-08-21.**

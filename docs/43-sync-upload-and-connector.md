# 43 — Sync Upload Endpoint + PowerSync Connector, Implemented

## What this closes

docs/03's write path (`POST /api/sync/upload`) and the client half of
docs/02's topology (`app/`'s `PowerSyncBackendConnector`) — the last two
pieces standing between "PowerSync Service is deployed and JWKS/auth
exist" (docs/39-41) and an actual signed-in device syncing for real. Built
together with docs/42's app-side auth flow because a connector with no
upload endpoint to call would queue every local write against a 404,
retrying forever — not a stub worth shipping on its own.

## What's implemented

- **`api/src/sync/routes.ts`** — `POST /api/sync/upload`, gated by the
  same `requireAccessToken` middleware docs/41 built. Wire shape
  (`{ ops: [{table, op, id, data}] }`) is this endpoint's own choice —
  docs/03 only specifies the route exists and what the handler must do,
  same kind of interpretation call docs/41 flagged for its own routes.
  Table-driven: a `TABLE_COLUMNS` allowlist per table (accounts,
  categories, transactions, budgets, category_keywords — matching
  `db/schema.sql` exactly), `user_id` always forced from the verified
  JWT and never trusted from the payload (docs/03 point 1). PUT does a
  full-row upsert, PATCH updates only the columns present in `opData`,
  DELETE is a real `DELETE ... WHERE id = ? AND user_id = ?` — all three
  share an ownership guard (the `ON CONFLICT ... WHERE table.user_id = $2`
  clause / the `WHERE user_id = $2` on UPDATE/DELETE) so one user's
  client-generated id can never touch another user's existing row.
- **`app/src/lib/connector.ts`** — `PiggypalConnector implements
  PowerSyncBackendConnector`. `fetchCredentials()` backs onto docs/41's
  `/api/auth/powersync-token`; `uploadData()` uses
  `database.getNextCrudTransaction()` (one local transaction's ops per
  call, not the whole queue at once — a failure partway through a large
  offline backlog doesn't have to redo everything already-uploaded before
  it) and posts to the new endpoint.
- **`app/src/lib/db.ts`** — still constructs `PowerSyncDatabase` with no
  connector (every read/write always hits local SQLite directly,
  unconditionally — docs/01 D1's "UI never awaits network" untouched).
  `connectSync()`/`disconnectSync()` layer `db.connect()`/`disconnect()`
  on top; only called from docs/42's sign-in flow and its on-load
  reconnect-if-remembered check. `useSyncStatus()` exposes
  `db.currentStatus` to Settings — connected/connecting/not-connected,
  the only sync-status surface built (see "not in scope" below).

## Real simplifications vs. docs/02/03's literal wording — flagged, not silently decided

1. **"Last-write-wins by `updated_at`" is actually "last upload wins."**
   docs/02/03 specify comparing `excluded.updated_at > table.updated_at`
   on conflict. `app/src/lib/schema.ts` (the local SQLite schema) doesn't
   track `updated_at` at all, so the client has no value to send or
   compare — this was true before this pass and isn't something this
   pass could fix without a schema change nobody asked for here. What's
   implemented instead: `updated_at = now()` stamped server-side on every
   upsert, unconditionally. This approximates the intended policy
   whenever devices are online reasonably promptly, but a long-offline
   device's stale edit landing after a newer one would win outright
   rather than lose, unlike true LWW. Acceptable for v1's realistic
   solo/small-household usage; would need a real local `updated_at`
   column to fix properly.
2. **The subscription gate (docs/03 point 4) is not implemented.** Same
   call docs/41 made for its own routes: `docs/06`'s `subscriptions`
   table has nothing that ever writes to it (no Stripe integration
   exists yet), so a gate here could only ever reject every request —
   that's not "enforcing paid tier," just breaking sync for everyone.
   Wire it in once docs/06 is real.
3. **Budgets' and category_keywords' own unique constraints
   (`(user_id, category_id, month, currency)` /
   `(user_id, category_id, keyword)`) aren't specially reconciled.**
   docs/02's conflict table describes "unique constraint + LWW on
   amount" for budget collisions specifically. This endpoint's upsert
   only targets the `id` primary key's `ON CONFLICT` — Postgres allows
   one conflict arbiter per `INSERT`, and handling *both* the id
   collision and the separate unique-constraint collision in one
   statement isn't straightforward. The real scenario this misses: two
   devices, both offline, independently create a budget (or keyword) for
   the same slot with two different client-generated ids — on upload,
   the second one hits a genuine Postgres unique-violation error, which
   this handler just rethrows (500, PowerSync retries indefinitely)
   rather than resolving per docs/02's policy. Narrow edge case, not
   fixed here.

## A real bug found and fixed, after initial deploy

`api/src/index.ts`'s CORS setup only ever allowed one hard-coded origin,
defaulting to `http://localhost:3001` when `CORS_ORIGIN` was unset — which
it was, on the real `api-beta` deployment. This went unnoticed since
docs/28 because nothing before docs/42 ever made an HTTP `fetch()` from
`app-beta` to `api-beta` — docs/28's relay is WebSocket, which never
triggers a CORS preflight. The very first real request from the deployed
sign-in flow surfaced it immediately: a blocked preflight, "Access-
Control-Allow-Origin" reporting `localhost:3001` back to a request from
`app-beta.piggypal.codexbase.dev`. Fixed by making `CORS_ORIGIN` accept a
comma-separated list, defaulting to every origin `vite.config.ts`'s own
`allowedHosts` already anticipates (both app subdomains) instead of just
one — confirmed against a live preflight simulating the real browser
request (`Origin: https://app-beta.piggypal.codexbase.dev`), which now
correctly reflects that exact origin back. Still requires deploying this
change to the real `api-beta` host — this sandbox can't do that directly
(docs/39).

## Verified

A real, throwaway end-to-end script (not committed — no test runner
exists yet, same as docs/41), driven against the live `api/` dev server
and real Postgres, 11/11 assertions passing: missing-bearer-token → 401,
unknown table → 400, PUT across accounts/categories/transactions lands
correctly (including boolean coercion — SQLite's `0`/`1` → Postgres
`boolean` — and `user_id` forced from the JWT regardless of payload),
PATCH updates only the given column, DELETE actually removes the row, and
the cross-user ownership guard: a second user's PATCH request against the
first user's account succeeds at the HTTP level (no information leak
about whether the row exists) but silently doesn't touch the row.

docs/42's own Playwright run additionally exercised the connector for
real: `connectSync()` runs after a successful sign-in, and Settings'
"Cloud sync" status line correctly shows "Connecting…" against this
sandbox's unreachable `localhost:8080` fallback (see below) rather than
silently appearing connected or crashing.

`tsc --noEmit` clean on `api`; `tsc -b`/`oxlint` clean on `app`.

## Not in scope, still open

- **A real client↔PowerSync Service sync round-trip.** Per
  `deploy/powersync/README.md`'s own "still blocking real client use"
  section: no production JWKS keypair is deployed, and PowerSync
  Service's public subdomain isn't decided (docs/39 open question #4) —
  so `VITE_POWERSYNC_URL` has nothing real to point at yet.
  `app/.env` deliberately leaves it unset rather than inventing a
  subdomain; `connector.ts` falls back to `http://localhost:8080`, only
  useful against a locally-run PowerSync Service. This pass makes the
  client *capable* of connecting the moment those two things exist —
  it doesn't (and, in this sandbox, structurally can't — no Docker) prove
  the full round-trip end to end.
- **A "sign in to sync" banner** — see docs/42's own note; `useSyncStatus`
  exists but nothing proactively surfaces a disconnect outside Settings.
- **`resetLocalData()`'s interaction with a connected sync session** —
  unexamined. It's a real `DELETE FROM <table>` per table, issued through
  `db.writeTransaction()`, same as any other write — meaning once a
  device is signed in and connected, PowerSync's own triggers will queue
  real DELETE crud ops for every existing row, which this endpoint will
  now dutifully apply server-side too. Already flagged in `store.tsx` as
  a dev-stage-only escape hatch to remove once there's a real migration
  story; this pass doesn't change that flag or the risk it now carries in
  the connected case, and it's not exercised in the smoke tests above.

**2026-08-22.**

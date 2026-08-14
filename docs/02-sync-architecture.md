# 02 — Sync Architecture

## Topology

```
┌────────────────────────────┐
│  PWA (React/Vite)          │
│  ┌──────────────────────┐  │
│  │ SQLite (wa-sqlite /  │  │   reads/writes are LOCAL ONLY
│  │ OPFS) via PowerSync  │  │   UI never awaits network
│  │ web SDK              │  │
│  └─────────┬────────────┘  │
└────────────┼───────────────┘
     sync stream │  ▲ download: sync buckets (per-user partial replication)
                 ▼  │
┌────────────────────────────┐
│ PowerSync Service          │   self-hosted Open Edition, Docker
│ (Azure Container Apps;     │   sync-bucket storage: Postgres (beta)
│  Proxmox for prototyping)  │   — keeps stack Mongo-free
└──────┬─────────────────────┘
       │ logical replication
       ▼
┌────────────────────────────┐        ┌──────────────────────────┐
│ Postgres                   │◄───────│ Node.js/TypeScript API   │
│ (Azure Database for        │ writes │  /api/sync/upload        │
│  PostgreSQL)               │        │  /api/parse              │
└────────────────────────────┘        │  auth (magic link + JWT) │
                                      └──────────▲───────────────┘
                                                 │ upload queue (mutations)
                                                 │
                                       PWA client uploads writes here
```

Read path: Postgres → PowerSync Service → client SQLite (automatic).
Write path: client SQLite → upload queue → **our API** → Postgres. The API is
where validation, business rules, and the subscription gate live.

## Why PowerSync (decision D1/D2 rationale)

- **vs hand-rolled LWW over our own API**: fine for personal apps; at public
  scale you inherit clock skew, partial uploads, resume-after-weeks-offline,
  and schema migration on-device. Weeks of undifferentiated work.
- **vs ElectricSQL**: read-path sync only — the entire write path is DIY.
- **vs Replicache/Zero**: pushes more sync/conflict logic into app code.
- **PowerSync fit**: Postgres is its primary, most mature integration;
  Open Edition is free and self-hostable in Docker; write path deliberately
  routes through your own backend (which we want anyway for the subscription
  gate and validation). SQL Server support exists but is alpha (Dec 2025,
  CDC-based) — noted and rejected for now (D2).

## Multi-tenancy / partial replication

Sync rules are SQL with parameters from the JWT:

- Bucket keyed on `request.user_id()` → each device pulls only its owner's rows.
- Transactions windowed to 18 months on-device; older history via API.
- **This "future" note is now a real design**: see
  docs/24-household-sharing.md (household_id replaces user_id as the
  partition key on shared tables) and docs/25-p2p-device-sync.md (a
  separate, non-PowerSync transport for free-tier and offline device
  sync). Both are design-only as of 2026-08-14, not yet implemented — this
  doc's topology diagram above still describes the paid-tier path
  accurately.

## Conflict policy (v1)

Last-write-wins by `updated_at`, applied in the upload handler via
`insert ... on conflict (id) do update ... where excluded.updated_at > t.updated_at`.
Delete wins over concurrent edit (soft delete). Good enough for a
single-user-per-account budgeting app; revisit only if/when households land.

## Operational notes

- Postgres needs logical replication enabled (Azure flexible server supports it).
- PowerSync Service is stateless-ish; bucket storage in Postgres (beta) —
  monitor stability, fall back to Mongo container if it misbehaves (D4).
- JWT: our API issues tokens; PowerSync Service validates them (shared
  JWKS/secret). Token strategy details = open question #3.

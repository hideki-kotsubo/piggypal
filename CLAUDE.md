# CLAUDE.md — piggypal Budgeting PWA

## What this is

An offline-first budgeting/expense/savings PWA under the piggypal brand.
Positioning: **simple, light, private** — "you just type or say what you spent."
This project continues a brainstorm started in Claude chat; the full state of
that discussion lives in `docs/` — read `docs/01-scope-and-decisions.md` first.

## Repo status (2026-08-07)

Repo scaffolded, not yet a working product. `app/` (React/Vite PWA) and
`api/` (Node/TS/Express) are npm workspaces at the root; `db/schema.sql` has
the current Postgres schema, loaded automatically by `docker compose up`
(untested in the environment that scaffolded this — verify locally). No git
commits made yet.

Deliberate build order — a local-only vertical slice first, before sync,
auth, or the AI pipeline: `app/` renders a placeholder shell only; the real
Home screen (docs/07) isn't built. `api/` only has a `/health` route; auth
(docs/05), sync (docs/03), the AI pipeline (docs/04), and Stripe (docs/06)
are all fully specified but not implemented. PowerSync itself (docs/02) is
intentionally not wired up yet.

```
npm install        # from repo root — workspaces handle both app/ and api/
npm run dev:app     # Vite dev server — :3001, exposed via nginx-proxy-manager
                     # at app.piggypal.codexbase.dev (allowedHosts set accordingly)
npm run dev:api      # API with hot reload (tsx watch) — :3000
docker compose up    # local Postgres, schema auto-loaded from db/schema.sql
```

## Owner context

- Solo developer: independent software architect, 25+ yrs, Vancouver-based, Brazilian.
- Stack preferences: Node.js/TypeScript, Azure, Docker. Postgres chosen for this
  project (over SQL Server — see decisions log). React/Vite on the front end.
- App must be bilingual-aware: pt-BR + English input parsing AND full UI
  (Vancouver user base + Brazilian roots) — see docs/09.
- User travels internationally and spends in multiple currencies (BRL, CAD,
  USD, JPY, ...) — multi-currency tracking (not conversion) is core to v1,
  not deferred. See docs/10.
- Real account count is large: several cards across Visa/Mastercard, 3+ bank
  accounts each in Canada and Brazil, plus Wise — 15-20+ `accounts` rows is
  the realistic scale to design for, not 4-5. See docs/12.
- A prior throwaway prototype exists (voice budgeting PWA with a rule-based
  bilingual parser) — its parser logic is intended to be reused as Tier 1 of the
  AI entry pipeline.

## Locked architectural decisions — do not relitigate without flagging

1. **Local-first**: SQLite on-device (PowerSync web SDK / wa-sqlite over OPFS).
   App reads/writes ONLY local DB. UI never awaits network.
2. **Sync**: PowerSync, self-hosted Open Edition (Docker), Postgres backend
   (Azure Database for PostgreSQL). Postgres sync-bucket storage (beta) to keep
   the stack Mongo-free.
3. **One write path**: all mutations (manual, AI-parsed, future import) go
   through local insert → PowerSync upload queue → `POST /api/sync/upload` on
   our Node.js API. The API applies validation + last-write-wins. Nothing else
   ever writes transactions server-side — including the LLM.
4. **AI entry is two-tier**: on-device rule-based parser (free tier, offline)
   → Claude Haiku-class tool-use via our API (paid tier, online). Ambiguity
   falls into an "uncategorized inbox," never an error.
5. **Monetization**: free = single device + manual + rule-based entry;
   paid = sync + LLM entry, 14-day trial. Subscription gate enforced in the
   sync upload handler, /api/parse, and the PowerSync token endpoint —
   nowhere else. Auth itself is opt-in: free tier never contacts the server
   at all (see docs/05, docs/06).
6. **Money = integer cents. IDs = client-generated UUIDs. Soft delete on
   transactions. `user_id` + `updated_at` on every synced table.**

## MVP scope (v1) — resist expansion

- Entities: accounts, categories, transactions, monthly budgets (+ category_keywords).
- Views: current-month budget vs spent, transaction list, one trend chart.
- Input: quick manual entry (<3s) + single AI text box.
- Explicitly deferred: multi-currency *conversion*/FX rollup (tracking
  multiple currencies side by side is in v1, see docs/10), recurring
  transactions, household sharing, CSV/bank import, voice (comes back later,
  reuses same pipeline), transfers-as-linked-pairs, server-backed
  full-history CSV export (v1 export is local-only, see docs/08).

## Working style

- Português ou inglês, tanto faz — responder no idioma da pergunta.
- Prefer boring, verifiable solutions; flag alpha/beta dependencies loudly.
- When a decision above seems wrong, say so directly — but as a flagged
  proposal, not a silent change.

## Docs index

- `docs/01-scope-and-decisions.md` — product scope, tiers, decisions log, open questions
- `docs/02-sync-architecture.md` — client/service/backend topology, why PowerSync
- `docs/03-schema-and-sync-rules.md` — Postgres DDL, sync rules YAML, conflict policy
- `docs/04-ai-entry-pipeline.md` — tool schema, prompt, learning loop, failure modes
- `docs/05-auth-and-devices.md` — magic link + JWT flows, why auth is opt-in (free tier never signs in), device/rekey handling
- `docs/06-subscription-and-billing.md` — Stripe checkout/webhook flow, subscription-gate enforcement, cancellation data policy
- `docs/07-manual-entry-ux.md` — single-screen "type or tap" home, entry zone states, inbox interaction
- `docs/08-csv-export.md` — local-only CSV export format and scope; server-backed full-history export is backlogged
- `docs/09-language-and-i18n.md` — full bilingual UI, language detection, formatting
- `docs/10-currency-and-payment-methods.md` — payment methods = accounts, per-transaction currency, per-currency budgets
- `docs/11-savings-goals.md` — goal fields on accounts, per-currency balance, Accounts screen flagged as a prerequisite gap (not yet designed)
- `docs/12-accounts-screen.md` — accounts list/edit screen grouped by institution, archived flag, per-currency balance display
- `docs/artifacts/` — standalone HTML mockups (open directly in a browser): `piggypal-entry-ux.html` (doc 07), `piggypal-accounts-screen.html` (doc 12)

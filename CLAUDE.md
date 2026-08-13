# CLAUDE.md — piggypal Budgeting PWA

## What this is

An offline-first budgeting/expense/savings PWA under the piggypal brand.
Positioning: **simple, light, private** — "you just type or say what you spent."
This project continues a brainstorm started in Claude chat; the full state of
that discussion lives in `docs/` — read `docs/01-scope-and-decisions.md` first.

## Repo status (2026-08-12)

The local-only vertical slice is real and working, not just scaffolded.
`app/` (React/Vite PWA) and `api/` (Node/TS/Express) are npm workspaces at
the root; git has real commit history now (not just an initial commit).
`db/schema.sql` has the current Postgres schema — still only exercised via
`docker compose up` for local dev, not yet verified against a real synced
deployment.

`app/` runs on real local SQLite (PowerSync web SDK / wa-sqlite over OPFS,
`app/src/lib/db.ts`) in **local-only mode** — no connector is passed to
`PowerSyncDatabase`, so nothing in `app/` ever touches the network. The
Home screen (docs/07), Inbox (docs/07), Accounts (docs/12), Categories
(docs/14), a dedicated transaction screen with search/filter (docs/17,
docs/18), and typed/voice entry through a real on-device parser (docs/16,
Tier 1 of docs/04 only) are all built and working, not placeholders.
What's still unbuilt is everything on the *server* side of docs/02's sync
boundary: `api/` only has a `/health` route; auth (docs/05), sync
(docs/03), Tier 2 of the AI entry pipeline (the server LLM half of
docs/04), and Stripe (docs/06) are all fully specified but not
implemented — that's the next deliberate phase, not started yet.

`docs/00-backlog.md` is the live day-to-day tracker (Now/Next/Later/Bugs/
Done) — check it first for exactly what's in flight; this section only
tracks the big-picture phase.

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
  bilingual parser) — its parser logic was *intended* to be reused as Tier 1
  of the AI entry pipeline, but docs/16's `parser.ts` was written fresh
  instead (the prototype isn't in this repo) — worth a compare-and-merge
  pass against the prototype later if it resurfaces, not treated as done.

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

- Entities: accounts, categories, transactions, monthly budgets, category_keywords.
- Views: current-month budget vs spent, transaction list with search/filter
  (docs/18), one trend chart.
- Input: quick manual entry (<3s), a typed/voice text box parsed on-device
  (docs/16, Tier 1 only — free, offline), and Tier 2's paid online LLM path
  once docs/04's server half is built.
- Explicitly deferred: multi-currency *conversion*/FX rollup (tracking
  multiple currencies side by side is in v1, see docs/10), recurring
  transactions, household sharing, CSV/bank import, transfers-as-linked-pairs,
  server-backed full-history CSV export (v1 export is local-only, see
  docs/08), the docs/04 learning loop and dedupe guard (docs/16).

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
- `docs/10-currency-and-payment-methods.md` — payment methods = accounts (no currency of their own, D62), per-transaction currency, per-currency budgets
- `docs/11-savings-goals.md` — **superseded (D64)**: account-level goals removed; goal tracking is per-category via `budgets` only. Kept for historical context.
- `docs/12-accounts-screen.md` — accounts list/edit screen grouped by institution, archived flag, per-currency balance display (no currency field, no goal UI — see docs/10 D62, docs/11 D64)
- `docs/13-account-picker-scaling.md` — entry-zone/edit-form account picker: threshold-gated grouped-vs-capped modes, user-selectable via Settings, solo-institution label simplification. Implemented 2026-08-10.
- `docs/14-category-groups.md` — category hierarchy: nullable self-referencing `parent_id`, 2-level cap, shared `CategoryPicker` across EntryZone/InboxScreen/TransactionEditForm. Budget rollup explicitly deferred (D74). Minimal pass implemented 2026-08-11.
- `docs/15-location-merchant.md` — nullable `merchant` column on `transactions`, Tier 2 (AI) only extraction, edit-form field with recency-ranked suggestions. AI wiring, list-row display, and a search/filter screen explicitly deferred (D78). Implemented 2026-08-12.
- `docs/16-ai-entry-tier1.md` — Tier 1 of docs/04 implemented for real: a pure closed-vocabulary `parser.ts` (amount/currency/date/category/account, bilingual), `category_keywords` seeded, and voice input as a thin Web Speech layer over the same typed-text field. Merchant extraction, the docs/04 learning loop, and the dedupe guard explicitly deferred (D91-92). Implemented 2026-08-12.
- `docs/17-transaction-screen.md` — dedicated `/transactions/:id` screen replacing inline expand-in-place for transactions (Accounts/Categories unchanged); tap-entry auto-navigates there post-insert instead of toasting. Implemented 2026-08-12.
- `docs/18-transaction-search-filter.md` — search + filter chips (Category/Account/Location/Date range) added inline atop `/transactions`, URL-search-param state, per-currency totals (never blended, docs/10). Implemented 2026-08-12.
- `docs/artifacts/` — standalone HTML mockups (open directly in a browser): `piggypal-entry-ux.html` (doc 07), `piggypal-accounts-screen.html` (doc 12), `piggypal-picker-grouping.html` (doc 13), `piggypal-location-field.html` (doc 15 brainstorm — its three frames shipped as docs/16-18, each diverging in some way from the mockup's literal staging; see each doc's own notes)

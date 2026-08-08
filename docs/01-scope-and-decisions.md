# 01 — Scope & Decisions

## Product in one paragraph

A public (eventually monetized) budgeting/expense/savings PWA that is very
simple, light, and offline-first, with sync across devices from day one.
Differentiator in a saturated market: **offline-first + private + natural
language entry** ("45 mercado ontem" → categorized transaction), bilingual
pt-BR/English.

## Founding constraints (from the initial brainstorm)

- Audience: public app, maybe monetized (not just personal/family use).
- Interaction: a **mix** — manual quick-entry as the fast path, AI/text/voice
  as a layer on top, import later.
- Sync: required **from day one** → therefore sync is the engineering
  centerpiece and everything else stays brutally minimal.

## MVP scope

| Area | In v1 | Deferred |
|---|---|---|
| Entities | accounts, categories, transactions, monthly budgets | goals, recurring rules, households |
| Input | manual (<3s flow), AI text box | voice, CSV/bank import (reuse same pipeline later) |
| Views | month budget vs spent, transaction list, one trend chart | reports, forecasts |
| Money | multi-currency, tracked per transaction & budgeted per currency (docs/10) | conversion math / unified cross-currency rollup |
| Transfers | two independent transactions | linked-pair modeling |

## Tiers

- **Free**: single device, manual entry, on-device rule-based AI parsing.
- **Paid**: multi-device sync + LLM-powered entry.
- Rationale: the hardest feature (sync) and the marginal-cost feature (LLM)
  are the paid ones — clean story, honest costs.
- Enforcement points: `POST /api/sync/upload`, `POST /api/parse`, and
  `GET /api/auth/powersync-token` (reject/gate for free or lapsed tier).
  Nowhere else. See docs/06-subscription-and-billing.md for the full
  Stripe → subscription-state → gate design (D17-D21).

## Decisions log

| # | Decision | Why | Status |
|---|---|---|---|
| D1 | PowerSync over Replicache/Zero, ElectricSQL, hand-rolled LWW | Replicache pushes sync logic into app code; Electric is read-path only; hand-rolled LWW breaks on clock skew/partial uploads at public-app scale | locked |
| D2 | Postgres, not SQL Server | PowerSync's SQL Server connector is alpha (Dec 2025, CDC-based); Postgres is the mature primary integration. Don't bet a product on an alpha connector | locked |
| D3 | Self-host PowerSync Open Edition in Docker (Azure Container Apps; Proxmox for prototyping) | Free, source-available, fits existing Docker/self-host workflow | locked |
| D4 | Postgres sync-bucket storage (beta) instead of MongoDB | Keeps stack pure-Postgres; beta risk accepted since it's infra-side and swappable | locked, revisit if unstable |
| D5 | Client-generated UUIDs, integer cents, soft delete on transactions, 18-month client sync window | Offline correctness + bounded local DB size | locked |
| D6 | LLM never writes to DB; returns structured data, client inserts locally | Single write path; sync/validation/subscription logic exists once | locked |
| D7 | Per-user learning via `category_keywords` table (correction → keyword hit counter) synced to device and injected into LLM prompt | Personalization with zero ML infra | locked |
| D8 | Haiku-class model for parsing | ~500 tokens/call; <$0.10/user/month at heavy use | locked |
| D9 | Auth: magic link + JWT (same pattern as owner's Àṣẹ app) | Known pattern, no passwords | superseded by D10-D16, see below |
| D10 | Auth is opt-in — free tier never contacts the server; sign-in happens exactly at the "enable sync/AI" moment | Zero server dependency for the tier that's supposed to have zero server dependency | locked, see docs/05-auth-and-devices.md |
| D11 | Client-generated `user_id` doubles as the Postgres `users.id` on first sign-up | Consistent with D5's client-owned-ID philosophy; avoids a rekey on the common single-device upgrade path | locked, see docs/05-auth-and-devices.md |
| D12 | Refresh tokens: opaque, hashed, rotating, 60-day sliding TTL, per-device | Bounds a lost/stolen-device window while tolerating realistic offline gaps | locked, see docs/05-auth-and-devices.md |
| D13 | Refresh token in httpOnly/Secure/SameSite cookie; access JWT (RS256) in memory only | Standard XSS-resistant pattern | locked, revisit iOS PWA storage behavior once built |
| D14 | Device joining an existing account with pre-existing standalone local data: ask before merging | User-visible financial data deserves an explicit choice | locked, see docs/05-auth-and-devices.md |
| D15 | Magic-link email via Azure Communication Services, behind a one-function adapter | Stays in existing Azure stack; adapter makes swapping vendors later a same-day change | locked, low switching cost by design |
| D16 | Device list / per-device revoke UI deferred past v1 | Data model supports it already; no UI needed yet | locked |
| D17 | Subscription state read via a plain indexed lookup per request, no cache, no JWT claim | One indexed row read is already fast enough; avoids a stale-claim window after cancellation | locked, see docs/06-subscription-and-billing.md |
| D18 | past_due grace: 7 days of continued paid access before gates flip to free behavior | Absorbs a normal card-declined blip without instant cutoff | locked, see docs/06-subscription-and-billing.md |
| D19 | 14-day trial, card collected upfront via Stripe Checkout, auto-converts to active | Standard pattern, no separate trial-end payment step to build | locked, see docs/06-subscription-and-billing.md |
| D20 | `powersync-token` also checks paid access, refining the Tiers section's "nowhere else" | That line predates this endpoint; without the check a lapsed subscriber could keep pulling reads via other devices | locked, see docs/06-subscription-and-billing.md |
| D21 | On actual cancellation: hard-delete budgeting tables server-side immediately; `users`/`subscriptions`/`refresh_tokens` persist | Matches privacy positioning while keeping identity stable for a clean resubscribe; local device data unaffected either way | locked, see docs/06-subscription-and-billing.md |
| D22 | Single continuous scroll on Home, no bottom tab bar in v1 | Entry speed is the differentiator; MVP's view surface is too small to justify tab chrome | locked, see docs/07-manual-entry-ux.md |
| D23 | Entry zone collapsed by default; amount pad/chips expand on tap or focus | Keeps budgets/trend/recent glanceable on first open | locked, see docs/07-manual-entry-ux.md |
| D24 | Tapping a category chip both selects and submits — no separate save step | Matches the <3s target; confirmation is a toast, not a blocking screen | locked, see docs/07-manual-entry-ux.md |
| D25 | Inbox surfaced as a banner on Home (count-gated), not a permanent nav tab | The queue should trend to zero, unlike an ongoing app section | locked, see docs/07-manual-entry-ux.md |
| D26 | Inbox items keep the raw utterance visible until categorized, categorize in place | User confirms what the parser saw rather than guessing blind | locked, see docs/07-manual-entry-ux.md |
| D27 | CSV export is local-only, client-side, free on both tiers | Zero new API surface; matches the "never locked in" trust framing without server cost | locked, see docs/08-csv-export.md |
| D28 | Export dumps everything on-device in one tap, no date-range filter in v1 | A full CSV is easy to filter afterward; the filter UI isn't earning its place yet | locked, see docs/08-csv-export.md |
| D29 | Export columns/format: `date, amount, category, account, note, source, ai_raw`; ISO dates, signed decimal amount, UTF-8 with BOM, comma-delimited/period-decimal | Portable, unambiguous for a bilingual audience, Excel-safe for accented text | locked, see docs/08-csv-export.md |
| D30 | Server-backed full-history export deferred to backlog | Local-only covers most users; server variant is materially more scope and likely paid-gated | locked, see docs/08-csv-export.md |
| D31 | Full bilingual UI (pt-BR + English) in v1, not just input parsing | Matches the app's stated positioning and audience | locked, see docs/09-language-and-i18n.md |
| D32-D35 | Language auto-detect/per-device, i18n library, Intl formatting, internal-enum/display separation | See docs/09-language-and-i18n.md | locked, see docs/09-language-and-i18n.md |
| D36-D43 | Payment methods = accounts; transaction-level currency; budgets keyed per (category, month, currency); trend chart stays primary-currency; AI parser extracts currency; multi-currency providers (Wise) modeled as one account per held currency | See docs/10-currency-and-payment-methods.md | locked, see docs/10-currency-and-payment-methods.md |
| D44-D45 | Tap-entry currency chip row (same pattern as categories); default = selected account's last-used currency, resets on account switch | Closed the gap where only typed/AI entry could set a non-default currency | locked, see docs/07-manual-entry-ux.md |
| D46-D47 | Tap-entry gets an account chip row too; typed/AI entry gets an optional account_id (Tier 2 matches on explicit mention only, Tier 1 exact-name-match only) | Answers "how does the user say which card they used," for both entry paths, without ever guessing | locked, see docs/07-manual-entry-ux.md and docs/04-ai-entry-pipeline.md |
| D48-D51 | Goals = two nullable fields on accounts, not a table; one goal per account; any account kind; balance is a general per-currency capability | Reuses transaction history directly; avoids schema a multi-goal-per-account model would need | locked, see docs/11-savings-goals.md |
| D52 | Home-screen placement for goal progress left explicitly open | Not yet clear if this is daily-glance or periodic-check-in | open, see docs/11-savings-goals.md |
| D53-D59 | Accounts management screen: list with per-currency balance + inline goal progress, expand-in-place editing, `archived` field (not hard delete), currency changes don't touch existing transactions, no manual reordering | Closes the gap where docs/10 and docs/11 both assumed an accounts screen that was never designed | locked, see docs/12-accounts-screen.md |
| D60-D61 | Accounts get an optional `institution` field; screen groups by it, rows display as "institution — name" | Revises D43 — flat list and naming-convention-only stop working at real scale (15-20+ accounts across multiple banks); also disambiguates same-named accounts at different banks | locked, see docs/12-accounts-screen.md |

## Open questions (next brainstorm topics)

1. ~~**Stripe/tier plumbing**~~ — resolved, see `docs/06-subscription-and-billing.md` (D17-D21).
2. ~~**UI/UX**~~ — resolved, see `docs/07-manual-entry-ux.md` (D22-D26).
3. ~~**Auth details**~~ — resolved, see `docs/05-auth-and-devices.md` (D10-D16).
4. ~~**Savings**~~ — resolved, see `docs/11-savings-goals.md` (D48-D52). Home
   vs. Accounts-only placement stays explicitly open (D52).
5. ~~**Naming/branding**~~ — parked 2026-08-07: keeping "piggypal" as the
   working name for now, revisit once there's a working product to react to
   rather than naming in the abstract. (Note: an earlier version of this
   item referenced "relationship to the Piggypal avatar product" — that was
   a cross-contamination from an unrelated project in the original
   brainstorm; there is no avatar feature or product connected to this app.
   Removed 2026-08-06.)

   Context for next time: an extensive stress-test (~30 candidates across
   semantic bilingual words, invented short/long words, "___Money"
   compounds, Latin roots, and a "money across borders" angle) found that
   this naming space is brutally saturated — nearly everything collided
   with an existing budgeting/fintech app, several directly (Tally alone
   has 6+ existing competitors; Pluma, QuietMoney, and Pilo each collided
   with near-identical existing products). The few names that came back
   collision-clean (Kestro, KestroMoney, etceteraMoney) didn't land as
   names worth being excited about. Piggypal's own collision (a lesser-known
   budgeting *website*, not an app) turned out to be no worse than most
   alternatives once actually checked — worth remembering before assuming
   the name needs to change. Piggypal's real, still-unaddressed critiques:
   it signals none of the "private/local-first" differentiator, it's
   English-only wordplay for a bilingual-core product, and pig imagery
   carries real cultural-sensitivity considerations (Islam, Judaism) for a
   public app. Those are worth solving via tagline/visual identity/copy
   rather than continuing to search for a different word.
6. ~~**Data export**~~ — resolved, see `docs/08-csv-export.md` (D27-D30).
7. ~~**Language/i18n**~~ — resolved, see `docs/09-language-and-i18n.md` (D31-D35).
8. ~~**Currency & payment methods**~~ — resolved, see `docs/10-currency-and-payment-methods.md` (D36-D42).

## Backlog (deferred past v1, not forgotten)

- Server-backed full-history CSV export (docs/08-csv-export.md, D30) — for
  users whose local 18-month window has aged out older transactions.

## Origin note

This doc set was produced in a Claude chat brainstorm (Aug 2026) and is the
authoritative snapshot of that conversation. Continue from the open questions;
treat the decisions log as locked unless explicitly reopened.

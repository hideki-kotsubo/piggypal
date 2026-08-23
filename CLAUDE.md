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
The server phase (docs/02's sync boundary) is now well underway, not
"not started": PowerSync Service is deployed for real (docs/39,
`deploy/powersync/`), JWT/JWKS is real (docs/40), magic-link auth
(docs/05) is real on `api/` (docs/41), and as of 2026-08-22 the app side
of that flow is real too — `/auth/verify`, device-id generation, D14's
merge prompt (docs/42) — plus the actual write path,
`POST /api/sync/upload`, and a real `PowerSyncBackendConnector` wired
into `app/src/lib/db.ts` (docs/43). What's still unbuilt: Tier 2 of the
AI entry pipeline (the server LLM half of docs/04) and Stripe (docs/06).
What's real but not yet provably working end-to-end against a real
device: docs/43's own "not in scope" note — no production JWT keypair is
deployed and PowerSync Service's public subdomain isn't decided
(docs/39 open question #4), so nothing has synced through the real
deployed PowerSync Service yet, only against a local Postgres directly.
One real exception to "nothing in `app/` ever touches the network," as of
2026-08-14: docs/25's P2P device pairing is real (`pairing.ts`,
`PairingScreen.tsx`, `store.applyPeerDataset`) — a genuine WebRTC
connection directly between two browsers over QR signaling, no server
involved at all, distinct from and unrelated to the still-unbuilt
PowerSync/API sync boundary above. docs/28 adds a second signaling path
for when both devices aren't in the same room — that one *does* touch a
server (`api/src/relay.ts`, an anonymous WebSocket relay, no auth), but
still only brokers the same connection setup; actual data still flows
directly device-to-device once connected, same as the QR path. Both
transports move real data now: docs/24's merge (categories/
accounts/transactions/budgets) and D125-D127's identity unification are
both wired up and verified (docs/00-backlog has the exact breakdown).

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
- Input: a "+" quick-add that jumps straight to a blank transaction's
  screen (docs/19) for manual entry, a typed/voice text box parsed
  on-device (docs/16, Tier 1 only — free, offline), and Tier 2's paid
  online LLM path once docs/04's server half is built.
- Explicitly deferred: multi-currency *conversion*/FX rollup (tracking
  multiple currencies side by side is in v1, see docs/10), recurring
  transactions, CSV/bank import, transfers-as-linked-pairs,
  server-backed full-history CSV export (v1 export is local-only, see
  docs/08), the docs/04 learning loop and dedupe guard (docs/16).
  Household sharing is no longer deferred-and-undesigned — see docs/24 and
  docs/25 — but it's design-only as of 2026-08-14, nothing below has been
  built for it yet.

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
- `docs/07-manual-entry-ux.md` — single-screen "type or tap" home, entry zone states, inbox interaction. Its D26 inline-categorize-in-place inbox mechanic is superseded by docs/20. **Home narrowed 2026-08-15** (D147): budgets/trend chart moved off Home to a new `/insights` page (icon next to Settings' kebab) — Home now keeps only entry zone, inbox banner, and recent transactions. Also D148: list rows fall back from note → category name → "Uncategorized" instead of a bare "No note" placeholder (`transactionTitle()` in `format.ts`, used by RecentList/TransactionList; Inbox rows untouched — category-less by definition).
- `docs/08-csv-export.md` — local-only CSV export format and scope; server-backed full-history export is backlogged
- `docs/09-language-and-i18n.md` — full bilingual UI, language detection, formatting
- `docs/10-currency-and-payment-methods.md` — payment methods = accounts (no currency of their own, D62), per-transaction currency, per-currency budgets
- `docs/11-savings-goals.md` — **superseded (D64)**: account-level goals removed; goal tracking is per-category via `budgets` only. Kept for historical context.
- `docs/12-accounts-screen.md` — accounts list/edit screen grouped by institution, archived flag, per-currency balance display (no currency field, no goal UI — see docs/10 D62, docs/11 D64)
- `docs/13-account-picker-scaling.md` — entry-zone/edit-form account picker: threshold-gated grouped-vs-capped modes, user-selectable via Settings, solo-institution label simplification. Implemented 2026-08-10.
- `docs/14-category-groups.md` — category hierarchy: nullable self-referencing `parent_id`, 2-level cap, shared `CategoryPicker` across EntryZone/InboxScreen/TransactionEditForm. Budget rollup explicitly deferred (D74). Minimal pass implemented 2026-08-11.
- `docs/15-location-merchant.md` — nullable `merchant` column on `transactions`, Tier 2 (AI) only extraction, edit-form field with recency-ranked suggestions. AI wiring, list-row display, and a search/filter screen explicitly deferred (D78). Implemented 2026-08-12.
- `docs/16-ai-entry-tier1.md` — Tier 1 of docs/04 implemented for real: a pure closed-vocabulary `parser.ts` (amount/currency/date/category/account, bilingual), `category_keywords` seeded, and voice input as a thin Web Speech layer over the same typed-text field. Merchant extraction, the docs/04 learning loop, and the dedupe guard explicitly deferred (D91-92). Implemented 2026-08-12. **Fixed 2026-08-17** (D149): iOS Safari re-prompted for mic permission on every tap because `speechInput.ts` built a fresh `SpeechRecognition` instance each time; now reuses one module-level instance, since Safari's grant behaves as scoped to the instance rather than the origin. **Extended same day** (D150): `parser.ts` now matches already-known merchants (closed-vocabulary, narrowing D92) and tracks every recognized text span so it can compute what's left over — that leftover becomes the transaction's `note` instead of a copy of the category name, falling back to docs/07 D148's category-name display when there's nothing left. **Extended again 2026-08-17** (D151): absolute month-name dates + clock times now parse (bilingual, still closed-vocabulary), and a single proper-noun-ish token after "at"/"no"/"na" is guessed as a brand-new merchant when nothing known matches — the one deliberate exception to never-guess, made safe by flagging `merchantGuessed: true` through the same preview-then-Save confirmation every other field already goes through, never written silently. **Revised same day** (D152): the merchant guess's "at `<merchant>`" now stays visible in the Note (was being stripped) while a bare currency symbol next to the amount is dropped from it instead — `computeUnrecognized`'s edge trim takes an exact protected phrase so it never eats the merchant's own "at" while still cleaning up any other stray connector word.
- `docs/17-transaction-screen.md` — dedicated `/transactions/:id` screen replacing inline expand-in-place for transactions (Accounts/Categories unchanged); tap-entry auto-navigates there post-insert instead of toasting. Implemented 2026-08-12.
- `docs/18-transaction-search-filter.md` — search + filter chips (Category/Account/Location/Date range) added inline atop `/transactions`, URL-search-param state, per-currency totals (never blended, docs/10). Implemented 2026-08-12.
- `docs/19-quick-add-skips-inline-form.md` — Home's "+" now creates a blank transaction immediately and jumps straight to its docs/17 screen, replacing the old inline amount-pad/category-chip panel; typed/voice entry (docs/16) unchanged, just visually merged into the same always-visible row. Implemented 2026-08-13.
- `docs/20-inbox-list-style.md` — Inbox rows now use the same tappable-row style as TransactionList/RecentList/Search (docs/17/18), linking to the edit screen to categorize instead of an inline per-row `CategoryPicker`. Supersedes docs/07 D26's snapshot/dim-to-done mechanic. Implemented 2026-08-13.
- `docs/21-sunken-zone-styling.md` — shared "sunken zone" card pattern (sunken fill + hairline border + radius) formalized as `--radius-lg/md/sm` tokens; reserved for zones (entry-zone, account-create, search row, form fields), not list rows. `.trend-card`/`.goal-box` promoted to full tier; `.picker-group`'s dashed/un-sunken look kept deliberately distinct. Implemented 2026-08-13.
- `docs/22-parse-preview.md` — Tier 1 parse results now confirmed in an inline preview (amount/category/when/account, with parsed-vs-defaulted markers) before insert, instead of writing directly. Fixes voice having no commit affordance at all; typed entry goes through the same preview (D95-97). Implemented 2026-08-13.
- `docs/23-quick-add-cancel-and-done.md` — leaving `/transactions/:id` (back arrow or new "Done" button) deletes the transaction if it's still exactly $0.00, fixing quick-add's stray blank rows; autosave elsewhere unchanged (D105-107). Implemented 2026-08-13.
- `docs/24-household-sharing.md` — reopens docs/01/05's "households deferred/single-user" calls at the user's request. `household_id` replaces `user_id` as the sync partition key on accounts/categories/transactions/budgets; adds `paid_by_user_id`/`created_by_user_id` on transactions and `owner_user_id` on accounts; defines the merge algorithm for two independently-used devices connecting (categories merge by seed id, accounts always move never merge, budgets resolve collisions to the higher amount). Track-and-report only, no settlement/split math. **The merge algorithm itself is implemented and verified** (2026-08-14, via docs/25's P2P transport — `store.applyPeerDataset()`), running directly against local SQLite with no `household_id` column needed. Still not implemented: the PowerSync/Postgres path specifically (`households`/`household_members` tables, sync rules, API validation).
- `docs/25-p2p-device-sync.md` — new transport, independent of PowerSync: WebRTC data channel + QR-code signaling (serverless, works fully offline), manual both-sides-acked sync sessions. Available to every tier, not a free-tier fallback — paid households can use it too as a fast/offline supplement to PowerSync. QR/SDP size risk resolved by spike (D117a); confirmed and further reduced from real-device testing (D132/D133 — error-correction level + a leaner payload encoding). D125-D127: pairing asks "your own device, or someone else's?" before anything else — own-device mode unifies identity instead of running the two-person household merge. **Fully implemented and verified 2026-08-14** (`app/src/lib/pairing.ts`, `PairingScreen.tsx`, `store.applyPeerDataset`) — real WebRTC handshake, QR generation/scanning, docs/24's data merge, and D125-D127's identity unification (D134) are all wired up and confirmed against the real app with ground-truth SQL queries, not just trusted return values. A real deadlock found on real hardware (D126's merge-prompt pausing one side while the other proceeded immediately, losing a message `RTCDataChannel` doesn't buffer for late-attached listeners) is fixed by `wrapChannel()`'s persistent per-channel message queue (D135), verified by directly reproducing the bug's exact timing. Two more real bugs found on real hardware, same day: `qr-scanner`'s default stop path defers the actual camera release by 300ms (fixed with the library's `immediate` flag), and two scanner instances sharing one `<video>` element — which React StrictMode's dev-mode double-invoke creates on every mount — could leave neither attached (fixed by giving each mount its own DOM node, D136). Both reproduced directly on the real component under real StrictMode, not inferred. A third: `qr-scanner`'s decode callback fires on every video frame that reads the code, not once — without a `handled` guard, holding the phone steady briefly after a good scan ran the completeOffer/answerOffer flow multiple times, and every call after the first threw (a `RTCPeerConnection` only accepts one `setRemoteDescription` per signaling-state transition), surfacing as "Connection dropped" even when the first call had succeeded (D137). Also discussed, not designed: a WhatsApp-style always-linked device model — the paid PowerSync path already provides that once signed in on multiple devices; true always-live P2P isn't feasible without a server (backgrounded-tab suspension, cross-network signaling), so the realistic free-tier version is a remembered pairing relationship with lighter re-sync UX, not true live sync. First piece of that built the same day (D138-D139): a repeat sync with an already-known peer (`PairedPeer.id` is now the peer's real `getLocalUserId()`, `recordSync` upserts instead of duplicating) skips the own-device/someone-else question and jumps straight to the role step from a real link on Settings' peer row — still a manual QR ceremony each time, just without the now-redundant question. Known gaps: `category_keywords` excluded from sync, peer management beyond a bare list, relay-assisted remote signaling, and an unconfirmed device-mislabeling report (both sides of a real pairing showed "Synced with iPhone" — `guessDeviceLabel()`'s UA-sniffing is the leading suspect, pending the user's answer on whether the desktop side was in a browser device-emulation mode).
- `docs/26-household-sharing-ui-sketch.md` — sketch of where docs/24's `paid_by_user_id`/`created_by_user_id`/`owner_user_id` become visible once a household has 2+ members: payer badge on list rows, "paid by" chip vs. "logged by" caption on the edit screen, owner name prefix on Accounts, a bare read-only members list in Settings. No per-person color system, no pairing/settlement UI (D121-D124). **Implemented 2026-08-19** — see docs/38.
- `docs/27-p2p-pairing-ui-sketch.md` — sketch of docs/25's pairing flow: Settings entry point, the own-device-vs-someone-else fork as two full-screen cards, both sides of the QR exchange, the own-device merge prompt (mirrors docs/05 D14), and the both-sides-acked confirmed state (D128-D131). **Implemented 2026-08-14** (`PairingScreen.tsx`) for frames 2-5, entry point in `SettingsScreen.tsx`, including frame 4's merge prompt. Peer rename/forget management stays out of scope; relay-assisted remote signaling is no longer out of scope — see docs/28.
- `docs/28-relay-assisted-pairing.md` — a second signaling transport alongside docs/25's QR path, for pairing when both devices aren't in the same room: an anonymous WebSocket relay (no auth — open to every tier, the user's explicit call) brokers the same offer/answer exchange automatically, keyed by a short human-typable code. Since an anonymous relay means anyone could occupy the wrong room slot, includes Short Authentication String verification (a few emoji derived from both sides' real connection fingerprints, confirmed on both screens before anything crosses the channel) — the user chose to include this deliberately. **Implemented and verified 2026-08-14** (`api/src/relay.ts` — the first real feature on `api/`, previously just `/health`; `app/src/lib/relayClient.ts`; `PairingScreen.tsx`'s new "are you together right now?" fork). A real bug found while first testing it — the SAS step's human-paced gap between channel-open and afterHandshake running could drop the peer's hello with zero listeners attached, same deadlock class as D135 — is fixed by wrapping every channel the instant it opens rather than whenever afterHandshake happens to run (D145). Real deployment done via `app/.env`'s `VITE_RELAY_WS_URL` (no code change needed — the override point was already there). Code-entry UX improved after real-device use: auto-dash formatting while typing, and a "scan a code instead" option reusing the QR flow's own scanning component, both normalizing through one shared function (D146).
- `docs/29-versioning-and-about.md` — root/app/api `package.json` synced to one real semver version (0.1.0 to start), displayed on Settings and a new `/about` screen; About screen is first-person solo-developer copy + `mailto:` contact, not a "team" framing. Implemented 2026-08-18.
- `docs/30-device-naming.md` — user-editable "This device's name" (Settings > Sync), sent during docs/25 pairing instead of the bare UA-guessed device type, so two same-type devices (or a spouse's identically-guessed phone) can be told apart in the paired-devices list. Implemented 2026-08-18.
- `docs/31-home-bottom-entry.md` — entry zone docks to the bottom of Home instead of the top, overlay-style (position:fixed, no scrim, list never reflows but gets covered while composing) — supersedes docs/07 D22-26's top-of-page placement (D159-D160). Built as a trial after the Home-directions design exploration below, evaluated hands-on, kept. Implemented 2026-08-19.
- `docs/32-entry-zone-spacing.md` — more breathing room in the entry zone's parse-preview (padding/gaps only, no shadow/typography change) — the spacing half of the design exploration's direction A, user-scoped down from its full polish pass. Implemented 2026-08-19.
- `docs/33-day-grouped-lists.md` — `groupByDay()` (`format.ts`) buckets by real calendar date; Today/Yesterday/date dividers now in both Home's Recent list and `/transactions` (docs/18) — direction B of the design exploration. Implemented 2026-08-19.
- `docs/34-sticky-day-headers.md` — docs/33's day dividers now pin to the top while scrolling (`position: sticky`, standard header-stacking behavior, no JS). Implemented 2026-08-19.
- `docs/35-day-subtotals.md` — each day divider now shows that day's total(s) via the existing `totalsByCurrency()`, never blended across currencies; Home's capped `RecentList` sources it from the full list so a day split across the preview cutoff isn't misrepresented. Implemented 2026-08-19.
- `docs/37-day-group-sunken-card.md` — day groups render inside a sunken-zone card (matches the entry-zone's own pattern), chosen from 4 mocked-up alternatives (`docs/artifacts/piggypal-day-group-separation.html`) after a full-bleed hairline read as too weak. Sticky day-labels (docs/34) stay a separate element above the card, not the card's own header, to keep the sticky behavior clean. Implemented 2026-08-19.
- `docs/38-household-payer-owner-ui.md` — docs/26's payer/owner/logger UI, actually built: payer badge on list rows, "Paid by" chip + "Logged by" caption on the transaction edit screen, owner-name prefix on Accounts rows, and a new Settings → Household read-only members list. "Household" is derived from `peers.ts`'s `someone-else` paired peers (docs/24's `households` table still doesn't exist) — `lib/household.ts`'s `hasHousehold`/`householdMembers`/`personLabel`. One deliberate gap vs. the mockup: "Logged by" shows name only, no timestamp — this app has no `created_at` column on transactions to show one. Implemented 2026-08-19. Same-day follow-up: Settings' "Reset local data" now also forgets paired peers (`peers.ts`'s `clearPairedPeers()`), fixing a stale-household display after a reset.
- `docs/39-production-deployment.md` — operational runbook for the still-unbuilt server phase: Postgres, secrets/JWT keypair, JWKS, PowerSync Service, auth/sync-upload/Stripe routes on `api/`, external Stripe/Azure Communication Services accounts, client cutover. Doesn't relitigate architecture, just sequences docs/02-06. Notes a real constraint found while writing it: this dev sandbox can't run Docker or rootless Podman at all (its outer container lacks `CAP_SYS_ADMIN` and the `unshare(CLONE_NEWUSER)` syscall) — `db/schema.sql` was instead verified against a native, non-containerized Postgres install here; PowerSync Service itself still needs a real external host with working Docker. **2026-08-22: PowerSync Service is running for real** against the production Postgres on the user's own Docker host (`deploy/powersync/` has the full config + README) — confirmed healthy, actively replicating, zero errors. Getting there surfaced three real problems, all fixed and documented in the README's "Real problems hit and fixed": a `pgwire`/scram-sha-256 client incompatibility (worked around with `md5` auth), a missing `CREATE PUBLICATION`, and PowerSync sync rules being unable to express the originally-designed 18-month rolling transaction window at all (`now()`/`interval` unsupported by design — dropped to full-history sync for now, re-adding it is a tracked followup). Still blocked: real client auth, same JWKS/production-keypair gap as before.
- `docs/40-jwt-keypair-and-jwks.md` — docs/05 D13's RS256 signing/verification primitive, real: `api/src/jwt.ts` (`signAccessToken`, `getJwks`), `GET /.well-known/jwks.json`, and `npm run -w api generate-jwt-keys` (the only place a keypair is generated — never at boot). Verified with a live sign→fetch-over-HTTP→verify round trip against `jose`, plus a rejected-tampered-token check. Production keypair not yet generated — only a dev one exists, sandbox-local.
- `docs/41-auth-magic-link.md` — docs/05's actual sign-in flow, real: `POST /api/auth/request-link`, `GET /api/auth/verify`, `POST /api/auth/refresh`, `GET /api/auth/powersync-token` (`api/src/auth/`), plus `api/src/db.ts` (lazy Postgres pool — a real module-load-order bug was hit and fixed here, see the doc). Email sending is stubbed (logs the link) until a real provider account exists — see docs/44 for the provider itself (Resend, not the originally-built Azure Communication Services). Verified end-to-end (21/21) against the live dev server and real Postgres: signup, second-device/existing-account resolution, magic-link single-use, refresh rotation, theft-signal chain revocation, and input validation. Not built yet: the app-side `/auth/verify` page, client device-id generation, and D14's local-data merge-prompt UX — see docs/42.
- `docs/42-app-auth-flow.md` — the app-side half of docs/41's flow, real: `app/src/lib/identity.ts`'s `getDeviceId()`, `app/src/lib/auth.ts` (API client + memory-only access token, docs/05 D13), `AuthVerifyScreen.tsx` at `/auth/verify`, Settings' new "Account" sign-in section, and `store.tsx`'s `adoptAccountId` for D14's merge prompt. Two real bugs found and fixed: React StrictMode double-invoking the verify effect double-consumed the single-use magic-link token (same bug class as docs/25 D136), and the merge-prompt's account/transaction counts could read zero due to a `StoreProvider` ready-vs-first-watch-result timing gap (fixed by querying SQLite directly instead of trusting React state). D14's "decline" sub-choice was originally simplified to mirror docs/25 D126's existing two-button pattern (merge or "keep this device separate") — **superseded same day, see docs/45**: real second-device testing found "keep separate" incoherent once someone's typed an existing account's email and tapped the magic link, so it's gone, replaced by `discardAndAdoptAccountId()` (wipe + adopt outright). Verified end-to-end via Playwright against the live dev servers, including the full second-device-with-existing-data merge flow. Implemented 2026-08-22.
- `docs/43-sync-upload-and-connector.md` — docs/03's write path, real: `POST /api/sync/upload` (`api/src/sync/routes.ts`, table-driven PUT/PATCH/DELETE with a per-row ownership guard) and `app/src/lib/connector.ts` (`PiggypalConnector`), wired into `db.ts` via `connectSync()`/`disconnectSync()` — local-only mode stays the unconditional default, sync is layered on top only once signed in. Real, flagged simplifications vs. docs/02/03's literal spec: "last write wins" is actually "last upload wins" (the local SQLite schema has no `updated_at` to compare against), the subscription gate isn't implemented (docs/06 has nothing to gate on yet, same call docs/41 made), and budgets'/category_keywords' own unique-constraint collisions aren't specially reconciled (id-conflict only). Verified with an 11/11 throwaway script against the live dev server and real Postgres. Still not provably working against the real deployed PowerSync Service — no production JWT keypair or public PowerSync subdomain exists yet (docs/39 open question #4), tracked in docs/00-backlog. Also fixed a real CORS gap on `api-beta`: a single hard-coded allowed origin, never exercised until this pass's sign-in flow made the first-ever HTTP `fetch()` from `app-beta` to `api-beta` (docs/28's relay is WebSocket, no preflight) — `CORS_ORIGIN` now accepts a comma-separated list, defaulting to every origin `vite.config.ts` already anticipates. Implemented 2026-08-22.
- `docs/44-magic-link-email-provider.md` — docs/05 D15's provider, revised same-day: a real Azure Communication Services send was implemented first (`@azure/communication-email`), then swapped to Resend at the user's request after comparing alternatives — zero caller changes either side, proving out D15's own adapter-boundary claim for real. `RESEND_API_KEY`/`RESEND_FROM_ADDRESS` replace the ACS env vars; unset still falls back to logging the link (unchanged since docs/41). Not verified: an actual real send through either provider — no real account/API key exists yet, only the safe-fallback path has been exercised. Implemented 2026-08-22.
- `docs/45-real-signin-bugs-found-testing.md` — six real problems found by actually testing a real sign-in end to end (a real Resend send, real seeded local data, then the real production deploy, then a real second device), all invisible to docs/41's and docs/43's own synthetic-fixture scripts: (1) click-tracking (Resend routes through Amazon SES) auto-consumed the single-use magic-link token before the user could click it — fixed by requiring a real button tap (`AuthVerifyScreen`'s `verifyMagicLink` call moved out of a mount-time `useEffect` into a click handler) rather than verifying on page load; (2) `categories.id`/`category_keywords.id` were typed `uuid` in `db/schema.sql`, but seed data deliberately uses human-readable slug ids (docs/24's household-merge dedupe design) — every real device's first sync upload of its own seeded categories would have failed — **applied to production 2026-08-22** via `db/migrations/2026-08-22-categories-id-text.sql`, verified end-to-end against a throwaway copy of the old schema before handing it over; (3) `categories.sort_order`'s `not null default 0` broke the same way once (2) was fixed, since nothing ever populates it client-side and an explicit `NULL` overrides a Postgres `DEFAULT`; (4) found after deploying, against production — Settings' "Reset local data" only cleared the app's own SQLite tables, never PowerSync's separate internal pending-upload queue, so a pre-existing failed upload (a legacy pre-`crypto.randomUUID()` account id) stayed queued forever and kept blocking every sync after it, surviving every reset — fixed by switching to `db.disconnectAndClear()`, PowerSync's own documented "use this when logging out" API, which clears both together; same pass also fixed `resetLocalData()` leaving the "signed in as ___" marker behind, which left a reset device looking signed in with no way back to the sign-in form; (5) docs/42's own "keep this device separate" merge-prompt option (docs/05 D14) turned out incoherent, not just under-specified — real second-device testing surfaced that typing an existing account's email and tapping its magic link already asserts "this is me," so there's no coherent "stay separate" case left at that point. Removed entirely, replaced by `discardAndAdoptAccountId()` (wipe local data + adopt the account outright) — docs/05 D14 revised in place to record both the original call and why it changed; (6) the direct next thing a real merge hit, immediately after (5) was fixed — `budgets`' own `(user_id, category_id, month, currency)` unique constraint, previously flagged in docs/43 as a "narrow edge case, not fixed," turned out to be hit by literally the first real merge (seed.ts deliberately randomizes budget ids per install specifically so two devices' seeded budgets collide on that natural key, docs/24 D113) — fixed by checking that natural key first and resolving per docs/02's policy (higher amount wins), matching `store.tsx`'s already-correct P2P merge logic; `category_keywords`' matching constraint doesn't need the same fix since its seed ids are deterministic, not random. Found and fixed 2026-08-22.
- `docs/artifacts/` — standalone HTML mockups (open directly in a browser): `piggypal-entry-ux.html` (doc 07), `piggypal-accounts-screen.html` (doc 12), `piggypal-picker-grouping.html` (doc 13), `piggypal-location-field.html` (doc 15 brainstorm — its three frames shipped as docs/16-18, each diverging in some way from the mockup's literal staging; see each doc's own notes), `piggypal-household-sharing.html` (doc 26 brainstorm — not yet built), `piggypal-p2p-pairing.html` (doc 27 brainstorm — not yet built), `piggypal-home-directions.html` (Home-screen UI directions, 2026-08-19 — direction C's bottom-entry idea is trialed for real in doc 31), `piggypal-desktop-tablet-directions.html` (three desktop/tablet structural directions — rail+side-composer, list+detail split, minimal/centered — 2026-08-20, not built or decided, see docs/00-backlog's "Custom UI for tablets and desktops")

# 06 — Subscription & Billing

## Core principle

Subscribing is the same UX moment as signing in (D10): "Enable sync & AI" →
magic link verify → straight into Stripe Checkout. Stripe is the source of
truth for subscription state via webhook, never a client-reported success.

## Schema

```sql
create table subscriptions (
  user_id                 uuid primary key references users(id),
  stripe_customer_id      text not null,
  stripe_subscription_id  text,
  status                  text not null,   -- trialing | active | past_due | canceled | incomplete
  current_period_end      timestamptz,
  updated_at              timestamptz not null default now()
);
```

One row per user. `updated_at` doubles as "when did status last change" —
used to compute the past_due grace window below, no separate timestamp
column needed.

## Flow

1. User verifies email (docs/05) → now authenticated with an access JWT.
2. Client redirects into Stripe Checkout with `client_reference_id = user_id`,
   `trial_period_days: 14` (card collected upfront; auto-converts to
   `active` at trial end unless canceled — standard Stripe Checkout
   behavior, no separate "trial ended, please pay" step to build).
3. `POST /api/stripe/webhook` — signature-verified (Stripe's signing secret),
   **not** JWT-authenticated like the rest of the API, since Stripe calls it
   directly. Handles:
   - `checkout.session.completed` → upsert `subscriptions` row.
   - `customer.subscription.updated` → update `status` / `current_period_end`.
   - `customer.subscription.deleted` → update `status = 'canceled'`, then
     immediately hard-delete that user's budgeting data (see below).
   - `invoice.payment_failed` → typically surfaces as a subsequent
     `customer.subscription.updated` with `status: past_due`; handled by
     the same handler.
   - Upserts by `stripe_subscription_id`, so redelivery is naturally
     idempotent — no separate event-id dedupe table needed.

## Enforcement (the Tiers section's two gates, refined)

Both `/api/sync/upload` and `/api/parse` run a single indexed PK lookup on
`subscriptions` per request — no cache, no subscription claim baked into the
JWT. It's one indexed row read; introducing a cache here would trade a
non-problem (latency) for a real one (staleness after cancellation).

```
has_paid_access(user_id) :=
  status in ('active', 'trialing')
  or (status = 'past_due' and now() - updated_at < interval '7 days')
```

**Refinement flagged against doc 01's Tiers section** ("Nowhere else"): that
line predates `/api/auth/powersync-token` (docs/05). Without the same check there, a
lapsed subscriber could keep *pulling* synced reads from other devices even
though writes are blocked, since PowerSync itself has no notion of Stripe
status. Proceeding with adding the same `has_paid_access` check to
`powersync-token` too — still conceptually "the sync gate," not new scope.

## Cancellation: identity persists, budgeting data doesn't

On `customer.subscription.deleted` (explicit cancel, or Stripe's own retry
cycle exhausting past_due without resolution — whatever window your Stripe
retry schedule is set to, on top of the 7-day soft gate above):

```sql
begin;
delete from transactions       where user_id = $1;
delete from budgets            where user_id = $1;
delete from category_keywords  where user_id = $1;
delete from categories         where user_id = $1;
delete from accounts           where user_id = $1;
commit;
```

Runs immediately, no grace window on the delete itself (the grace already
happened at the past_due stage). `users`, `subscriptions`, and
`refresh_tokens` rows are **not** deleted — identity must survive so a
resubscribe resolves to the same account id (D11), not a fresh signup that
would force the pre-existing-local-data rekey prompt (D14) for the wrong
reason.

**On the device**: nothing changes automatically. Local SQLite data is
untouched — it was never contingent on server state (local-first). The
device only loses sync/AI capability per the gates above; the user keeps
full read/write access to everything already on that device, same as a
free-tier user, unless they separately uninstall the app or wipe the
device's own OS-level backup.

**On resubscribe**: sign in → same `user_id` (identity persisted) → server
tables are empty for that user → device's local data re-uploads through the
normal upload queue and repopulates Postgres. If more than one device was
synced pre-cancellation, each already holds the same client-generated row
ids from before — re-upload from a second device is a no-op/update via the
existing `insert ... on conflict (id) do update` policy (docs/03), not a
duplicate.

## Billing management

Stripe's hosted Customer Portal for cancel/plan-change/payment-method
update — no custom billing UI to build.

## Decisions locked in this doc

| # | Decision | Why |
|---|---|---|
| D17 | Subscription state read via a plain indexed lookup per request, no cache, no JWT claim | One indexed row read is already fast enough; avoids a stale-claim window after cancellation for zero real latency win |
| D18 | past_due grace: 7 days of continued paid access before gates flip to free behavior | Absorbs a normal "card expired, Stripe is retrying" blip without instant cutoff |
| D19 | 14-day trial, card collected upfront via Stripe Checkout, auto-converts to active | Standard pattern, no separate trial-end payment step to build |
| D20 | `powersync-token` (docs/05) also checks `has_paid_access`, refining the Tiers section's "nowhere else" | That line predates this endpoint; without the check, a lapsed subscriber could keep pulling reads via other devices |
| D21 | On actual cancellation: hard-delete budgeting tables server-side immediately; `users`/`subscriptions`/`refresh_tokens` persist | Matches the app's privacy positioning while keeping identity stable for a clean resubscribe; local device data is unaffected either way (local-first) |

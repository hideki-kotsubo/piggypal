-- piggypal — Postgres schema
-- Generated from docs/03, docs/04, docs/05, docs/06. Keep in sync with those
-- docs if either changes — this file is the executable source of truth for
-- local dev; the docs are the source of truth for *why*.

-- ── Budgeting domain (docs/03, docs/10, docs/11, docs/12) ──────────────────

-- An account is a payment-method identity only — no currency, no goal.
-- Currency is chosen per transaction (see below), independently of which
-- account it's on; a single account's balance can span several currencies
-- at once (accounts.balancesFor sums by transaction currency). Goals are
-- tracked per category via `budgets`, not per account — docs/11 (account
-- savings goals) is superseded, see docs/10 D-note.
create table accounts (
  id                 uuid primary key,
  user_id            uuid not null,
  institution        text,    -- nullable, free text ("TD", "Itaú", "Wise") —
                               -- grouping/display only, no FK — see docs/12
  name               text not null,
  kind               text not null default 'checking',  -- checking | credit | cash | savings
  archived           boolean not null default false,  -- see docs/12; mirrors categories.archived
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table categories (
  id          uuid primary key,
  user_id     uuid not null,
  name        text not null,
  kind        text not null default 'expense',   -- expense | income
  parent_id   uuid references categories(id),    -- nullable; exactly 2
                                                   -- levels, enforced
                                                   -- app-side only — see
                                                   -- docs/14 D70
  icon        text,                              -- emoji or icon key
  sort_order  int not null default 0,
  archived    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table transactions (
  id           uuid primary key,
  user_id      uuid not null,
  account_id   uuid not null references accounts(id),
  category_id  uuid references categories(id),   -- nullable: uncategorized inbox
  amount_cents bigint not null,                  -- negative = expense, positive = income
  currency     char(3) not null default 'CAD',   -- the purchase's own currency, chosen
                                                  -- independently of the account at entry
                                                  -- time — accounts don't have a currency
                                                  -- of their own — see docs/10
  occurred_at  timestamp not null,  -- local wall-clock date+time, no timezone —
                                     -- matches how every other date in this
                                     -- schema is treated as "what the user means",
                                     -- not a UTC instant
  note         text,
  source       text not null default 'manual',   -- manual | ai | import
  ai_raw       text,                             -- original utterance, if source = 'ai'
  deleted_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table budgets (
  id           uuid primary key,
  user_id      uuid not null,
  category_id  uuid not null references categories(id),
  month        date not null,                    -- always first of month, e.g. 2026-08-01
  currency     char(3) not null default 'CAD',    -- budgets are per currency, not just per
                                                   -- category/month — see docs/10
  amount_cents bigint not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, category_id, month, currency)
);

-- Per-user learning vocab for the AI entry pipeline (docs/04). Synced to
-- device like the tables above so Tier 1's on-device parser benefits too.
create table category_keywords (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,
  category_id  uuid not null references categories(id),
  keyword      text not null,
  hits         int not null default 1,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, category_id, keyword)
);

-- Indexes the sync + app queries will lean on
create index on transactions (user_id, occurred_at desc);
create index on transactions (user_id, category_id, occurred_at);
create index on budgets      (user_id, month);

-- ── Auth (docs/05) — server-only, not part of the sync buckets above ───────

create table users (
  id          uuid primary key,          -- == the client's local user_id on first sign-up
  email       text not null unique,
  created_at  timestamptz not null default now()
);

create table magic_links (
  id           uuid primary key default gen_random_uuid(),
  email        text not null,
  token_hash   text not null,             -- sha256(token); the token itself is never stored
  expires_at   timestamptz not null,       -- issued_at + 15 min
  consumed_at  timestamptz
);

create table refresh_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id),
  device_id     uuid not null,             -- client-generated, persisted locally
  token_hash    text not null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,       -- created_at + 60 days, slides on rotation
  revoked_at    timestamptz,
  replaced_by   uuid references refresh_tokens(id)
);

-- ── Billing (docs/06) — server-only ─────────────────────────────────────────

create table subscriptions (
  user_id                 uuid primary key references users(id),
  stripe_customer_id      text not null,
  stripe_subscription_id  text,
  status                  text not null,   -- trialing | active | past_due | canceled | incomplete
  current_period_end      timestamptz,
  updated_at              timestamptz not null default now()
);

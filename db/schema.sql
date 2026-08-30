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
  owner_user_id      uuid not null,  -- whose payment instrument this is —
                               -- docs/24 D110. Not a sync-partition key
                               -- like user_id (which stays as-is pending
                               -- docs/24's broader household_id migration,
                               -- not done here) — a real per-row fact,
                               -- shown in the UI only once a household has
                               -- 2+ members. No explicit `references
                               -- users(id)`, matching user_id's own
                               -- convention above — users is defined later
                               -- in this file's server-only section, kept
                               -- decoupled from the sync-domain tables.
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table categories (
  id          text not null,      -- NOT uuid — docs/24's household-merge
                                   -- design deliberately gives every seed
                                   -- category a fixed, human-readable slug
                                   -- id ("cat-food", seed.ts) shared across
                                   -- every install, so two independently-
                                   -- seeded devices dedupe by id on merge
                                   -- instead of duplicating. accounts/
                                   -- transactions/budgets keep real
                                   -- crypto.randomUUID() ids — categories
                                   -- is the one deliberate exception. A
                                   -- uuid column here 500s on the very
                                   -- first sync upload of seed data — see
                                   -- docs/45.
  user_id     uuid not null,
  name        text not null,
  kind        text not null default 'expense',   -- expense | income
  parent_id   text,                              -- nullable; exactly 2
                                                   -- levels, enforced
                                                   -- app-side only — see
                                                   -- docs/14 D70
  icon        text,                              -- emoji or icon key
  sort_order  int not null default 0,
  archived    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- docs/46 D162 — composite, not a bare `id primary key`: the fixed
  -- slug above is only unique *within one person's own devices* by
  -- design (that's the whole point of the dedup-on-merge mechanism), but
  -- a bare `id` primary key made it unique *globally*, across every
  -- unrelated account on the deployment — confirmed as a real bug, not
  -- theoretical, see db/migrations/2026-08-24-categories-composite-key.sql.
  primary key (user_id, id),
  foreign key (user_id, parent_id) references categories (user_id, id)
);

create table transactions (
  id           uuid primary key,
  user_id      uuid not null,
  account_id   uuid not null references accounts(id),
  category_id  text,   -- nullable: uncategorized inbox; text, not uuid — see categories.id above
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
  merchant     text,    -- nullable, free text ("Costco", "Uber") — display/
                         -- grouping only, no FK, same shape as
                         -- accounts.institution — see docs/15
  source       text not null default 'manual',   -- manual | ai | import
  ai_raw       text,                             -- original utterance, if source = 'ai'
  deleted_at   timestamptz,
  paid_by_user_id     uuid not null,  -- whose money this was — mutable,
                                       -- editable any time — docs/24 D110
  created_by_user_id  uuid not null,  -- who logged the row — set once at
                                       -- insert, never patched after —
                                       -- docs/24 D110. Deliberately not the
                                       -- same column: see docs/24 for why.
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- docs/46 D162 — composite, matching categories' own composite key
  -- above; see that table's comment for why a bare `references
  -- categories(id)` isn't correct.
  foreign key (user_id, category_id) references categories (user_id, id)
);

create table budgets (
  id           uuid primary key,
  user_id      uuid not null,
  category_id  text not null,  -- text, not uuid — see categories.id above
  month        date not null,                    -- always first of month, e.g. 2026-08-01
  currency     char(3) not null default 'CAD',    -- budgets are per currency, not just per
                                                   -- category/month — see docs/10
  amount_cents bigint not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, category_id, month, currency),
  foreign key (user_id, category_id) references categories (user_id, id) -- docs/46 D162
);

-- Per-user learning vocab for the AI entry pipeline (docs/04). Synced to
-- device like the tables above so Tier 1's on-device parser benefits too.
create table category_keywords (
  id           text not null,     -- NOT uuid, same reason as categories.id
                                    -- above — seed.ts's keywords also use
                                    -- fixed slug ids ("ckw-1"), and D5's
                                    -- client-generated-id convention means
                                    -- there's no case where this table
                                    -- needs a server-generated id either —
                                    -- see docs/45.
  user_id      uuid not null,
  category_id  text not null,  -- text, not uuid — see categories.id above
  keyword      text not null,
  hits         int not null default 1,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, category_id, keyword),
  -- docs/46 D162 — composite, same reasoning as categories itself: a bare
  -- `id primary key` would be globally unique across every unrelated
  -- account, not just within one person's own devices.
  primary key (user_id, id),
  foreign key (user_id, category_id) references categories (user_id, id)
);

-- docs/48 D175 — one row per real person sharing this account. `id` is
-- deliberately not a fresh server-generated id: it's the same uuid
-- app/src/lib/identity.ts's getLocalUserId() already produces client-side
-- (and, for the account owner specifically, is literally users.id itself
-- — see that table's own comment below), so this table is purely
-- additive — no existing transactions.paid_by_user_id/created_by_user_id
-- or accounts.owner_user_id needs rewriting to adopt it. No `references
-- users(id)`, same reasoning as accounts.owner_user_id above — this is a
-- sync-domain table, decoupled from the server-only auth tables.
create table profiles (
  id           uuid primary key,
  user_id      uuid not null,
  display_name text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- docs/48 D176 — one row per physical device. `id` reuses
-- identity.ts's existing getDeviceId() (already generated on every
-- device for refresh-token tracking, docs/05 D12/D13) rather than a new
-- identity. Synced like profiles above so any device can see every
-- other device in the household, not just its own.
create table devices (
  id           uuid primary key,
  user_id      uuid not null,
  profile_id   uuid not null references profiles(id),
  label        text not null,
  last_seen_at timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  -- Every other synced table has this — api/src/sync/routes.ts's generic
  -- PUT/PATCH upsert unconditionally appends `updated_at = now()` for
  -- any table, not just the ones that "need" it for a UI recency display
  -- (docs/46 D170's original reason for adding it elsewhere). Missing
  -- here at first — see db/migrations/2026-08-30-devices-add-updated-at.sql.
  updated_at   timestamptz not null default now()
);

-- Indexes the sync + app queries will lean on
create index on transactions (user_id, occurred_at desc);
create index on transactions (user_id, category_id, occurred_at);
create index on budgets      (user_id, month);
create index on devices      (user_id, profile_id);

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

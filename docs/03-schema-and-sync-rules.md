# Budgeting PWA — MVP Schema & Sync Rules

Stack: Postgres (Azure) → PowerSync Service (self-hosted, Docker) → SQLite (PWA client via web SDK)

## Design principles

- **Client-generated UUIDs** — offline devices must create rows without asking the server for IDs.
- **`user_id` on every table** — this is what sync rules partition on. Non-negotiable.
- **Amounts in integer cents** — never floats for money.
- **`updated_at` everywhere** — server-side trigger; used for conflict resolution (last-write-wins per column group is enough for v1).
- **Soft delete on transactions** — `deleted_at` instead of hard delete, so a device that was offline during a delete converges cleanly and you get undo for free.

## Postgres schema

```sql
create table accounts (
  id                 uuid primary key,
  user_id            uuid not null,
  institution        text,    -- nullable, free text ("TD", "Itaú", "Wise") —
                               -- grouping/display only, no FK — see docs/12
  name               text not null,
  kind               text not null default 'checking',  -- checking | credit | cash | savings
  currency           char(3) not null default 'CAD',
  goal_amount_cents  bigint,  -- null = no savings goal set; any account kind — see docs/11
  goal_target_date   date,    -- null = no target date
  archived           boolean not null default false,  -- see docs/12; mirrors categories.archived
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table categories (
  id          uuid primary key,
  user_id     uuid not null,
  name        text not null,
  kind        text not null default 'expense',   -- expense | income
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
  currency     char(3) not null default 'CAD',   -- the purchase's own currency; may differ
                                                  -- from accounts.currency (e.g. a JPY purchase
                                                  -- on a CAD credit card) — see docs/10
  occurred_on  date not null,
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

-- Indexes the sync + app queries will lean on
create index on transactions (user_id, occurred_on desc);
create index on transactions (user_id, category_id, occurred_on);
create index on budgets      (user_id, month);
```

## PowerSync sync rules

Bucket per user — each device pulls only its owner's rows:

```yaml
bucket_definitions:
  user_data:
    parameters: select request.user_id() as user_id
    data:
      - select * from accounts     where user_id = bucket.user_id
      - select * from categories   where user_id = bucket.user_id
      - select * from budgets      where user_id = bucket.user_id
      - select * from transactions
        where user_id = bucket.user_id
          and occurred_on >= (now() - interval '18 months')
```

Notes:
- The 18-month window on transactions keeps the local DB small forever. Older history stays server-side, available via your API for reports.
- `request.user_id()` comes from the JWT your Node.js auth issues (magic link, same pattern as Àṣẹ).
- Later you can add a `shared_budget` bucket keyed on household_id for family sharing — the schema doesn't block it.

## Write path (your Node.js API)

PowerSync uploads the client's queued mutations to an endpoint you own:

```
POST /api/sync/upload
```

Handler responsibilities, in order:
1. Verify JWT → derive user_id (never trust user_id from payload).
2. Validate each op (row belongs to user, amount sane, FK exists).
3. Apply with `insert ... on conflict (id) do update set ... where excluded.updated_at > table.updated_at`  ← last-write-wins.
4. Subscription gate: free tier → reject sync entirely (single-device mode); paid → proceed.

## Conflict resolution policy (v1)

| Case | Resolution |
|---|---|
| Same transaction edited on two devices | Last write wins (updated_at) |
| Deleted on one device, edited on another | Delete wins (deleted_at set) |
| Budget upsert collision | unique constraint + LWW on amount |
| Duplicate AI entries (same utterance twice) | Not a conflict — dedupe heuristic in API (same user, amount, day, ±2 min created_at) → flag, don't block |

## What's deliberately missing from v1

- Multi-currency *conversion* (each currency is tracked and budgeted on its
  own terms — docs/10 — but no FX rates, no unified single-number rollup)
- Recurring transactions
- Shared/household budgets
- Transfer-between-accounts as linked pair (model as two transactions for now)

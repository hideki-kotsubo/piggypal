import { column, Schema, Table } from '@powersync/web';

// Mirrors db/schema.sql's client-synced tables — excludes users/magic_links/
// refresh_tokens/subscriptions, which docs/05 and docs/06 both describe as
// server-only, never part of the sync buckets.
//
// `user_id`/`household_id` are deliberately omitted from every table below:
// they exist in Postgres purely for sync-bucket partitioning across many
// users, but a single device's local DB only ever holds one user's data —
// there's nothing to partition locally. Add them when the sync phase
// begins, not before.
//
// `owner_user_id`/`paid_by_user_id`/`created_by_user_id` (docs/24 D110)
// are NOT partition keys, though — they're real per-row facts (whose
// account, who paid, who logged it) that are true even in single-device
// local-only mode, so they're here already, populated from
// identity.ts's getLocalUserId(). Not user-visible yet (docs/24: shown
// only once a household has 2+ members) — just laid down now so there's
// nothing to backfill later.
//
// PowerSync auto-adds a TEXT `id` primary key to every table — matches
// D5's client-generated UUIDs, so it's never declared explicitly here.
// Booleans (archived) store as integer 0/1, SQLite's own convention.

// updated_at (all four tables below): docs/46 D170 — Postgres already had
// this; the local schema didn't. Stored as ISO text, same convention as
// occurred_at/deleted_at, not a real local wall-clock semantic like
// occurred_at — pure bookkeeping for the sign-in merge redesign's
// recency display.
const accounts = new Table({
  institution: column.text, // nullable — grouping/display only, see docs/12 D60/D61
  name: column.text,
  kind: column.text, // checking | credit | cash | savings
  archived: column.integer,
  owner_user_id: column.text, // docs/24 D110 — whose payment instrument this is
  updated_at: column.text,
});

const categories = new Table({
  name: column.text,
  kind: column.text, // expense | income
  parent_id: column.text, // nullable — 2-level cap enforced app-side, see docs/14 D70
  icon: column.text,
  sort_order: column.integer,
  archived: column.integer,
  updated_at: column.text,
});

const transactions = new Table(
  {
    account_id: column.text,
    category_id: column.text,
    amount_cents: column.integer,
    currency: column.text,
    occurred_at: column.text, // local date+time, "YYYY-MM-DDTHH:MM:SS", no timezone
    note: column.text,
    merchant: column.text, // nullable, free text — display/grouping only, see docs/15
    source: column.text, // manual | ai | import
    ai_raw: column.text,
    deleted_at: column.text,
    // docs/24 D110 — paid_by_user_id (mutable, whose money it was) vs
    // created_by_user_id (immutable, who logged it) are deliberately
    // separate columns, not one.
    paid_by_user_id: column.text,
    created_by_user_id: column.text,
    updated_at: column.text,
  },
  { indexes: { by_account: ['account_id'], by_category: ['category_id'] } },
);

const budgets = new Table(
  {
    category_id: column.text,
    month: column.text,
    currency: column.text,
    amount_cents: column.integer,
    updated_at: column.text,
  },
  { indexes: { by_category_month: ['category_id', 'month'] } },
);

const category_keywords = new Table({
  category_id: column.text,
  keyword: column.text,
  hits: column.integer,
});

// docs/48 D175 — one row per real person sharing this account. `id`
// (PowerSync's auto-added primary key, per the file-level comment above)
// is the same value identity.ts's getLocalUserId() already produces —
// this table is additive, giving that existing id a real name.
const profiles = new Table({
  display_name: column.text,
  updated_at: column.text,
});

// docs/48 D176 — one row per physical device, `id` reusing identity.ts's
// existing getDeviceId(). Synced so every device can see the whole
// household's devices, not just its own.
const devices = new Table({
  profile_id: column.text,
  label: column.text,
  last_seen_at: column.text,
});

export const AppSchema = new Schema({
  accounts,
  categories,
  transactions,
  budgets,
  category_keywords,
  profiles,
  devices,
});

export type Database = (typeof AppSchema)['types'];

import { column, Schema, Table } from '@powersync/web';

// Mirrors db/schema.sql's client-synced tables — excludes users/magic_links/
// refresh_tokens/subscriptions, which docs/05 and docs/06 both describe as
// server-only, never part of the sync buckets.
//
// `user_id` is deliberately omitted from every table below: it exists in
// Postgres purely for sync-bucket partitioning across many users, but a
// single device's local DB only ever holds one user's data — there's
// nothing to partition locally. Auth/sync aren't wired up yet (this is
// still a local-only slice, docs/01 D1), so there's no real user_id to
// carry anyway. Add it when the sync phase begins, not before.
//
// PowerSync auto-adds a TEXT `id` primary key to every table — matches
// D5's client-generated UUIDs, so it's never declared explicitly here.
// Booleans (archived) store as integer 0/1, SQLite's own convention.

const accounts = new Table({
  institution: column.text, // nullable — grouping/display only, see docs/12 D60/D61
  name: column.text,
  kind: column.text, // checking | credit | cash | savings
  archived: column.integer,
});

const categories = new Table({
  name: column.text,
  kind: column.text, // expense | income
  parent_id: column.text, // nullable — 2-level cap enforced app-side, see docs/14 D70
  icon: column.text,
  sort_order: column.integer,
  archived: column.integer,
});

const transactions = new Table(
  {
    account_id: column.text,
    category_id: column.text,
    amount_cents: column.integer,
    currency: column.text,
    occurred_at: column.text, // local date+time, "YYYY-MM-DDTHH:MM:SS", no timezone
    note: column.text,
    source: column.text, // manual | ai | import
    ai_raw: column.text,
    deleted_at: column.text,
  },
  { indexes: { by_account: ['account_id'], by_category: ['category_id'] } },
);

const budgets = new Table(
  {
    category_id: column.text,
    month: column.text,
    currency: column.text,
    amount_cents: column.integer,
  },
  { indexes: { by_category_month: ['category_id', 'month'] } },
);

const category_keywords = new Table({
  category_id: column.text,
  keyword: column.text,
  hits: column.integer,
});

export const AppSchema = new Schema({
  accounts,
  categories,
  transactions,
  budgets,
  category_keywords,
});

export type Database = (typeof AppSchema)['types'];

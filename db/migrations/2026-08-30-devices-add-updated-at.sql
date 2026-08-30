-- Follow-up to 2026-08-30-profiles-and-devices.sql, applied same day
-- after a real error surfaced immediately on first use: `devices` was
-- created with `last_seen_at`/`created_at` but no `updated_at`, while
-- api/src/sync/routes.ts's generic PUT/PATCH upsert unconditionally
-- appends `updated_at = now()` for every table, matching every other
-- synced table's own convention (accounts, categories, transactions,
-- budgets, category_keywords, profiles). devices was the one table that
-- didn't get it, and touchDevice()'s very first PATCH against an
-- already-existing row hit "column \"updated_at\" of relation \"devices\"
-- does not exist" immediately.

begin;

alter table devices add column updated_at timestamptz not null default now();

commit;

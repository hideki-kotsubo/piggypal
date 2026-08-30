-- docs/48 D175/D176 — adds `profiles` and `devices`, plus backfills this
-- account's two already-real people (confirmed against production
-- Postgres directly while investigating the household-display bug this
-- design responds to — see docs/00-backlog's "Household display" entry
-- and the conversation around it).
--
-- Purely additive: no existing table is altered, no existing row is
-- rewritten. transactions.paid_by_user_id/created_by_user_id and
-- accounts.owner_user_id keep meaning exactly what they already mean —
-- this migration just gives the two ids already sitting in that data a
-- real, named, synced row for the first time. Safe to run against the
-- live account with no downtime and no risk to existing data; run this
-- directly against production the same way docs/45's and docs/46 D162's
-- migrations were (this sandbox can't reach it, see docs/39).
--
-- `devices` is intentionally left empty here — this migration doesn't
-- know each real device's getDeviceId() (client-only, never queried from
-- the server side), and doesn't need to: once the app code that reads/
-- writes this table ships, each device upserts its own row the next time
-- it connects. No backfill needed for a table that self-populates.

begin;

create table profiles (
  id           uuid primary key,
  user_id      uuid not null,
  display_name text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table devices (
  id           uuid primary key,
  user_id      uuid not null,
  profile_id   uuid not null references profiles(id),
  label        text not null,
  last_seen_at timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

create index on devices (user_id, profile_id);

-- This account's two real people, confirmed against production
-- 2026-08-30. The wife's display name is a placeholder ("Wife") — trivial
-- to rename later once the app has a real UI for it (not built by this
-- pass), just a PATCH `/api/sync/upload` away in the meantime.
insert into profiles (id, user_id, display_name) values
  ('c7c66146-f125-4466-8203-89315b9bc7bc', 'c7c66146-f125-4466-8203-89315b9bc7bc', 'Hideki'),
  ('1f9f9f05-1f9c-46d7-9bb7-c9d1feead038', 'c7c66146-f125-4466-8203-89315b9bc7bc', 'Wife');

commit;

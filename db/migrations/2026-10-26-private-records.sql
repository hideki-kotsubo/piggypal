-- docs/77 — "Only me" records and per-profile PINs.
--
-- transactions.private_to_profile_id: NULL = shared with the household
-- (every existing row). Set = only devices verified as that profile
-- download the row (deploy/powersync/sync-config.yaml). Written by the
-- client, checked by /api/sync/upload (D298).
--
-- transaction_splits.private_to_profile_id: a copy of its transaction's
-- value, kept by the upload handler only (never client-writable), so the
-- splits stream can filter on its own column.
--
-- profiles.has_pin: set by the api when a PIN is set or reset, synced
-- down so every device knows whether picking that profile needs a PIN.
--
-- profile_pins and device_profiles are server-only, never synced
-- (D299): the PIN hash, its failed-attempt lock, and which profile each
-- device's session was verified as. That second table is what puts
-- profile_id into a device's tokens; the client-written devices row
-- can't, since any device can upload any profile_id there.

begin;

alter table transactions add column private_to_profile_id uuid;
alter table transaction_splits add column private_to_profile_id uuid;
alter table profiles add column has_pin boolean not null default false;

create table profile_pins (
  profile_id      uuid primary key references profiles(id) on delete cascade,
  user_id         uuid not null,
  pin_hash        text not null,            -- scrypt, "salt:hash" hex
  failed_attempts int not null default 0,
  locked_until    timestamptz,
  updated_at      timestamptz not null default now()
);

create table device_profiles (
  user_id     uuid not null,
  device_id   uuid not null,
  profile_id  uuid not null,
  verified_at timestamptz not null default now(),
  primary key (user_id, device_id)
);

create index on transactions (private_to_profile_id) where private_to_profile_id is not null;

commit;

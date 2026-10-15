-- docs/71 — household management.
--
-- D252: removing a person is a soft delete, same as transactions and
-- scheduled payments: their transactions/accounts keep pointing at a real
-- row (so the name still shows in history), and a removed person can be
-- restored. Existing profiles get NULL (not removed).
--
-- D255 (docs/48 D178): single-use, short-lived codes an already signed-in
-- device shows as a QR so a new device can sign in without email. Only the
-- hash is stored, same as magic_links/refresh_tokens. Server-only, never
-- synced.

begin;

alter table profiles add column deleted_at timestamptz;

create table device_link_codes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id),
  token_hash  text not null unique,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  claimed_at  timestamptz
);

commit;

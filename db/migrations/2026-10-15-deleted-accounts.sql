-- docs/72 D260 — a tombstone per deleted account, so another household
-- device whose session was wiped by the deletion is told "this account was
-- deleted" (and signs itself out) instead of "sign in again". Holds only the
-- random account id and when; nothing that identifies a person. Removed
-- again if the same id signs up anew. Server-only, never synced.

begin;

create table deleted_accounts (
  user_id     uuid primary key,
  deleted_at  timestamptz not null default now()
);

commit;

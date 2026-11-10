-- docs/83 D320–D323 — every account has exactly one owner profile, enforced
-- by the database rather than by "profile id == users.id" (docs/72 D257).
--
-- Found 2026-11-10: the dev account had no profile with its users.id. The
-- signing-up device never uploaded its owner profile, and the next device
-- joined through the picker as "Someone new", so nobody could delete the
-- account (or use the owner's emailed PIN reset).
--
-- users.owner_profile_id points at the owner, NOT NULL, with a deferred
-- foreign key into the same account's profiles: a transaction that leaves
-- an account without its owner profile can't commit. profiles.is_owner is
-- a copy for the apps (synced like has_pin), kept by triggers, never by
-- uploads. The owner's profile can't be soft-deleted either.
--
-- Backfill: the profile whose id is users.id when it exists, otherwise the
-- account's oldest profile, live ones first; a removed owner is restored.
-- An account with no profile at all (a sign-up that was cancelled) gets
-- one named after the email's local part, which the app lets them rename.

begin;

alter table profiles add column if not exists is_owner boolean not null default false;
alter table profiles add constraint profiles_user_id_id_key unique (user_id, id);
alter table users add column if not exists owner_profile_id uuid;

insert into profiles (id, user_id, display_name)
select case when exists (select 1 from profiles t where t.id = u.id) then gen_random_uuid() else u.id end,
       u.id,
       split_part(u.email, '@', 1)
  from users u
 where not exists (select 1 from profiles p where p.user_id = u.id);

update users u
   set owner_profile_id = (
     select p.id from profiles p
      where p.user_id = u.id
      order by (p.deleted_at is null) desc, (p.id = u.id) desc, p.created_at, p.id
      limit 1)
 where u.owner_profile_id is null;

update profiles p
   set is_owner = true,
       deleted_at = null,
       updated_at = now()
  from users u
 where u.owner_profile_id = p.id;

alter table users alter column owner_profile_id set not null;
alter table users add constraint users_owner_profile_fkey
  foreign key (id, owner_profile_id) references profiles (user_id, id)
  deferrable initially deferred;

-- is_owner always mirrors users.owner_profile_id, whatever writes the row.
create or replace function profiles_owner_flag() returns trigger language plpgsql as $$
begin
  new.is_owner := exists (select 1 from users where id = new.user_id and owner_profile_id = new.id);
  if new.is_owner and new.deleted_at is not null then
    raise exception 'The account owner''s profile can''t be removed' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger profiles_owner_flag
  before insert or update on profiles
  for each row execute function profiles_owner_flag();

create or replace function users_owner_sync() returns trigger language plpgsql as $$
begin
  update profiles set is_owner = (id = new.owner_profile_id)
   where user_id = new.id and is_owner <> (id = new.owner_profile_id);
  return null;
end $$;

create trigger users_owner_sync
  after insert or update of owner_profile_id on users
  for each row execute function users_owner_sync();

commit;

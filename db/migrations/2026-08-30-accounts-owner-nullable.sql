-- A new feature request: an account can optionally be linked to a real
-- profile as its owner, so transactions on it default their payer
-- automatically instead of asking every time -- but not every account has
-- one obvious owner (a joint account, say), so "no specific owner" needs
-- to be a real, representable state, not just whatever the creating
-- device happened to be.
--
-- Confirmed safe against production before writing this: every existing
-- account already has a real, non-null owner_user_id (populated at
-- insert time since docs/24 D110) -- this migration doesn't change any
-- existing row's value, only what's allowed going forward. Null now
-- means "shared/joint, deliberately no default payer," not a legacy gap.

begin;

alter table accounts alter column owner_user_id drop not null;

commit;

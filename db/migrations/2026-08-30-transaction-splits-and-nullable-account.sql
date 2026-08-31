-- docs/50 — supersedes 2026-08-30-transactions-split-group-id.sql's
-- design (kept as historical record, not deleted). That design let a
-- split purchase's shared fields (category/date/note/merchant) diverge
-- per sibling row — confirmed as a real bug against real data, not just
-- in theory (see docs/50). Here, a purchase is always exactly one
-- transactions row; a new transaction_splits table holds the per-account
-- amount breakdown when it's split across 2+ accounts.
--
-- Purely additive, safe to run any time: every existing transactions row
-- already has a real, non-null account_id (nothing here changes that),
-- and the new table starts empty.

begin;

create table transaction_splits (
  id             uuid primary key,
  user_id        uuid not null,
  transaction_id uuid not null references transactions(id),
  account_id     uuid not null references accounts(id),
  amount_cents   bigint not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index on transaction_splits (user_id, transaction_id);
create index on transaction_splits (user_id, account_id);

alter table transactions alter column account_id drop not null;

commit;

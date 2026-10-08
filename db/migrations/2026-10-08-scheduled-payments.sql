-- docs/57 — scheduled payments (recurring + installments). A rule table
-- plus two nullable columns linking a posted occurrence back to its rule.
--
-- Purely additive, safe to run any time: the new table starts empty and
-- every existing transactions row simply has NULL in both new columns.
-- The `powersync` publication is FOR ALL TABLES, so the new table is
-- replicated without touching it.

begin;

create table scheduled_payments (
  id                uuid primary key,
  user_id           uuid not null,
  name              text not null,
  account_id        uuid references accounts(id),
  category_id       text,
  amount_cents      bigint not null,
  amount_mode       text not null default 'fixed',
  currency          char(3) not null,
  merchant          text,
  note              text,
  paid_by_user_id   uuid not null,
  kind              text not null default 'recurring',
  freq              text not null,
  interval_count    int  not null default 1,
  anchor_date       date not null,
  occurrence_count  int,
  end_date          date,
  start_index       int  not null default 1,
  auto_post         boolean not null default false,
  paused            boolean not null default false,
  archived          boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  foreign key (user_id, category_id) references categories (user_id, id)
);

create index on scheduled_payments (user_id);

alter table transactions add column schedule_id uuid references scheduled_payments(id);
alter table transactions add column occurrence_date date;

create index on transactions (schedule_id) where schedule_id is not null;

commit;

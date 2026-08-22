-- docs/45: categories.id and category_keywords.id were typed uuid, but
-- seed data (app/src/lib/seed.ts) deliberately uses human-readable slug
-- ids ("cat-food", "ckw-1"), not UUIDs (docs/24's household-merge dedupe
-- design). Every real device's first sync upload fails on this until
-- this migration is applied. Matches db/schema.sql's already-updated
-- target state exactly.
--
-- Safe to run as-is only if these five tables are currently empty on the
-- target database (true for a fresh production Postgres that's never had
-- a real device sync before today, since /api/sync/upload didn't exist
-- until docs/43). CHECK FIRST — see the guard query below — before
-- running the ALTERs on anything that might have real data.
--
-- Usage: psql "$DATABASE_URL" -f db/migrations/2026-08-22-categories-id-text.sql

-- Guard: confirms zero rows in every affected table. If any of these
-- return non-zero, STOP — do not run the ALTERs below without a real
-- data-preserving migration plan instead (this file doesn't attempt one).
select
  (select count(*) from categories)        as categories,
  (select count(*) from category_keywords) as category_keywords,
  (select count(*) from transactions)      as transactions,
  (select count(*) from budgets)           as budgets;

begin;

alter table categories drop constraint if exists categories_parent_id_fkey;
alter table budgets drop constraint if exists budgets_category_id_fkey;
alter table category_keywords drop constraint if exists category_keywords_category_id_fkey;
alter table transactions drop constraint if exists transactions_category_id_fkey;

alter table categories alter column id type text;
alter table categories alter column parent_id type text;
alter table budgets alter column category_id type text;
alter table category_keywords alter column id type text;
alter table category_keywords alter column id drop default;
alter table category_keywords alter column category_id type text;
alter table transactions alter column category_id type text;

alter table categories add constraint categories_parent_id_fkey foreign key (parent_id) references categories(id);
alter table budgets add constraint budgets_category_id_fkey foreign key (category_id) references categories(id);
alter table category_keywords add constraint category_keywords_category_id_fkey foreign key (category_id) references categories(id);
alter table transactions add constraint transactions_category_id_fkey foreign key (category_id) references categories(id);

commit;

-- Verify:
\d categories
\d category_keywords

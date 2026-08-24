-- docs/46 D162 — categories/category_keywords move from a bare
-- `id text primary key` to a composite `primary key (user_id, id)`.
--
-- Root cause this fixes, confirmed empirically against a scratch copy of
-- this schema before writing this migration: seed.ts gives every install
-- the same fixed category slugs ("cat-food", ...) by design (docs/24's
-- household-merge dedup), but the old schema's bare `id primary key` made
-- that id unique *globally*, across every unrelated account on the whole
-- deployment — not just within one person's own devices. A second,
-- completely unrelated real user's first sync upload of their own
-- identically-seeded categories hits `duplicate key value violates
-- unique constraint "categories_pkey"` on Postgres, and the upload
-- endpoint's ownership-guard WHERE clause (api/src/sync/routes.ts) turns
-- that collision into a *silent* no-op instead of a crash — which is
-- what actually produced the reported "categories and accounts vanished"
-- bug (docs/46's "What this closes").
--
-- Safe with respect to existing data: `id` alone was already unique
-- before this change, so `(user_id, id)` is trivially still unique too —
-- this migration can never turn a previously-valid row into a duplicate.
-- Run this against a REAL Postgres instance directly (psql/whatever
-- migration runner this project ends up using — none exists yet, same
-- as docs/45's own migration). Verified against a scratch clone of this
-- schema in this sandbox's local Postgres before being written here —
-- including catching and fixing a real ordering bug (Postgres refuses to
-- drop categories_pkey while other tables' FKs still depend on it; those
-- have to drop first). NOT yet applied to the live shared sandbox DB or
-- real production — both need a separate, explicit go-ahead per docs/46's
-- own plan.

begin;

-- Drop every FK that depends on categories_pkey *before* touching the
-- key itself — Postgres refuses the drop otherwise (confirmed directly:
-- the first attempt at this migration errored exactly this way, caught
-- by the transaction wrapper with zero damage, not assumed).
alter table transactions drop constraint transactions_category_id_fkey;
alter table budgets drop constraint budgets_category_id_fkey;
alter table category_keywords drop constraint category_keywords_category_id_fkey;
alter table categories drop constraint categories_parent_id_fkey; -- self-referencing

-- ---- categories ----

alter table categories drop constraint categories_pkey;
alter table categories add primary key (user_id, id);

-- ---- category_keywords ----

alter table category_keywords drop constraint category_keywords_pkey;
alter table category_keywords add primary key (user_id, id);

-- ---- re-add every FK against the new composite key ----

alter table categories
  add constraint categories_parent_id_fkey
  foreign key (user_id, parent_id) references categories (user_id, id);

alter table category_keywords
  add constraint category_keywords_category_id_fkey
  foreign key (user_id, category_id) references categories (user_id, id);

alter table transactions
  add constraint transactions_category_id_fkey
  foreign key (user_id, category_id) references categories (user_id, id);

alter table budgets
  add constraint budgets_category_id_fkey
  foreign key (user_id, category_id) references categories (user_id, id);

commit;

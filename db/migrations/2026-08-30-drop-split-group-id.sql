-- docs/50 — finishes reverting 2026-08-30-transactions-split-group-id.sql
-- now that transaction_splits (previous migration) is the real mechanism.
--
-- The two rows below are this session's own throwaway verification
-- fixtures for that now-reverted design (confirmed via a direct read-only
-- query against this database while designing docs/50) -- deleted
-- outright rather than migrated, per the user's own explicit call: no
-- real user data has ever used split_group_id.
--
-- Dropping split_group_id also drops its (user_id, split_group_id) index
-- automatically -- Postgres drops indexes that reference a dropped column
-- without needing a separate DROP INDEX.

begin;

delete from transactions where note in ('Split test purchase', 'Split test purchase 2');

alter table transactions drop column split_group_id;

commit;

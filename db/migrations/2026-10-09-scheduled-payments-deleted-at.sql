-- docs/57 D217 — deleting a schedule is a soft delete, same as
-- transactions: posted occurrences keep their schedule_id FK valid, and a
-- deleted rule can't be resurrected by docs/25's insert-if-missing P2P
-- merge (it's still a row, just marked deleted).
--
-- Purely additive: existing rules get NULL (not deleted). Run after
-- 2026-10-08-scheduled-payments.sql.

begin;

alter table scheduled_payments add column deleted_at timestamptz;

commit;

-- docs/49 — a purchase paid across multiple accounts, or a future
-- transfer between two of the user's own accounts, becomes multiple
-- ordinary transaction rows sharing one split_group_id instead of a
-- separate parent/child table. No FK (grouping/display only, same
-- convention as institution/merchant) -- deliberately advisory, not an
-- enforced invariant, so a group's rows can still be edited or deleted
-- independently (matters for offline sync: two devices editing different
-- legs while apart must never deadlock on a cross-row constraint).
--
-- Safe against production as-is: every existing row gets NULL, the same
-- "not part of any split" state as before this column existed.

begin;

alter table transactions add column split_group_id uuid;
create index on transactions (user_id, split_group_id);

commit;

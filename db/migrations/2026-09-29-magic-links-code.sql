-- docs/56 D204: a 6-digit code emailed alongside the magic link, so a
-- sign-in can finish inside the app that requested it (an iOS home-screen
-- PWA can't receive the link at all — docs/56's correction to docs/54).
-- Same row, two credentials: using either one consumes it. Nullable
-- code_hash keeps rows issued before this migration valid (link-only).

begin;

alter table magic_links add column code_hash text;
alter table magic_links add column code_attempts int not null default 0;

commit;

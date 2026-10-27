-- docs/77 D302–D304 — forgotten PINs, without erasing anything.
--
-- profiles.pin_reset_*: the last PIN reset not done by the person on a
-- device already verified as them — by another household member from
-- their own device (D303), or by the owner with an emailed code (D302).
-- Written by the api only, synced down so every device of that person
-- shows who did it, where and when, until they dismiss it (D304).
-- pin_reset_by is the acting profile (the person themselves for an
-- emailed code); pin_reset_device is that device's label at the time.
--
-- profile_pins.reset_code_*: the owner's emailed reset code, hashed,
-- 15 minutes, 5 tries, like the sign-in code (docs/56 D204).
--
-- First shipped as 2026-10-26-pin-recovery.sql, which sorted before
-- 2026-10-26-private-records.sql ("pin" < "pri") and so ran before the
-- profile_pins table existed: the api stopped on startup. Renamed so it
-- runs after, and made re-runnable (dev had applied the old name).

begin;

alter table profiles add column if not exists pin_reset_at timestamptz;
alter table profiles add column if not exists pin_reset_by uuid;
alter table profiles add column if not exists pin_reset_device text;

alter table profile_pins add column if not exists reset_code_hash text;
alter table profile_pins add column if not exists reset_code_expires_at timestamptz;
alter table profile_pins add column if not exists reset_code_attempts int not null default 0;

commit;

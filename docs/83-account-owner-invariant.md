# 83 — Every account has an owner

2026-11-10, branch `fix/account-owner`. Replaces the owner rule in
docs/72 D257 ("the profile whose id is `users.id`") with an owner the
database enforces.

## What went wrong

The account owner couldn't delete the account on dev. Settings said only
the owner could, and the owner was the one asking.

The account had no profile with `users.id`'s id, so as far as the rule
went it had no owner:

1. 2026-10-16 06:08:02 — a device signed up. The api made its
   `localUserId` the new `users.id` (docs/05 D11), as usual.
2. That device never created its owner profile. The app adds it locally
   right after sign-in (`AuthVerifyScreen`), and it only reaches the
   server once that device uploads. This one never did: no profile, no
   devices row, nothing referring to that id.
3. 49 seconds later the iMac joined the existing account, found no
   profiles in the picker and chose **Someone new**, which created
   "Hideki" with the iMac's own id.

Nothing stopped this. The owner profile depended on one device finishing
a step after sign-in, and anything that interrupts it (a cancelled
sign-up, docs/75's known gap; a reset; a closed tab; a test browser)
leaves an account with no owner. The emailed PIN reset (docs/77 D302)
had the same rule and the same problem.

## D320 — The server creates the owner with the account, and the database requires it

`completeSignIn` inserts the owner profile in the same transaction as
the `users` row. It's named after the email's local part until the
app's own profile upload renames it, which it already does right after
sign-in (now an update to an existing row rather than an insert).

`users.owner_profile_id` is `NOT NULL`, with a foreign key
`(id, owner_profile_id) → profiles (user_id, id)`, `DEFERRABLE INITIALLY
DEFERRED`. The check runs at commit, so the user and profile inserts can
happen in either order, but a transaction that leaves an account without
an owner profile of its own can't commit, whatever the code does.

The owner is usually `users.id`, but not always: accounts fixed by
D323 have an owner with a different id. Every owner check (delete
account, the emailed PIN code and reset, the reset notice email) reads
`owner_profile_id` through `ownerProfileId()` in `api/src/auth/routes.ts`.

## D321 — `profiles.is_owner` tells the apps who the owner is

The apps only see synced tables, and `users` isn't one. `profiles.is_owner`
is a copy of `owner_profile_id`, kept by two triggers: one sets it on
every insert or update of a profile, the other updates the account's
profiles when `owner_profile_id` changes. Uploads can't write it (not in
`TABLE_COLUMNS`, and the trigger recomputes it anyway), like `has_pin`.
The snapshot endpoint also returns `isOwner`.

In the app, `ownerProfileId(profiles, accountUserId)` in
`lib/household.ts` is the one place that answers "who is the owner".
It falls back to the old rule only while no profile has the flag yet (a
device that hasn't downloaded since sign-up, or an api older than this).
Delete account and the PIN screen use it.

## D322 — The owner's profile can't be removed

Only account deletion removes the owner (it removes the account with it).

- The database: the profiles trigger refuses `deleted_at` on the owner,
  and a hard delete fails the deferred foreign key, unless the `users`
  row goes in the same transaction.
- `/api/sync/upload` skips a profile `DELETE`, or a `PUT`/`PATCH` setting
  `deleted_at`, on the owner with reason `owner-profile`. Without this the
  trigger would fail the whole batch and the device would retry it
  forever. The device gets the row back on its next download.
- Household doesn't offer **Remove** for the owner.

Moving ownership to another person isn't built. The schema allows it
(an `UPDATE users SET owner_profile_id`, and the flags follow), but
there's no screen or endpoint for it.

## D323 — Existing accounts

Migration `2026-11-10-account-owner.sql` picks each account's owner: a
live profile with `users.id`'s id, otherwise the oldest live profile,
otherwise the oldest removed one, which is restored. An account with no
profile at all (a cancelled sign-up) gets one named after the email. The
dev account's owner is now "Hideki".

## Checked

- Migration on a throwaway database built from `main`'s `schema.sql`,
  18/18: all five backfill cases, plus the guarantees (no user without an
  owner, no owner from another account, no removing the owner by soft or
  hard delete, a removed profile can't become owner, `is_owner` can't be
  forged, sign-up commits, flags follow a change of owner, account delete
  commits). The new `schema.sql` on its own, 13/13.
- Against the dev api, 17/17: sign-up creates the owner; the app's
  profile upload renames it and keeps it owner; all three ways of
  removing the owner are skipped; a member device gets 403; an owner
  whose id isn't `users.id` deletes the account.
- App: typecheck, 276 unit tests, lint (no new warnings). Not checked by
  eye or on a phone.

## Rollout

The api applies the migration at startup. Restart PowerSync after the
api release (as for docs/77), so `profiles.is_owner` reaches devices. Until a
device has it, the app falls back to the old rule.

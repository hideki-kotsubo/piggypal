# 75 — Sign-out erases the device by default

2026-10-20. Built the same day on `feat/signout-clear`. API change
verified against the dev server and dev Postgres (4/4, test rows removed
afterwards); Settings checked in headless Chromium at iPhone size. Not
yet run on a phone or through the real PowerSync Service.

## Why

Before this, sign-out (`SettingsScreen`'s `handleSignOut`) only called
`db.disconnect()` and dropped the tokens. Every row stayed on the device,
and the app carried on in local-only mode on the account's data. Two
problems:

- **Privacy.** Signing out to hand a phone or browser to someone else
  left all the account's finances on screen.
- **Signing in to another account.** The kept rows went into the docs/46
  merge cascade for the new account. Those rows have client UUIDs that
  the old account already owns on the server, so their uploads hit
  docs/46 D163's ownership conflict. If the new email had no account
  yet, sign-in failed outright: `completeSignIn` used the device's
  `localUserId` (still the old account's id) as the new `users.id`, a
  duplicate primary key.

## Choices made with the user before building

- The default sign-out **erases the device**. "Disconnect and keep
  data" is the second option.
- Data from another account that **still exists** can't be merged into
  a new one, only erased.
- A device whose account was **deleted** elsewhere (docs/72 D260) keeps
  its data, as before, and may merge it into another account.

## D283 — Sign-out erases this device by default

Settings → Sign out opens a panel with an explanation and two buttons:
**Sign out and erase this device** (primary) and **Disconnect and keep
data**. Erase runs `signOut()` first (revokes the refresh token while it's
still there to send), then `store.resetLocalData()`. That's the same wipe
as Reset local data: `disconnectAndClear()` (tables plus upload queue),
paired peers, the account marker and the local user id, then a reload. The
reload re-seeds starter data, since the device is now signed out.

Kept: device id, device name, theme, language, voice and dollar
settings. These belong to the device, not the account.

Nothing that synced is lost: signing in again downloads it.

## D284 — "Disconnect and keep data" remembers the account

Keep does what sign-out used to do, plus it saves the account
(`{ userId, email }`) as `flowtab:kept-data-account` (`auth.ts`'s
`getKeptData`/`setKeptData`/`useKeptData`). While that marker exists:

- Settings shows "Signed out. This device still has data from <email>".
- Typing a **different** email replaces "Send link" with a warning and
  **Erase this device's data** (Reset local data's confirm). You can't
  request a link for another account until the device is clear.
- Signing in to the **same** account just reconnects. The owner's
  device skips straight to `finish()` (`localUserId === userId`). A
  household member's device matches its own profile and goes through
  the usual cascade, which finds everything already matching.

The marker is cleared by any finished sign-in (`useAuthAccount`'s
setter), by Reset local data, and by `discardAndAdoptAccountId`.

## D285 — Data from another account is erased, never merged

Two checks, so neither one has to be perfect:

1. **Server.** `completeSignIn` no longer reuses a `localUserId` that's
   already a `users.id` or a `profiles.id`. The new account gets a fresh
   `randomUUID()`. This also fixes the duplicate-key failure for devices
   that signed out before this change.
2. **App.** After verifying, `AuthVerifyScreen` checks two things:
   whether a kept marker exists for a different `userId`, and whether
   the server had to give a new account an id other than this device's
   `localUserId`. Either one means the data is another account's. A new
   step says so and offers only **Erase and sign in** or **Cancel**.
   Erase calls `discardAndAdoptAccountId(userId, { seedStarter })`. A
   brand-new account gets starter data and its owner profile, since
   it has nothing to download. Cancel calls `signOut()` to revoke the
   session that was just issued, and leaves the data and the marker as
   they were.

Check 2 covers the QR device-link path and links requested from another
device, where Settings' email guard never ran.

`discardAndAdoptAccountId` also forgets paired peers now, as reset does.
That applies to the profile picker's existing discard button too.

## D286 — A deleted account's data stays mergeable

docs/72 D257 hard-deletes every server row for the account, so nothing
on the server owns those local ids any more. `handleAccountDeleted` sets
no kept marker. Signing in afterwards behaves like free-tier data: the
owner signing up again reuses the same id (docs/72's existing
`deleted_accounts` cleanup), and any other account gets the normal merge
prompt.

## D287 — Unsynced changes are called out before erasing

Erasing also drops PowerSync's upload queue. When
`usePendingUploadCount()` is above zero, the panel says how many changes
would be lost and offers **Sync now** if online with a live session.
Erasing is still allowed: a dead session can't upload anyway, and "keep
data" is right there.

## Known gaps

- A device that signed out **before** this release, keeping another
  account's data, and then signs in to a different **existing** account
  isn't caught by check 2 (no new id involved) and has no marker. It
  gets the old merge prompt. It's a one-time leftover of the old
  behaviour; Reset local data fixes it by hand.
- Cancelling D285's step after signing up a **new** email leaves an
  empty `users` row. Signing in to that email later works, through the
  profile picker with no profiles.

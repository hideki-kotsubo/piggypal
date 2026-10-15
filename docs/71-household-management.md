# 71 — Household management: people and devices

2026-10-14. Implemented the same day. API verified against a throwaway
PGlite Postgres (23/23); app typechecked, linted, unit tests and build
pass; screens not yet checked by eye or on a phone. See "Verified" below.

## The gap

docs/48 shipped most of its design (profiles and devices tables, sync
streams, the "whose device is this?" sign-in picker, a rename-only
Profiles screen, a read-only devices list). What it explicitly left out:
removing a person, and any way to act on a device. There was also no QR
device linking (docs/48 D178), so every new device needed the email
round trip. Household information was spread over three Settings
sections: the Profiles link, "Household devices" and "Household".

Choices made with the user before building: removing a person archives
them and keeps their history; removing a device signs it out remotely;
one Household screen; QR linking included.

## D252 — Removing a person is a soft delete

`profiles.deleted_at` (migration `2026-10-14-household-management.sql`),
same pattern as transactions and scheduled payments (docs/57 D217).
Nothing that references the person is rewritten: `paid_by_user_id`,
`created_by_user_id` and `owner_user_id` keep pointing at a real row.

- `personLabel()` shows a removed person as "Ana (removed)" wherever
  history refers to them (payer badges, account owner).
- `useHouseholdPeers()` drops removed ids, so they leave the payer
  picker, the members list and `hasHousehold()`. Without that, their old
  transactions would bring them back as an "observed" id.
- They're no longer offered as an account owner, and `defaultPayerFor()`
  falls back to you for an account a removed person owns.
- `/api/sync/snapshot` leaves removed profiles out, so a new device's
  sign-in picker doesn't offer them.
- Removing a person first signs out all of their devices (D253). If a
  revoke fails, the person isn't removed and no device rows are deleted
  (devices already revoked stay signed out; retrying finishes the job).
- **Restore** (Household → Removed) clears `deleted_at`.
- You can't remove yourself; sign out instead. Anyone else's device can
  remove you, and Restore undoes it.
- A removed person's device that signs in again sees the picker. If it
  picks "Someone new", it keeps its old id, so `store.addProfile()` now
  brings the archived row back instead of inserting a duplicate primary
  key (select-then-write: PowerSync's tables are views, so no
  `ON CONFLICT`).

## D253 — Removing a device signs it out

`POST /api/auth/devices/:deviceId/revoke` (authenticated) revokes every
refresh token that device holds for this account. The device's row is
then deleted through the normal upload path (`store.removeDevice`), not
by the endpoint. That keeps CLAUDE.md's "one write path" rule for synced
tables; `refresh_tokens` is server-only. The order matters: revoke first
(it needs the network and can fail), then delete, so a failed revoke
never hides a device that's still signed in.

What the removed device sees: its current access token keeps working
until it expires (15 minutes, docs/05). After that the refresh call
gets a 401 and the app shows "Sync paused — sign in again" (docs/68
D244). Its local data stays on it.

Known gap: during those 15 minutes, a reconnect on that device runs
`touchDevice()` and can put its row back. It still can't refresh, so it
falls out of sync, but it reappears in the list until someone removes it
again. Closing that would need a server check against revoked chains on
`devices` upserts. Not done; flagged.

You can't remove the device you're using; sign out does that.

## D254 — Adding a person without a device

Household → **+ Add a person** creates a profile with a fresh
`crypto.randomUUID()`. They can be picked as a payer or account owner
right away. When they later sign in on their own device, the picker
offers "This is Ana's device", and that device adopts the profile's id
(docs/48 D177's existing path).

## D255 — QR device linking (docs/48 D178)

- `POST /api/auth/device-link/start` (authenticated) returns a 32-byte
  opaque token and its expiry, 5 minutes out. Only the sha256 is stored
  (`device_link_codes`). Each new start deletes the account's older
  unclaimed codes, so at most one is live.
- `POST /api/auth/device-link/claim` (unauthenticated; the token is the
  credential) consumes the code under `FOR UPDATE` and issues a session
  exactly like `/verify`. The shared tail is now `issueSession()` in
  `api/src/auth/routes.ts`. The response adds `email`, since the scanning
  device never typed it. Native origins get the refresh token in the
  body, as in docs/68.
- QR payload: `flowtab-link:v1:<token>`. It's prefixed so the scanner can
  turn away a random QR or a docs/25 pairing code with a clear message.
  It's deliberately not a URL: in the native apps the origin is
  `capacitor://localhost`, and on iOS a home-screen PWA never receives
  links anyway (docs/56). Scanning happens inside the app.
- Showing a code: Household → **+ Add a device to this account**
  (`DeviceLinkScreen`, with a countdown and "Show a new code"). The
  screen notices the new device's row arriving and says so.
- Scanning a code: Settings → Account (signed out) → **Scan a code from
  a signed-in device** (`ScanDeviceLinkScreen` at `/auth/scan`). It hands
  the token to `AuthVerifyScreen` as a third credential, `device-link`,
  verified straight away like the typed code (a real person scanned it,
  so there's no link-scanner risk; `verifiedRef` absorbs StrictMode).
  From there it's the usual profile picker and merge.
- Security, as docs/48 flagged: anyone who can see the screen can use the
  code. Mitigations: 5 minutes, single use, only one live code at a time,
  and only a signed-in device can create one. The screen also says this.
- Expired and claimed codes aren't swept; each start deletes the
  account's stale ones. Rows are tiny.

`QrCanvas`/`QrScanStep` moved from `PairingScreen.tsx` to
`components/Qr.tsx`, unchanged, so both features share the scanner fixes
from docs/25 (D136/D137).

## D256 — One Household screen

`/settings/household` (`HouseholdScreen.tsx`). Each person gets a card:
a name you can rename in place, their devices ("seen 3 days ago" or
"this device"), Remove on other devices, and "Remove Ana". Below the
cards: + Add a person, + Add a device to this account, and a Removed list
with Restore. Removing needs a connection, so those buttons are disabled
offline.

Settings now has one **Household** row ("2 people · 3 devices") in place
of the Profiles link and the devices list. Signed out, the old read-only
"Household" members list stays, for a household formed only through P2P
pairing. `/settings/profiles` redirects here; `ProfilesScreen.tsx` is
gone. docs/25's "+ Connect a device" (P2P) is unchanged. The Household
screen's hint explains the difference.

**Not built: renaming or moving someone else's device.** A device
rewrites its own row from its local label and identity on every connect
(`touchDevice()`), so a remote edit would be silently undone. Rename a
device on the device itself (Settings → This device's name). Making it
work would mean letting a device adopt a label or profile changed
elsewhere. Separate decision, not taken here.

## Verified

- API, throwaway PGlite loaded with `main`'s `schema.sql`, so the api
  applied the new migration itself at startup (23/23). Start needs auth;
  the expiry is about 5 minutes; a new start retires the older code; a
  web claim gives a session for the right account plus email, sets the
  httpOnly cookie with no token in the body, and creates the scanning
  device's refresh chain; codes are single use; unknown and expired codes
  are rejected; a native-origin claim returns the token in the body with
  no cookie; only hashes are stored. Revoke needs auth and validates the
  id; another account's revoke doesn't touch this account's device; a
  revoked device's next refresh is a 401; other devices are unaffected.
  Upload applies a device DELETE plus a profile `deleted_at` PATCH; the
  snapshot omits the removed person; restore clears it.
- The updated `schema.sql` loads on an empty database with the migration
  recorded.
- App: `tsc -p tsconfig.app.json`, oxlint (no new warnings), 127/127
  unit tests, `vite build`.
- Not done: looking at the screens in a browser, a real two-device QR
  scan, or a run through the real PowerSync Service.

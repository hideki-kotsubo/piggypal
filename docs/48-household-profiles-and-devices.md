# 48 — Household Profiles & Devices

## What this closes

Three real gaps found running an actual two-person household through the
app (2026-08-29/30, `docs/00-backlog`'s "Household display" fix and the
conversation around it):

1. `docs/46` D165/D166's own-device-vs-someone-else sign-in fork only
   ever supports **one** "someone else" per account. A second device
   from that *same* household member (the wife's second phone, say)
   would mint a brand-new anonymous identity with no way to say "this is
   the same person as before" — showing up as a second, indistinguishable
   "Household member" ghost rather than a second device belonging to
   someone already known.
2. Household display (`household.ts`) has no real name to show for
   anyone who didn't arrive via `docs/25`'s P2P pairing (which exchanges
   a real device label over the handshake) — every magic-link-sign-in
   household member is stuck showing as the generic "Household member"
   forever, on every other device, with no way to rename them.
3. Devices are visible only to themselves. `peers.ts` (P2P) and
   Settings' own device-name field are both local-only — no device can
   see the full list of devices across the household, which was asked
   for directly ("each household person can have more than one device...
   know every device from every user").

This doc is the design. **Nothing below is implemented yet.** Same
standing constraints as `docs/39`/`docs/45`/`docs/46`: no test runner in
this repo, and the schema changes here are real migrations against
production data the user applies directly — this sandbox can't reach it.

## Recap of today's model, and exactly where it runs out

- One login/email = the whole account. That's staying exactly as-is —
  "1 household, 1 subscription" was explicit in the ask, and nothing
  here touches billing (`docs/06`, still unbuilt) or turns this into
  multiple logins.
- `identity.ts`'s `getLocalUserId()` conflates two different things into
  one id: *which person*, and *which device*. An "own device" sign-in
  (`docs/46` D165) unifies to the account's one canonical id
  (`users.id`, which is itself literally the first device's own
  `getLocalUserId()` from signup — `db/schema.sql`'s own comment on
  `users.id` says as much). A "someone else" sign-in mints a **new,
  permanent, per-device** id with no concept of "the same someone-else
  as last time."
- `household.ts`'s `useHouseholdPeers()` (the just-shipped fix) has no
  real registry to consult, so it infers household membership by
  scanning `paid_by_user_id`/`created_by_user_id`/`owner_user_id`
  observed in synced data. That's a reasonable *fallback*, but it's why
  every such id is stuck with a generic "Household member" label, and
  why a second device from the same person can't be recognized as such
  — there's nothing recording "these two ids are the same person" at
  all, because there's no such thing as "a person" in the data model
  today, only per-device ids.

## D175 — Profiles: a real person-level identity, reusing today's ids

A new table, one row per real person in the household:

```sql
create table profiles (
  id           uuid primary key,
  user_id      uuid not null references users(id),
  display_name text not null,
  created_at   timestamptz not null default now()
);
```

The key simplification: **`profiles.id` is not a new identity space.**
It's exactly the same uuid `getLocalUserId()` already produces and
already stamps into `paid_by_user_id`/`created_by_user_id`/
`owner_user_id` today. The account owner's profile row uses `users.id`
itself (already established as "the first device's own id," per
`db/schema.sql`'s comment). A household member added via today's
"someone else" fork already has a stable id sitting in production data
right now — this table just gives that id a real, named, synced row for
the first time. **No existing `transactions`/`accounts` row needs to be
rewritten** — this is additive, not a data migration of those tables.

Synced like every other small reference table (`sync-config.yaml`):

```yaml
profiles:
  auto_subscribe: true
  query: SELECT * FROM profiles WHERE user_id = auth.user_id()
```

`schema.ts` (local) gets a matching `profiles` table (`id`,
`display_name`) so any device can resolve a `paid_by_user_id` it sees to
a real name without needing a peer handshake at all — this directly
replaces the generic "Household member" fallback with the profile's
real `display_name` wherever one exists. `household.ts`'s
`personLabel()`/`householdMembers()` start reading from
`store.profiles` first, falling back to today's peers.ts-derived generic
label only for the (should become rare) case of an id with no profile
row — e.g. data from before this shipped, until backfilled.

`api/src/sync/routes.ts`'s `TABLE_COLUMNS` gets a `profiles: ['display_name']`
entry, same upsert/PATCH machinery every other table already has — no new
endpoint needed for a device to create or rename a profile.

## D176 — Devices: a real, synced per-device registry

```sql
create table devices (
  id           uuid primary key,  -- identity.ts's existing getDeviceId()
  user_id      uuid not null references users(id),
  profile_id   uuid not null references profiles(id),
  label        text not null,
  last_seen_at timestamptz not null default now(),
  created_at   timestamptz not null default now()
);
```

`id` reuses `identity.ts`'s existing `getDeviceId()` — already generated
on every device today for refresh-token tracking (`docs/05` D12/D13),
never repurposed for identity, just newly also used as this table's key.
Settings' existing "This device's name" field (`settings.ts`'s
`deviceLabel`, local-only today) becomes what a device upserts into its
own `devices.label` row — the input stays exactly where it is, it just
also writes here now. `last_seen_at` bumps opportunistically (e.g. on
every successful `connectSync()`) — purely informational, matching the
user's explicit "just let me see the list, no notification needed."

Same synced-small-table treatment as profiles: a `sync-config.yaml`
stream (`SELECT * FROM devices WHERE user_id = auth.user_id()`), a local
`schema.ts` table, and a `TABLE_COLUMNS` entry
(`devices: ['profile_id', 'label', 'last_seen_at']`) reusing the generic
upload endpoint.

## D177 — Sign-in fork becomes "pick your profile," not a fixed binary

Today's `household-fork` step (`AuthVerifyScreen.tsx`) offers exactly two
buttons. It generalizes into a single-select list, fetched alongside the
rest of `fetchServerSnapshot()`'s response (extended to include
`profiles`):

- One option per **existing** profile: *"This is [display name]'s
  device"* — picking one calls the same `setLocalUserId()` mechanism
  today's "own device" branch already uses, just generalized to target
  whichever profile was picked, not only the account's canonical one.
  This is what makes a household member's *second* device work
  correctly: picking their existing profile joins it, instead of always
  minting a new one.
- One final option, **"Someone new"** — prompts for a name inline,
  creates a fresh `profiles` row (`crypto.randomUUID()` + the typed
  name), adopts it the same way.
- The discard option (`discardAndAdoptAccountId`, `docs/05` D14) is
  unchanged.

`docs/46` D168's "account matching only runs for my own device" rule
generalizes the same way: the merge cascade (`matchAccounts`) runs
whenever the **picked profile is the same profile this device already
locally believed it was** *and* has pre-existing local data worth
reconciling — "own device" was always just the special case of
"returning to a profile with existing local history," not a distinct
concept. Picking a *different* profile than this device's own prior
local identity (a fresh device, or someone else's device) never runs
account matching, same as today's "someone else" branch.

`docs/46` D166's "remembered per device, don't ask again" behavior
generalizes from a bare `own`/`someone-else` enum
(`identity.ts`'s `getDeviceRole()`) to remembering the actual **chosen
profile id** — a repeat sign-in on the same device skips straight past
this step entirely, same UX, just keyed on which profile rather than
which of two buttons.

## D178 — QR device linking, supplementing magic-link email

Confirmed direction: QR is a faster path once at least one device is
already signed in, not a replacement for email (a brand-new household
with zero connected devices still needs the email flow to get started
at all).

Flow:

1. An already-signed-in device requests a short-lived, single-use code:
   `POST /api/auth/device-link/start` (authenticated). A new small table
   (`device_link_codes: code, user_id, expires_at, claimed_at`) tracks
   it — a handful of minutes' expiry, same single-use spirit as the
   magic-link token itself. Rendered as a QR (reusing the `qr-scanner`
   component already integrated for `docs/25`'s P2P pairing).
2. The new device scans it (same scanning component) and calls
   `POST /api/auth/device-link/claim` — deliberately **unauthenticated**,
   since this device has no session yet; the code itself is the
   credential. Server validates it's unclaimed and unexpired, mints a
   real access token + refresh-token cookie for `user_id` (the same
   primitive `/api/auth/verify` already uses), marks the code claimed.
3. From there the new device runs through D177's profile picker exactly
   like the magic-link path does — scanning a code still doesn't say
   *whose* device this is.
4. Security note, flagged plainly: a QR code is visible to anyone who
   can see the screen, unlike an emailed link. Mitigated by the code
   being short-lived, single-use, and only ever generatable by a device
   that's already authenticated — a stranger can't produce their own
   code without already having your account's access.

UI note: this needs a clearly distinct entry point from `docs/25`'s
existing "+ Connect a device" (P2P, serverless, works fully offline,
available even signed-out). Both will live in Settings; exact copy/
layout to distinguish "sync directly with a nearby device" (P2P) from
"add a device to my account" (this) is a build-time detail, not decided
here.

## D179 — A real devices list, grouped by profile

Settings gets a new section — separate from the existing "Paired
devices" list (which stays exactly as-is; that one's P2P-specific,
sourced from `peers.ts`, and keeps meaning "devices I've directly
synced with over WebRTC") — sourced from the new synced `devices` table
joined against `profiles`, grouped by person: every device across the
whole household, visible from any one of them. Directly answers "know
every device from every user"; explicitly not a notification of any
kind, per the user's own clarification.

## Migration notes for the real, already-running account

This account already has exactly two real ids sitting in production
data after the recent cleanup (`docs/00-backlog`'s household-display
fix + the manual test-data cleanup that followed it): the account
owner's id and one real household-member id. Backfill is exactly two
inserts, no rewrite of any existing `transactions`/`accounts` row:

```sql
insert into profiles (id, user_id, display_name) values
  ('<owner's users.id>',      '<users.id>', 'Hideki'),
  ('<the wife's observed id>', '<users.id>', '<her name>');
```

Both ids are already known from earlier investigation in this
conversation (the account owner's `users.id`, and the one real
non-seed-debris owner id confirmed against production Postgres). Exact
values to use are a build-time lookup against current production state,
not fixed here.

## Not in scope, still open

- Billing/subscription seats (`docs/06`) — explicitly unaffected; this
  stays "1 login, shared benefits," full stop.
- The full `docs/24` `households`/`household_members` design (separate
  logins per person, `household_id` as the sync partition key) —
  deliberately not what this does. Profiles live *under* one shared
  account, not beside it.
- Renaming/removing a profile, or handling what happens to a profile's
  data if a household member leaves — not asked for, not designed here.
- Exact QR payload format and the new `device_link_codes` table's
  cleanup/expiry sweep — implementation detail, not decided here.
- Implementation and end-to-end verification of all of the above — this
  doc is the design; next step is building it, pending review.

**2026-08-30.**

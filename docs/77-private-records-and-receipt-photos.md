# 77 — Private records and receipt photos

Two feature requests from the user, 2026-10-26. **Part A is built**
(D293–D301, below). **Part B is a design draft**: its R-D numbers are
proposals that become decisions only after the user confirms them.

---

## Part A — Private records ("don't share with the household")

### The ask

In a household, a person can log an expense or income and tick "Private".
That record syncs to all of **their own** devices and to nobody else in
the household.

### Why this is more than a column

docs/48's model is "1 login, shared benefits": the whole household is one
`users.id`, and every PowerSync stream filters on `auth.user_id()`
(`deploy/powersync/sync-config.yaml`). So today every device in the
household downloads every row. A person exists only as a `profiles` row,
and a device belongs to a person through `devices.profile_id`.

If we only add a flag and hide flagged rows in the UI, the row still
lands in the spouse's SQLite and can be read from an export, a P2P sync,
or a debugger. That isn't privacy. The filtering has to happen at
**download time**, on the server.

### Built (2026-10-26, branch `feat/private-records`)

The user's calls: build the PIN together with the feature, private rows
count only in their owner's own view, any account allowed (with a note),
label "Only me". The proposals P-D1–P-D8 became D293–D301.

- **D293 — column.** `transactions.private_to_profile_id uuid`: null =
  shared, set = only that person's devices get the row. Always the row's
  creator (`created_by_user_id`), never the payer. Migration
  `2026-10-26-private-records.sql`.
- **D294 — verified profile per device, server-side.** The client-written
  `devices.profile_id` can't decide whose private rows a device gets (any
  device can upload any value). New server-only table `device_profiles
  (user_id, device_id, profile_id)`, set by `POST
  /api/auth/session-profile` after the sign-in profile picker. The device
  proves itself with its refresh token, the same way delete-account does.
  Every new sign-in (`issueSession`) clears it, and so do device revoke
  and a PIN change from another device.
- **D295 — `profile_id` claim.** Access and PowerSync tokens carry the
  device's verified profile. `powersync-token` copies it from the access
  token, so a device that lost verification keeps it for at most one
  access-token lifetime plus one PowerSync-token lifetime.
- **D296 — two streams per table.** `transactions` (shared, `IS NULL`) +
  `private_transactions` (`= auth.parameter('profile_id')`), and the same
  for `transaction_splits`, instead of one `OR`, so nothing depends on how
  a missing claim compares to NULL. Checked with
  `@powersync/service-sync-rules` 0.44: the config compiles with no
  errors; a shared row lands only in `transactions|0[user]`, a private one
  only in `private_transactions|0[profile,user]`; a token without the
  claim gets no private bucket. **Confirmed on the dev PowerSync Service
  (2026-10-26):** private rows sit only in the owner's
  `3#private_transactions` bucket, a row toggled private → shared →
  private got matching REMOVE/PUT ops in both buckets, and the other
  household member's device dropped the rows once it synced. The first
  test leaked only because PowerSync was still on the old config: it loads
  `sync-config.yaml` at start, so a release must restart it right after
  the api (whose migration adds the column the streams read).
- **D297 — split legs.** `transaction_splits.private_to_profile_id` is a
  copy of the transaction's value, recomputed by the upload handler at
  the end of every batch, never written by the client.
- **D298 — upload rules** (`privateGuard`, `api/src/sync/routes.ts`): a
  row (or split leg) private to someone else can't be changed or deleted;
  only the creator can make a row private, only to themselves, and only
  once their profile has a PIN. A device not verified yet gets **409
  `profile_not_verified`** for the whole batch instead of a skip, because
  a skipped PUT would be dropped from the device for good. The app retries
  after it is verified.
- **D299 — profile PIN** (was P-D8). 4–6 digits, scrypt with a salt, in
  server-only `profile_pins`; `profiles.has_pin` is set by the api only
  and synced down, so every device knows when picking a person needs a PIN.
  5 wrong PINs lock that profile for 15 minutes. `POST
  /api/auth/profile-pin` sets or changes the PIN of the profile the device
  is verified as. Being verified is the proof, so the old PIN isn't asked
  for. Setting a PIN drops every *other* device verified as that profile,
  so a device that picked it before it had a PIN has to enter the PIN.
  The "Only me" toggle needs a PIN.
- **D300 — forgotten PIN (superseded by D302–D304, same day).** First
  built as a reset that removed the PIN and hard-deleted that person's
  private rows. Replaced before release: it let anyone in the household
  destroy someone's records, and the user preferred recovery over erasure.
- **D301 — P2P (docs/25).** Private rows and their legs are left out of
  both directions of a "someone else" sync; own-device sync keeps them.
- **D302 — the owner's forgotten PIN: emailed code.** For the case the user
  raised: the owner, now alone in the household on one device. `POST
  /api/auth/profile-pin/email-code` mails a 6-digit code to the account
  email (`profile_pins.reset_code_*`, hashed, 15 minutes, 5 tries, a new
  code replaces the old one); `POST /api/auth/profile-pin/email-reset`
  takes the code + a new PIN, verifies the calling device as the owner and
  drops the owner's other devices. A code, not a link, for docs/56 D204's
  reason (a tapped link opens Safari, not the installed app). Owner only:
  the inbox proves the owner, nobody else.
- **D303 — reset by another household member.** The user's call: this is
  not high-security storage, so someone without another device can ask a
  household member. `POST /api/auth/profile-pin/reset {profileId, pin}`
  from a device verified as a *different*, not removed person, for a
  person who has a PIN. Sets the new PIN and drops all of the target's
  devices; nothing is erased. The acting device stays its own person, so
  it never downloads the target's rows. **Accepted, recorded:** whoever
  resets someone's PIN knows the new one and can enter it on a device to
  read that person's Only me records; the target finds out afterwards, by
  name (D304). Also clears a pending emailed code.
- **D304 — the reset notice.** Every reset except a person changing their
  own PIN on their own verified device writes `profiles.pin_reset_at /
  pin_reset_by / pin_reset_device` (api only, synced). All of that
  person's devices show it — Home banner, their Household card, above the
  PIN prompt — as "Your PIN was reset by Bob on Bob's iMac (date)" or
  "…with a code from the account email, on New phone (date)", until "Got
  it" (`POST /api/auth/profile-pin/notice/dismiss`, from a device verified
  as them) clears it everywhere. If the target is the owner, the account
  email gets the same notice. No push notifications (docs/57 D214 still
  stands); that would be its own item.
- Plus the user's point 2: the PIN prompt and the set-PIN screen say how
  to change a forgotten PIN on another device that's already you.

App side: "Only me" checkbox on the edit screen, shown to the creator
when there's a household (or the row is already private), with a note
when the account isn't the creator's own. Lock mark on list rows. Insights'
budget bars say "includes N Only me records" (to the owner only; nobody
else has those rows). Settings → Household → PIN (`PinScreen`), PIN step
in the sign-in picker (`PinPrompt`), Home banner when this device's
person needs to enter their PIN. The verified profile is remembered on
the device (`flowtab:verified-profile`) so the toggle works offline; the
server re-checks every upload. Strings in all 10 locales (fr-CA says
"NIP"); translations are mine and need native review like docs/73/76.

Recovery (D302–D304) verified: api 79/79 (the 55 below plus member reset,
notice, dismiss, emailed code incl. single use and the 5-try limit)
against a throwaway database on the dev Postgres, with emails logged, not
sent; headless Chromium for the PIN prompt hint, Forgot options and the
owner's email-code reset end to end. Not yet in a browser: the Home
banner, the Household notice and "Reset PIN" link (they need synced
profiles, so a dev PowerSync test).

Verified: api 55/55 against a throwaway PGlite (migration applied on top
of `main`'s schema), app tsc + 246 unit tests (locale parity included),
and a headless-Chromium run of the whole flow (sign up, add a person, PIN,
toggle, list lock, second device picking a PIN profile with a wrong then
right PIN), then the user's own test on dev with the real PowerSync
Service and two people's devices. Not yet: a phone.

Still true from the design:
- Private from household members, not from the server: Postgres stores
  these rows in plain text like everything else (privacy policy updated).
- Removing a person (docs/71) leaves their private rows visible to nobody;
  restoring them brings the rows back. Owner account deletion (docs/72)
  erases them with everything else.
- Turning "Only me" off is a normal edit; the row reaches everyone at their
  next sync. Turning it on removes it from the others' devices at their
  next sync, but what they already saw or exported stays with them.
- Phase 2, not built: private scheduled payments.

---

## Part B — Receipt photos

### The ask

Attach one or more photos of a receipt to a transaction.

### Proposed design

- **R-D1: storage is not Postgres.** Images go to object storage.
  Proposal: Azure Blob Storage, which fits the stack. An S3-compatible
  MinIO on the production server is the self-hosted alternative. Postgres
  holds only metadata.
- **R-D2: table.** `transaction_attachments (id, user_id, transaction_id,
  private_to_profile_id, mime, bytes, width, height, storage_key,
  local_status, created_at, updated_at, deleted_at)`. It syncs through
  PowerSync like any other table. The image bytes do not.
- **R-D3: bytes flow.** Use PowerSync's attachments helper (the
  `@powersync/attachments` pattern: a local queue, upload/download
  through our api, local files). Check that it works with the **beta**
  `@powersync/capacitor` SDK and on web OPFS before committing to it. If
  it doesn't, a small hand-rolled queue that follows the same pattern is
  fine. The api gives out short-lived signed upload/download URLs after
  checking ownership. The server never proxies large bodies.
- **R-D4: capture.** `@capacitor/camera` on iOS/Android (camera or
  gallery). `<input type="file" accept="image/*" capture>` on the web/PWA.
  The camera permission strings already exist (docs/62).
- **R-D5: compress on the device.** Long edge ~1600px, JPEG/WebP ~0.7,
  aiming for 150–400 KB. Remove EXIF location data unless we choose to
  keep it.
- **R-D6: local-first.** The photo is saved locally first and works fully
  offline. Uploading is background work, like everything else (locked
  decision 1).
- **R-D7: download policy.** Other devices download thumbnails eagerly
  and full images on demand, so the local storage of a 2-year history
  doesn't grow without limit. Add an optional "Free up space" option to
  Settings later.
- **R-D8: tiers.** Free tier: photos stay on the device only (they never
  sync, same as all its data). Paid: photos sync. A per-account storage
  quota is enforced in the signed-URL endpoint, which is the subscription
  gate's natural home (locked decision 5 lists only three gate points, so
  **adding a fourth is a flagged change to that decision**).
- **R-D9: privacy and deletion.** An attachment inherits its
  transaction's `private_to_profile_id` (Part A, D293). Account deletion
  (docs/72) must also delete the blobs. Soft-deleted transactions'
  attachments get purged by a job after N days. Update the privacy policy
  and the App Store / Play Data-safety answers (photos are user content
  stored on our servers).
- **R-D10: CSV export (docs/08)** gets an "attachments" column with a
  count only. Bundling a ZIP with the images comes later.

### Answers from the user (2026-10-26)

1. **Storage:** not decided yet (Azure Blob vs self-hosted MinIO on the
   production server). This blocks phase 2 only.
2. **Several photos per transaction: yes.** The UI shows a strip of
   thumbnails with "+ Add photo", and each attachment row keeps a
   `sort_order`.
3. **Quota for paid accounts:** not decided yet. Also blocks phase 2
   only.
4. **Receipt OCR / auto-fill: wanted.** Its own phase (R-D11 below).
5. Receipts on scheduled payments' posted occurrences: these are normal
   transactions, so this works with no extra work.

### R-D11 — Receipt auto-fill (OCR), proposed

From a receipt photo, suggest amount, currency, date, merchant and
category, and show them in the same preview-then-Save confirmation as
typed/voice entry (docs/22). Nothing is ever written without the user
confirming. Two possible paths:

- **On-device text recognition** (Apple Vision / Google ML Kit through a
  Capacitor plugin), with the text then fed to the existing Tier 1
  `parser.ts`. It's free, offline, and available to every tier. Receipts
  are noisy, so expect weaker results, especially for totals vs
  subtotals. Not available on the plain web/PWA.
- **Claude vision through Tier 2** (`/api/parse`, docs/04, still
  unbuilt). Much better at picking the real total, the merchant and
  foreign-language receipts. It needs paid tier, is online only, and
  would be the first real piece of Tier 2. Cost per call to be checked.

Proposal: build the Tier 2 path first (it fits locked decision 4: the
free tier stays on-device and the paid tier uses the LLM), and maybe add
on-device recognition later as the free fallback. Not decided.

---

## Suggested order

1. Part A (with the PIN): built 2026-10-26.
2. Part B phase 1: local-only photos (free tier works, no server).
3. Part B phase 2: blob storage + sync + quota (after storage and quota
   are decided).
4. Part B phase 3: receipt auto-fill (R-D11).

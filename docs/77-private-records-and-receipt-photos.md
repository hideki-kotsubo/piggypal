# 77 — Private records and receipt photos

Two feature requests from the user, 2026-10-26. **Design draft for
discussion. Nothing decided or built.** The D-numbers below are proposals
(next free number after docs/76's D292). They become decisions only after
the user confirms them.

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

### Proposed design

- **P-D1: column.** `transactions.private_to_profile_id uuid null`.
  NULL means shared (today's behaviour). When it is set, only that
  profile's devices receive the row. This is better than a boolean because
  the server can filter on it directly, and "private to whom" stays
  unambiguous after the payer changes.
- **P-D2: profile in the token.** `GET /api/auth/powersync-token` already
  knows the caller's device (refresh token → `devices` row →
  `profile_id`). Add a `profile_id` claim to the PowerSync JWT. Never
  take it from the client.
- **P-D3: sync streams.** The `transactions` stream becomes:
  `WHERE user_id = auth.user_id() AND (private_to_profile_id IS NULL OR
  private_to_profile_id = auth.parameter('profile_id'))`. (The exact
  syntax for a custom JWT claim in edition-3 streams needs checking.)
  `transaction_splits` needs the same filter. It has no profile column of
  its own, so either denormalize the column onto it or use a subquery
  stream. Spike this first.
- **P-D4: upload guard.** `/api/sync/upload` rejects a write to a private
  row from another profile's device. A device can only set
  `private_to_profile_id` to its own profile.
- **P-D5: P2P sync (docs/25).** `applyPeerDataset` / the outgoing
  dataset must leave out private rows when syncing with a
  "someone-else" peer. Own-device pairing still includes them.
- **P-D6: flipping private → shared** is a normal PATCH; the row then
  appears for everyone. **Shared → private** also works going forward,
  but other devices that already downloaded it keep a copy until
  PowerSync removes it from their bucket. PowerSync does remove rows
  that leave a stream, so this should converge, but it needs a test
  against a real service.
- **P-D7: UI.** A "Private" toggle (lock icon) on the transaction edit
  screen. It shows only when `hasHousehold()` is true. A small lock on
  list rows for your own private records. No parser keyword in v1.

### Questions for the user

1. **Totals and budgets.** A private expense in a shared category: should
   it count toward the household's budget? Other members can't see it,
   so either their "spent" number is lower than yours (two truths), or
   private rows are left out of shared budgets for everyone. Proposal:
   private rows count only in **your own** view. The budget screen says
   "includes N private items" only to you.
2. **Shared accounts.** A private expense on a joint account (owned by
   someone else, or shared) makes that account's balance differ between
   members. Allow it, warn, or limit private records to accounts you
   own? Proposal: allow it, and add a one-line note under the toggle.
3. **Scheduled payments (docs/57).** Should a whole schedule be private
   too, with its posted transactions inheriting the flag? Proposal: yes,
   but in phase 2.
4. **Wording.** "Private" vs "Only me" vs "Don't share". Translations go
   into all 10 locales.
5. **Single-person accounts.** With no household the toggle is hidden.
   If someone joins later, nothing earlier becomes private on its own.
   Confirm.

### Caveats to state honestly

- This is privacy *from household members*, not from the server.
  Postgres still stores the row in plain text, as it does today. The
  privacy policy and the toggle's help text should say so.
- A household member who is the account **owner** can delete the account
  (docs/72), and that deletes private rows too. Acceptable, but worth
  knowing.
- Free tier without sign-in: there's only one person per device, so this
  only matters for P2P (P-D5).

### The profile-picker gap, and P-D8 (profile PIN)

Found 2026-10-26 while answering "can any household member save private
records?". Yes: any profile with a device can, and a record is private to
its **creator** (`created_by_user_id`), not its payer. But profiles have
no secret of their own. When a new device signs in (magic link, code or
QR link, docs/48 D177/D178), it shows the profile picker, and nothing
checks that the person tapping "This is [name]'s device" is that person.
A household member could sign in a spare device as your profile and
download your private rows. P-D2 trusts the chosen profile, so it can't
stop this.

Options considered:

1. Leave it. "Private" then means "hidden from others by default", and
   the help text has to say so.
2. **Per-profile PIN (chosen by the user, 2026-10-26, not scheduled
   yet).** Each person can set a 4–6 digit PIN, stored hashed on the
   server. Choosing a profile that has a PIN requires entering it. The
   api adds `profile_id` to a device's PowerSync token only after the PIN
   was verified for that device. The Private toggle requires a PIN.
   Wrong-attempt limit like docs/56 D204's codes.
3. A separate login per person. Real security, but it reopens docs/48's
   "1 login, shared benefits" and is much bigger than this feature.

**Open:** P-D8 is in the backlog, not scheduled. If Part A ships before
it, Part A has option 1's meaning, and the toggle's help text must say
so. The other choice is to hold Part A until P-D8 is built. To decide
before building Part A.

Other answers from the same discussion:
- A person added before they have a device (docs/71 D254) can't have
  private records until they have one.
- Removing a person (docs/71 soft delete) leaves their private rows
  visible to nobody. Restoring the person brings them back, and owner
  account deletion (docs/72) erases them.
- A household-wide "turn private records off" switch for the owner: not
  planned.

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
  transaction's `private_to_profile_id` (Part A). Account deletion
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

1. Part A first. It's smaller, has no new infrastructure, and Part B's
   privacy depends on it (R-D9).
   Spike: a custom JWT claim in edition-3 streams + filtering
   `transaction_splits`.
2. Part B phase 1: local-only photos (free tier works, no server).
3. Part B phase 2: blob storage + sync + quota (after storage and quota
   are decided).
4. Part B phase 3: receipt auto-fill (R-D11).
5. P-D8 profile PIN: in the backlog, not scheduled. See the open
   question in Part A about shipping Part A before it.

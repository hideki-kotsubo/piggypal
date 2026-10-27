# 78 — End-to-end encryption

Question from the user, 2026-10-26: can synced data be stored so that
nobody, including us, can read it from the database, while still syncing
all of a user's devices? **Design draft for discussion. Nothing decided or
built.** The E-D numbers below are proposals (docs/77 uses the same
style). They become D-numbers only after the user confirms them.

---

## The ask

Synced user data (transactions, accounts, categories, budgets,
scheduled payments, receipt photos) is stored on the server so that
reading the database, a backup or a dump shows nothing readable. Sync
across a person's devices and across a household keeps working.

## Short answer

Yes. It's called end-to-end encryption (E2EE): devices encrypt before
upload, the server stores and relays ciphertext, and the keys exist only
on devices. The hard parts are key management and querying locally, not
the encryption itself.

## Why the half-measures don't fit

1. **Encryption at rest** (encrypted disk / managed Postgres storage)
   protects only against a stolen disk. Anyone with database access still
   reads everything. Worth having anyway, but it doesn't answer the ask.
2. **Server-side application encryption** (the api encrypts with a key in
   Azure Key Vault) protects dumps and backups, but the operator can
   still decrypt. It also doesn't fit locked decision 2. PowerSync
   Service reads Postgres directly and streams rows to devices, and the
   api isn't in the download path. Devices would receive ciphertext they
   can't read unless they hold the key, which is E2EE anyway.

So for Flowtab the real choice is E2EE or disk encryption only.

## Proposed design

### Data

- **E-D1: field-level encryption, not whole-row blobs.** Columns that
  the server and sync streams need stay plaintext: `id`, `user_id`,
  `created_by_user_id`, `private_to_profile_id` (docs/77), foreign keys
  (`account_id`, `category_id`, `transaction_id`), `created_at`,
  `updated_at`, `deleted_at`. Content columns become ciphertext:
  amount, currency, date, description, merchant, notes, category and
  account names, budget amounts, schedule rules, `category_keywords`.
  Field-level keeps docs/43's column-level PATCH (two devices editing
  different fields of one row still merge), which a whole-row blob would
  break.
- **E-D2: format.** AES-256-GCM through WebCrypto, a fresh random nonce
  per value, stored as one versioned string
  (`v1.<key id>.<nonce>.<ciphertext>`). The AAD binds each value to
  `table + column + row id`, so the server can't swap ciphertexts
  between rows or fields without detection. Encrypted columns in
  Postgres become `text`. This changes locked decision 6's "money =
  integer cents" **on the server only**: locally, amounts stay integer
  cents. Flagged.
- **E-D3: server validation moves to the client.** `/api/sync/upload`
  can still check ownership, ids, timestamps and the gate (locked
  decisions 3 and 5). It can no longer check amounts or text. A broken
  client could upload garbage. Only the user's own data is affected,
  but the app must cope with a value that won't decrypt (show it as
  unreadable and never crash).
- **E-D4: receipt photos (docs/77 Part B)** get encrypted on the device
  before upload with a per-file key, and that key is stored encrypted in
  the attachment row. The blob store only ever holds ciphertext. This
  is the easiest piece, because the bytes never need to be queried.

### Local storage (the biggest cost)

PowerSync writes downloaded rows straight into local SQLite. With E2EE
those rows arrive as ciphertext, but every screen needs plaintext for
totals, search, filters and charts. The app also writes plaintext rows
locally (locked decision 1), so one table can't hold both.

- **E-D5: two layers locally.** Synced tables hold ciphertext exactly as
  the server has it. Plaintext tables (today's schema) are what the UI
  reads and writes. Two paths connect them:
  - **Upload:** `connector.ts`'s `uploadData` already reads each local
    transaction's CRUD ops. It encrypts the content fields there, just
    before the POST. That part is small.
  - **Download:** after each sync, decrypt changed rows into the
    plaintext tables. SQL triggers can't call WebCrypto, so this has to
    be a JS pass driven by PowerSync's change notifications.
  **Spike first.** Check whether PowerSync's raw-tables feature, or a
  JS-registered SQLite function, can decrypt while rows are applied,
  which would avoid a second copy. If not, the two-layer copy is fine.
  It costs local disk space and a little sync latency.
- **E-D6: free tier and local-only mode are unaffected.** No sync means
  no encryption layer. It switches on when a device starts syncing.
- **On-device encryption is a separate question.** SQLCipher is already
  linked (docs/66) with no key set. Encrypting the local database
  protects a lost phone, not the server. Out of scope here.

### Keys

- **E-D7: one data key per household** (docs/48's `users.id`), random
  and generated on the first device that syncs. All rows are encrypted
  with it. Key ids allow rotation (E-D12).
- **E-D8: device keypairs.** Each device generates an ECDH P-256
  keypair. The private key is non-extractable: a WebCrypto `CryptoKey`
  in IndexedDB on the web, or Keychain/Keystore on native (needs a
  plugin, to check). The server stores each device's public key on its
  `devices` row, plus the household key wrapped for that device. The
  server never sees an unwrapped key.
- **E-D9: adding a device.** Magic-link, code or QR sign-in (docs/48
  D177/D178) still gives the device a session, but on its own that only
  downloads ciphertext. The device then shows "Waiting for approval",
  and any already-unlocked device of the household shows "Approve
  [device name]?". Approving wraps the household key for the new
  device's public key. Two faster paths:
  - The docs/25 / docs/28 pairing channel is already a direct encrypted
    link, so pairing can carry the wrapped key with no separate approval
    step.
  - The recovery key (E-D10).
- **E-D10: recovery key.** At setup, show a one-time recovery code
  (Bitwarden / 1Password style) and ask the user to save it. The code
  unwraps a copy of the household key stored on the server. This is the
  only way back if every device is lost. Without it, the data is gone,
  and we can't help: that's the guarantee working as intended. Later:
  passkeys with the PRF extension could wrap the key and sync through
  iCloud/Google. Platform support is uneven today.
- **E-D11: per-profile keys for private records (docs/77 Part A).** Each
  profile gets its own key, wrapped only for that profile's devices.
  Private rows are encrypted with it. This makes private records
  unreadable to other household members **and** to the server, not just
  filtered at download. It also closes docs/77's profile-picker gap
  (P-D8): a spare device signed in as your profile gets ciphertext it
  can't read until one of your devices approves it, or your recovery key
  is entered. **E2EE could replace the P-D8 PIN.** Flagged, to decide.
  (2026-10-26: P-D8 is now docs/77 D299, built together with Part A.)
- **E-D12: removing a person or device.** Removing a person (docs/71) or
  revoking a device deletes their wrapped key copies. The device may
  still hold the old key, so real revocation means rotating the
  household key: a new key, re-encrypting all rows from one unlocked
  device, and uploading. Proposal: rotate on person removal and on
  "this device was lost", and skip it for routine sign-outs (docs/75
  already erases the device).

### What the server can still see

- **Metadata:** row counts, sizes, and when rows change, which shows when
  and how often someone records things. Ids and foreign keys show the
  structure (which transactions share an account), never the content.
  Say so in the privacy policy.
- **Tier 2 AI entry (locked decision 4, docs/04).** `/api/parse` has to
  read what the user typed in order to parse it. It still fits the ask:
  per D6 the LLM returns structured data, the client inserts it, and
  nothing readable is ever stored. The api must not log utterances, and
  Anthropic sees the text in transit. D7's `category_keywords` are now
  encrypted, so the client sends the relevant keywords in the request
  body instead of the server reading them. The same applies to docs/77
  R-D11 receipt auto-fill: the photo goes to the api for that one call.
- **Email address and subscription state** stay plaintext. They're
  needed for sign-in and billing.

### Other things it touches

- **CSV export (docs/08)** is already client-side and reads local
  plaintext. No change.
- **P2P sync (docs/25)** moves local plaintext over a direct encrypted
  channel. No change.
- **Account deletion (docs/72) and D21 hard delete** get simpler: deleting
  the rows and the wrapped keys is enough, and backups only contain
  ciphertext.
- **App Review sign-in (docs/72 D258):** a reviewer signing in on a fresh
  device would hit "Waiting for approval". The review account needs a
  bypass, such as a recovery key in the review notes or a review account
  that starts empty. To decide.
- **Support:** we can no longer look at a user's data to debug it. Bugs
  have to be reproduced from client logs or a user's own export.
- **Store and policy answers.** The App Store encryption answer from
  docs/66 ("None of the algorithms", `ITSAppUsesNonExemptEncryption =
  false`) needs re-answering. Standard encryption for protecting user
  data is usually exempt, but it's no longer "none". Play Data safety
  can add "end-to-end encrypted". The privacy policy gets a section.
- **Migrating existing synced accounts:** one unlocked device encrypts
  every row and uploads it, then the server deletes the plaintext.
  Older Postgres backups still hold plaintext until they expire. Say so
  and don't claim "never stored" for data from before the migration.

## Questions for the user

1. **Go / no-go.** Is "we can't read your data" worth this cost
   (the E-D5 local layer, key approval UX, the recovery-key burden, lost
   data when keys are lost)? The other honest answer: keep plaintext,
   add disk encryption, and state plainly in the privacy policy that the
   server can read synced data.
2. **Recovery key: required or optional?** Proposal: required at setup,
   with a "Show again" option in Settings while a device is unlocked.
3. **Should E-D11 replace P-D8** (the profile PIN from docs/77)?
4. **Rotation (E-D12):** on person removal and lost devices only?
5. **Tier 2 / receipt OCR:** are "processed in transit, never stored"
   semantics acceptable for paid AI features?
6. **Migration:** automatic for all synced accounts, or opt-in first?
   Proposal: opt-in beta for one release, then automatic.

## Suggested order

1. **Spike** (no user-facing change):
   - WebCrypto AES-GCM + ECDH in the Capacitor WebView on iOS and
     Android (secure context) and on web OPFS.
   - E-D5: raw tables or a JS SQLite function vs the two-layer copy.
   - Measure the decrypt pass on a 2-year history.
2. Device keypairs + approval flow + recovery key (E-D8 to E-D10), with
   nothing encrypted yet.
3. Field encryption for all synced tables, behind a flag, plus the
   migration.
4. Per-profile keys (E-D11), together with or instead of docs/77 Part A
   + P-D8.
5. Encrypted receipt blobs (E-D4) as part of docs/77 Part B phase 2.
6. Policy, store answers, and help text.

If E2EE goes ahead, docs/77 Part A should wait for it, or at least use
the same `private_to_profile_id` column so both designs line up.

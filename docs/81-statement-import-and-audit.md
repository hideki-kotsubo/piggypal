# 81 — Statement import and audit

Status: brainstorm 2026-10-29, parked; **unparked 2026-11-07**, see
"Direction, 2026-11-07" below. Split out of the desktop
layout brainstorm (docs/80) so desktop can ship as layout only. Nothing
decided or built.

Backlog item this extends (docs/00, ⚫ Later): the statement import /
reconciliation item (2026-08-23), which already says it must be a real
reconciliation (match, mark cleared, surface rows only on one side), not
insert-with-dedupe. This doc adds the 2026-10-29 brainstorm.

Desktop is the natural home for the review screen (two lists side by
side), but per docs/80's rule the phone must be able to do it too.

## What the user wants (2026-10-29)

- **Import** statements (new transactions from a bank/card file).
- **Audit** statements against what's already logged, catching **both**
  forgotten entries **and** wrong charges.

## One feature, two modes

Import = audit with nothing to match yet. Making audit the only way in
avoids duplicates when a statement covers months partly logged by hand.

Every format is turned into one internal shape, "statement lines", before
matching, so the matching engine doesn't care about the format and each
format is a plug-in.

## Match outcomes

| Status | Meaning |
|---|---|
| Matched | same account, amount, date within a few days (post vs transaction date) |
| Divergent | matched, but amount or date differs ($45.00 logged vs $47.30 charged: tip, FX fee) |
| Only on statement | not logged; offer one-click add (lands in Inbox, uncategorized) |
| Only in Flowtab | pending, a duplicate entry, charged to another card, or a bank error |

## Wrong-charge checks (easiest → hardest)

| Check | Example | Needs |
|---|---|---|
| Amount divergence | logged $45, charged $47.30 | matching |
| Duplicate charge | same merchant + amount twice the same day | statement only |
| Unknown merchant | "SQ *XYZ" not recognised | matching |
| Refund never arrived | return logged, no credit | matching over time |
| Subscription price change | $16.49 → $18.99 | history / Schedules (docs/57) |
| Scheduled payment missed or doubled | rent charged twice | Schedules (docs/57) |
| FX fee anomaly | fee above the card's usual rate | currency + account metadata |
| Charged to the wrong card | logged Visa, appears on Mastercard | audit across accounts |

Consequences:
- Audit should be able to run **across several accounts at once**, or
  "only in Flowtab" on one card is a false alarm when it's on another.
- Each flag needs a **resolution state** (accepted / fixed / disputed /
  ignored), findable next month ("disputed, waiting on the bank").
  Probably its own table, not a column on `transactions`. A
  cleared/reconciled state on transactions is also needed (no such column
  today, per the 2026-08-23 item).

## Currency

Foreign spend is where divergences cluster: logged ¥3,000, card settles
C$27.84. Audit must treat "same transaction, different currency" as a
match. Likely just *recording* the settled amount, keeping docs/10's
never-convert rule; to be checked against docs/10 before deciding.

## Matching memory

Remember "MERCADO EXTRA 1234 SAO PAULO" → merchant "Extra", category
Groceries, so later imports categorize themselves. Same idea as
`category_keywords` (docs/16) and merchants (docs/15).

## Formats

Unknown yet: the user is checking what each bank exports. Checklist per
institution (web banking, not only the app):

- [ ] Is there an export/download on transaction history?
- [ ] Formats: CSV, OFX/QFX, QIF, PDF only?
- [ ] How far back?
- [ ] PDF: selectable text, or a scanned image?
- [ ] Card statements vs bank-account statements: same format?

CSV/OFX/QFX/QIF are easy and parse on the device. PDFs are the common
case (especially Brazil and Canada) and the hard one.

## PDF parsing — options (needs more brainstorming, user 2026-10-29)

The tension: PDFs are the most common and hardest format, and the
obvious fix (send to an LLM) cuts against private/local-first (docs/01)
and E2E (docs/78).

- **A. On-device heuristics.** pdf.js text layer, find `date …
  description … amount` lines. Private, offline, free tier. Fragile with
  odd layouts and multi-line descriptions.
- **B. User-taught templates.** On the first statement from a bank, the
  user marks the date/description/amount columns once; saved per
  institution. Templates hold layout only, no data, so they could be
  shared between users or shipped for popular banks.
- **C. LLM writes the parser, never sees the data.** Mask on the device
  (digits → 9, letters → x, layout kept), send only the skeleton; the LLM
  returns a template (patterns/column rules) the device applies to the
  real text. Same output type as B, so they combine: LLM drafts, user
  corrects.
- **D. Server LLM on the real text, opt-in.** Most robust, least
  private. If offered: paid tier, consent per import, account numbers /
  name / address stripped on the device first, nothing kept.
- **E. On-device AI.** Apple's on-device models (native), WebGPU models
  (browser). Private; platform-dependent, large browser downloads. Spike
  later.
- **F. Scans/photos.** On-device OCR (Tesseract.js, Apple Vision), then
  into A/B/C. Only if banks give image PDFs.

**Gate for all of them: reconcile against the statement's own totals**
(opening/closing balance, charge totals). If parsed lines don't add up,
the parse is wrong, and it's known before auditing. Without this a parse
error shows up as a false "wrong charge".

Leaning from the brainstorm (not decided): A + B + C as the default
path, totals check as a hard gate, D opt-in last resort, E/F later.

## Direction, 2026-11-07 (proposals, not locked)

Unparked 2026-11-07 (branch `feat/statement-import`). The user's worry:
supporting every bank's format by hand is too much work for one person,
and banks change formats without notice. Proposals I-D1 to I-D9 below
become D-numbers once the user confirms them.

- **I-D1. Paid import is LLM-assisted (option D moves up).** On the paid
  tier, the server LLM reads the statement and returns statement lines.
  No per-bank code, and a changed layout needs no fix. Option C (the LLM
  writes a template from a masked layout) is a later upgrade for cost or
  privacy, not v1.
- **I-D2. Privacy rules for paid import.** The device strips account and
  card numbers, name and address before sending. The user agrees on each
  import, not once in Settings. The api never logs the text or keeps the
  file. The privacy policy says statements are sent to Anthropic to be
  read. Same "processed in transit, never stored" rule as docs/78 for
  Tier 2.
- **I-D3. The LLM only reads.** It returns lines; matching and inserting
  happen on the device through the normal upload path (locked decision
  3). The statement-totals gate stays required and also catches made-up
  lines.
- **I-D4. New gated endpoint** (e.g. `/api/import`). ⚠️ Adds a fourth
  gate point to locked decision 5's "nowhere else" list. Depends on
  Stripe (docs/06) and the server LLM (docs/04 Tier 2), neither built
  yet.
- **I-D5. Free tier: two formats parsed on the device.**
  - **OFX/QFX.** A standard, so one parser serves every bank that exports
    it; `FITID` gives exact re-import matching, and the file carries the
    balance for the totals gate.
  - **Flowtab CSV v2**, the same format export writes (whatever you
    export, you can import back). D29's columns predate currencies,
    merchants and splits, so export and import change together (table
    below).
- **I-D6. Other apps' exports are a third kind of source.** One built-in
  adapter for the user's own former app (below); anything else goes
  through paid import (I-D1), which handles structured JSON/CSV better
  than PDFs.
- **I-D7. Importing again is safe.** Rows that carry an id (Flowtab CSV
  `id`, OFX `FITID`, the old app's `id`) keep it, so a second import of
  the same file adds only what's missing. This is what lets transfers
  arrive in a later import (I-D9).
- **I-D8. Mapping is asked once per import, then remembered.** Unknown
  category names, wallet/account names and payers go through one mapping
  step ("Grocery" → Groceries, "Adriana" → her card + payer Adriana).
  Saved for the next import from the same source.
- **I-D9. Transfers are their own design (docs/82), not two plain
  transactions.** Step 1 skips transfer rows; once docs/82 is built, the
  same file is imported again (I-D7) and only the transfers come in.

### Flowtab CSV v2 (export and import)

| Column | Notes |
|---|---|
| `id` | Optional on import; exact match on re-import |
| `date` | ISO `YYYY-MM-DD` |
| `amount` | Signed decimal, negative = expense |
| `currency` | New |
| `category` | Name; `Group › Child` for subcategories (docs/14) |
| `account` | Name |
| `merchant` | New |
| `note` | |
| `split_of` | New. Rows of one split purchase share it, one row per account leg; shared fields must be equal on every leg, or the row goes to review |

Left out on purpose: scheduled payments, budgets, household payer/owner,
private records. A full backup/restore would be its own JSON format,
probably reusing `applyPeerDataset` (docs/24/25). Not planned yet.

### Adapter: the user's former app (JSON)

The user built this app and is moving off it: about 3 years of data,
including transfers. One JSON array of records. Checked against real
samples on 2026-11-07, including a test income, a transfer and a
two-account expense.

| Field | Flowtab | Rule |
|---|---|---|
| `id` | `transactions.id` | Lowercased UUID (I-D7) |
| `when` | date + time | **UTC.** Convert to the device's time zone before taking the date: `2026-11-08T00:21:29Z` is Nov 7 in Vancouver |
| `dateCreated` | — | When it was logged; ignored |
| `what` | `note` | |
| `where` | `merchant` | Matched against known merchants (docs/15); empty → none |
| `currency` | currency | One per record; payments carry none, so every leg uses it |
| `amount` | `amount_cents` | Float; round to cents |
| `category` / `subCategory` | category | By name through the mapping step (I-D8); empty → Inbox. `subCategory` empty in every sample so far |
| `payments[]` | account(s) | `wallet` = account name; `amount` is a **string** (`"100"` and `"100.00"` both occur), parsed as exact decimal |
| `type` | kind | `1` expense, `2` income, `3` transfer |
| `amounts[]` | — | Empty in every sample. Unknown meaning: the adapter flags any record where it's non-empty instead of dropping it |

Checks per type (failures go to review, never guessed):

| `type` | Sign of `amount` | `payments` |
|---|---|---|
| 1 expense | negative | all negative, sum = `amount`. 2+ entries = account split (docs/50) |
| 2 income | positive | all positive, sum = `amount` |
| 3 transfer | positive (the amount moved) | exactly two, one negative one positive, summing to 0. Skipped until docs/82 |

Known specifics:
- Wallet `Adriana` is a person, not an account: map to payer Adriana
  (household profile, docs/71) + her own credit card account (owned by
  her). The user creates both before importing.
- Categories may be in Portuguese (`Salário/Retirada`) or typo'd
  (`Grocery` next to `Groceries`). The mapping step handles both.
- Same institution, different accounts: `Banco C6` (bank) and
  `C6 - Mastercard` (card). Not merged; the mapping step assigns
  institutions (docs/12).
- Data errors seen in the real file (Amazon.ca on a CAD card marked
  `BRL`; a R$27.30 Vivo top-up twice a minute apart) are imported as
  they are but flagged in review, using the wrong-charge checks above.
- The user's three test records from 2026-11-08 ("test" at 101 Boba,
  the $100 Savings → Checking transfer, "Job ABC") should be deleted
  in the old app before exporting the real file, or left unchecked in
  review.

### Order of work

| Step | What | Where |
|---|---|---|
| 1 | Engine: statement lines → matching → review → insert, plus the former-app adapter. Transfers skipped | this doc |
| 2 | Transfers: model, entry UI, balances, kept out of budgets | docs/82 |
| 3 | Re-import the former-app file with transfers; then OFX; then Flowtab CSV v2 (export + import) | this doc |
| 4 | Paid LLM import (PDFs, other apps), after Stripe + server LLM | this doc |

## Open questions

1. Bank formats (checklist above) — user gathering. Less urgent since
   I-D1: only matters for what the free OFX path covers.
2. C sends layout-only data to the server: OK on the free tier, or does
   the free tier never contact the server (docs/05 D10), making C
   paid-only?
3. Templates shared between users (B): worth Flowtab hosting
   user-contributed content, or per-user only?
4. Audit scope: one account per audit, or "this month across all
   accounts" as the main mode?
5. Where audit flags and resolution states live (new table?), and the
   cleared state on transactions.
6. Review UI on the phone (docs/80's same-functionality rule). docs/24's
   household-merge review UI may have reusable patterns.

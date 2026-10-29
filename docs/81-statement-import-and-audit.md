# 81 — Statement import and audit

Status: brainstorm 2026-10-29, **parked**. Split out of the desktop
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

## Open questions

1. Bank formats (checklist above) — user gathering.
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

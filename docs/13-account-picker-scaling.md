# 13 — Account Picker Scaling

## The problem

`AccountCurrencyPicker` (shared by the entry zone and the transaction edit
form) renders every account as one flat chip. That's fine at a handful of
accounts but becomes a wall once a user has real-world scale (this app's
own working assumption per CLAUDE.md is 15-20+ accounts) — confirmed by the
user's own screenshot: 18 accounts, one undifferentiated chip each.

The "grouped by institution" mockup (`docs/artifacts/piggypal-picker-grouping.html`)
was well received. This doc locks in how it actually ships: when it
engages, what the alternative "capped" mode looks like, where the choice
between them lives, and a label simplification for solo-institution
accounts.

**Scope note**: this doc covers `AccountCurrencyPicker` only (entry zone +
transaction edit form). `AccountsScreen`'s own institution grouping
(docs/12 D60/D61) is unconditional today and out of scope here — it's a
browsing/management view, not a quick-pick, and hasn't drawn the same
complaint.

## Three small decisions, not one big one

### 1. Don't show any of this below a threshold

A user with 5-6 accounts doesn't have the problem this doc solves. Below a
fixed threshold, the picker renders exactly as it does today — flat chip
row, no grouping, no capping, no settings-dependent branching. Only above
the threshold does either alternate mode engage at all.

Proposed threshold: **6** accounts (matches the user's own "say 5, 6"
example). Fixed in code, not itself user-configurable — only which mode
engages *above* it is (below).

### 2. Above the threshold: two user-selectable modes

- **Grouped by institution** — this session's artifact: institutions with
  more than one account collapse to a single row (tap to expand into their
  accounts); institutions with exactly one account render as a plain chip
  (see label rule below); accounts with no institution render as a plain
  chip using their bare name, unchanged from today.
- **Capped list** — top 6 accounts by the existing frequency ranking
  (`store.rankedAccounts()`, already sorted by transaction count — not
  recency, correcting my own loose wording earlier in chat), plus a
  "+ more" chip that reveals the rest as a flat continuation, not
  re-grouped.

Which mode is active is a **local device preference**, not synced —
the same "pure client concern" reasoning docs/09 (UI language) and docs/10
D39 (primary currency) already used for analogous settings, except this is
the first one actually getting built. New: a small `localStorage`-backed
settings module, since nothing like it exists in code yet (no
`settings`/`preferences` table, no `localStorage` usage anywhere
currently) — this isn't PowerSync-domain data and never needs to sync, so
it deliberately sits outside the SQLite/schema.ts layer entirely.

### 3. Solo-institution accounts drop the redundant name segment

When exactly one account exists under a given institution, its chip label
is the institution name alone — "Wise" instead of "Wise — Checking" —
since there's nothing to disambiguate. Applies in both the under-threshold
flat view and the grouped mode's plain chips.

- No institution set → unchanged, bare `name` ("Cash").
- Institution set, exactly one account under it → institution alone
  ("Wise").
- Institution set, 2+ accounts under it → unaffected by this rule: the
  group header shows the institution ("Neo ▸ 2"), and chips inside the
  expanded group show the bare name ("Mastercard", "Checking") — this part
  was already in the artifact.

This needs sibling-count context (how many other accounts share this
institution), which the existing pure `accountLabel(account)` helper in
`format.ts` doesn't have — it only sees one account at a time. Plan: add a
store-level helper (`store.rankedAccounts()` already gives the full list
to count against) rather than changing `accountLabel`'s signature, so
`format.ts` stays a pure function and every other caller (`AccountsScreen`,
`TransactionList`) is unaffected.

## Decisions locked in this doc

| # | Decision | Why |
|---|---|---|
| D65 | Picker complexity (grouping or capping) only engages above a fixed threshold, **6 accounts** | Most of this app's own scale assumption (15-20+) is aspirational for a new user — don't add UI surface for a problem that isn't there yet |
| D66 | Above threshold, user picks Grouped-by-institution or Capped-list via a new local-device-only setting, **defaulting to Grouped** | Two real, different mental models (browse-by-bank vs. recency-first) with no obviously-correct default for every user; local preference matches docs/09 and docs/10 D39's existing "pure client concern" reasoning; Grouped is the default since that's the mode the user confirmed they liked |
| D67 | Capped mode shows top **6** (same constant as D65, not a second number) by `rankedAccounts()`'s existing frequency ranking, plus a flat "+ more" | Reuses ranking logic that already exists rather than introducing a second ranking signal; one constant to reason about rather than two similar-but-different ones; "+ more" stays flat rather than re-grouped to keep the two modes visually distinct |
| D68 | Solo-institution accounts show institution-only labels ("Wise" not "Wise — Checking") in the picker | Nothing to disambiguate with only one account at that institution; needs sibling-count context, so lands as a new store helper rather than changing the pure `accountLabel` function |
| D69 | The Grouped/Capped setting row in Settings only appears once the user is actually above the threshold | Matches this app's existing hide-until-relevant instinct (docs/07 D23) rather than showing a control that does nothing yet |

# Backlog

Legend: 🔵 now · ⚪ next · ⚫ later/someday · 🐛 bug · ✅ done

This is a working list, not a decisions log — items here don't carry "locked"
status the way entries in docs/01's decisions table do. When an item here
turns into an actual architecture/scope decision, it graduates into the
relevant numbered doc and gets a D-number there; this file just tracks that
it needs doing.

## 🔵 Now

*(nothing blocking right now)*

## ⚪ Next

- [ ] Night mode must be user-toggleable, not just system-following —
      requested 2026-08-10. Today `tokens.css` only has a
      `@media (prefers-color-scheme: dark)` block, no explicit override —
      the app follows the OS setting with no way for the user to force
      light or dark regardless of it. Needs a three-way preference
      (System / Light / Dark, defaulting to System) exposed in Settings,
      persisted via the same `lib/settings.ts` localStorage pattern
      `useAccountPickerMode` already established (docs/13). Implementation
      likely sets a `data-theme="light"`/`"dark"` attribute on `<html>`
      when overridden, with `tokens.css` gaining `:root[data-theme="dark"]`
      / `:root[data-theme="light"]` blocks and guarding the existing media
      query with `:not([data-theme="light"])` — the same pattern this
      session's HTML artifacts (`docs/artifacts/*.html`) already use, just
      not yet applied to the real app's stylesheet.
- [ ] Institution field (AccountsScreen's AccountForm) should suggest from
      the user's existing institutions instead of being a bare text input —
      requested 2026-08-10. Behavior: on focus/tap, show every distinct
      `institution` already in use across the user's accounts (e.g. user
      has "Scotiabank — Checking", "Tangerine — Checking", "RBC —
      Checking"; adding a new "Scotiabank — Mastercard" shows all three —
      Scotiabank, Tangerine, RBC — as suggestions as soon as the field is
      focused). As the user types, narrow to institutions whose name
      *contains* the typed substring, case-insensitive, not just
      starts-with (typing "t" narrows to "Scotiabank" and "Tangerine" —
      both contain a "t" — excluding "RBC"). Likely implementation: a
      frequency- or recency-ranked chip row under the Institution input,
      same pattern already used for Kind/currency pickers elsewhere in
      this form, filtered live against `institutionStr`. Selecting a chip
      still just sets the text field (free text stays editable, this is
      suggestions not a closed enum).
- [ ] Set up a test runner (Vitest, matches Vite) — no tests exist yet.
- [ ] Decide on GitHub/Gitea setup for backlog + PR workflow (this doc is
      the interim, file-based version).

## ⚫ Later / someday

- [ ] Revisit "piggypal" naming once there's a working product to react to
      (parked 2026-08-07 — see docs/01 item 5 for full context: name space
      is saturated, piggypal's real gaps are signaling private/local-first
      and pig-imagery cultural sensitivity, not the collision itself).
- [ ] Server-backed full-history CSV export (docs/08-csv-export.md, D30) —
      for users whose local 18-month window has aged out older transactions.
- [ ] PowerSync connector wiring — sync/auth/AI pipeline/Stripe are all
      fully specified in docs/02-06 but intentionally not implemented yet
      (deliberate local-only-first build order).
- [ ] Recurring transactions — explicitly out of MVP scope (docs/01).
- [ ] Household sharing — explicitly out of MVP scope (docs/01).
- [ ] Voice input, simple version — speech-to-text feeding the existing
      on-device rule-based parser (Tier 1), no LLM involved. Voice itself is
      already listed as deferred/out of MVP in docs/01, framed there as
      "reuse same pipeline later" — this scopes a first cut to the free-tier
      Tier 1 path specifically rather than waiting on the Tier 2 AI pipeline.

## 🐛 Bugs

- [ ] Same root cause likely affects the transaction edit form's Note
      field (`TransactionList.tsx`, bound directly to `transaction.note`)
      — not yet reported by the user, but it's the identical pattern.
      Worth fixing at the same time or flagging if it turns out fine in
      practice (shorter round-trip, single table).
- [ ] Date/Time fields on the transaction edit form overflow each other on
      iOS — native `<input type="date">`/`<input type="time">` side-by-side
      layout needs a responsive fix. Untested on real iOS Safari — same
      shared `TransactionEditForm.tsx` used by both lists now, needs a
      real-device check.

## ✅ Done

- [x] Fixed a seeding race under React StrictMode's dev-mode
      double-invoke — found 2026-08-11 via a real Playwright screenshot
      pass (console showed `UNIQUE constraint failed:
      ps_data__accounts.id`; caught, never broke the UI). `store.tsx`'s
      seeding `useEffect` called `seedIfEmpty()` fire-and-forget; its
      `AbortController` only cancelled the subsequent `db.watch()` calls,
      not the seed call itself. On StrictMode's mount→cleanup→mount, two
      `seedIfEmpty()` calls ran concurrently; the emptiness check
      (`SELECT id FROM accounts LIMIT 1`) happened *outside*
      `db.writeTransaction(...)`, so both calls could see "empty" before
      either committed, and the second's insert collided on the hardcoded
      seed IDs. Fixed by moving the check inside the same
      `writeTransaction` via `tx.getAll(...)` (PowerSync's `Transaction`
      extends `LockContext`, which has `getAll` alongside `execute`), so
      the check-then-insert is atomic under SQLite's write-transaction
      locking. `tsc -b`/`oxlint` clean; re-verified with a real Playwright
      run against a fresh browser profile — zero console errors, same
      screenshot output as before the fix.
- [x] Got real browser tooling working — Playwright + Chromium installed
      globally (`npm install -g playwright`, `playwright install
      chromium`, `sudo playwright install-deps chromium` for the missing
      system libraries), plus `NODE_PATH` added to `~/.bashrc`/`~/.profile`
      so `require('playwright')` resolves without a full path in
      interactive/login shells. This is what actually caught the seeding
      race above — the first real end-to-end screenshot of the app ever
      taken in this project surfaced a bug static analysis (`tsc`/`oxlint`)
      couldn't have (2026-08-11).

- [x] Transaction list rows: dropped the always-visible "manual"/"AI"
      source label, added the paying account directly to the row (both
      `TransactionList.tsx` and `RecentList.tsx`, plus `InboxScreen.tsx`
      for consistency — same `t.source` pattern was there too), and made
      Home's Recent list tap-to-expand/editable, which it never was — the
      earlier "Transaction rows on Home aren't clickable" bug had actually
      misdiagnosed which file *is* Home; `TransactionList.tsx` is the
      separate `/transactions` screen and was already tappable,
      `RecentList.tsx` is Home and wasn't. Extracted the shared edit panel
      into `TransactionEditForm.tsx` so both lists use the exact same
      inline-edit form rather than duplicating it. `tsc -b`/`oxlint` clean;
      visually verified working by the user in a real browser 2026-08-10.
- [x] Visually verified the account/currency picker work (`e4962ab`) in a
      real browser — institution grouping/editing, currency switching, and
      the new Grouped/Capped picker scaling (docs/13). Confirmed by the
      user 2026-08-10.
- [x] Account picker (entry zone + transaction edit form) now scales past
      a handful of accounts — requested 2026-08-10 after a screenshot
      showed 18 accounts as one flat chip wall. Design locked and
      implemented per docs/13-account-picker-scaling.md (D65-D69): below
      6 accounts the picker is untouched; above it, a new local-device
      setting (Settings screen, only shown once relevant — `lib/settings.ts`,
      first `localStorage`-backed preference in this codebase) switches
      between Grouped-by-institution (institutions with 2+ accounts
      collapse to a tap-to-expand row; the one containing the current
      selection starts expanded) and Capped (top 6 by the existing
      `rankedAccounts()` frequency ranking, plus a flat "+ N more").
      Defaults to Grouped. Solo-institution accounts show the institution
      alone ("Wise" not "Wise — Checking") in both modes — kept local to
      `AccountCurrencyPicker.tsx` rather than changing the pure
      `accountLabel` helper, so `AccountsScreen`/`TransactionList` are
      unaffected. `tsc -b`/`oxlint` clean (2026-08-10, not yet visually
      verified in a browser — see chat).
- [x] Removed currency and savings goals from `accounts` entirely
      (docs/10 D62/D63, docs/11 D64, docs/12 D55/D57 superseded) — the
      "can't change currency" bug below turned out to be a symptom of
      currency not needing to live on the account at all: `balancesFor`
      already computed per-currency balances from transaction currency,
      not the account's. An account is now a payment-method identity only
      (institution, name, kind, archived); currency is chosen per
      transaction, independently, at entry time (unchanged UX via
      `AccountCurrencyPicker`, just without the auto-creation mechanism
      that used to split one card into a row per currency). Goal tracking
      moves entirely to the existing per-category `budgets` table — no
      new mechanism, just dropping the second, account-shaped one this
      app had built alongside it. Touched: types.ts, schema.ts,
      db/schema.sql, store.tsx (dropped `resolveAccountForCurrency`,
      redesigned `defaultCurrencyFor`/`rankedCurrencies` off
      `account.currency`), seed.ts, AccountCurrencyPicker.tsx (notably
      simpler — no more currency-driven account resolution), AccountsScreen.tsx
      (Currency field and goal UI removed), CategoriesScreen.tsx (budget-form
      currency options no longer read `account.currency`), home.css (dead
      goal-progress rules removed). `tsc -b`/`oxlint` clean (2026-08-10,
      not yet visually verified in a browser — see chat).
- [x] Fixed "can't change an existing account's currency" in the Accounts
      edit form — reported 2026-08-10. `store.rankedCurrencies(accountId)`
      only returned currencies that already appeared in *that account's
      own* transaction history, plus its current currency — so an account
      with single-currency (or zero) history showed exactly one chip,
      already picked, with nothing else to tap. D57's own note flagged
      the intended fallback ("a brand-new account has none yet, so fall
      back to currencies already in use across other accounts") but that
      fallback was only wired up for the `isNew` path, not existing
      accounts. Fixed by having `rankedCurrencies` keep its own-history
      frequency ranking first, but always also include currencies in use
      elsewhere plus CAD/BRL/USD (same approach `AccountCurrencyPicker.tsx`
      already uses for the tap-entry picker), so switching to an unseen
      currency is never blocked (2026-08-10, not yet visually verified in
      a browser — see chat).
- [x] Fixed Institution field in the account edit form still losing
      focus/cursor after the fix above — reported 2026-08-10. Different
      root cause: Institution is the live grouping key for
      `AccountsScreen`'s `groups`/`ungrouped` computation, which
      recomputes from the store on every keystroke (autosave). Each
      character could move the row into a different (or brand-new,
      initially-collapsed) institution group — a structural reparent that
      remounted `AccountForm` mid-edit; a brand-new single-letter group
      also wasn't in `effectiveExpandedGroups` yet, so the row (and its
      open edit panel) could disappear entirely for a keystroke. Fixed by
      freezing the editing row's grouping key (`OpenPanel.
      institutionSnapshot`, read via `effectiveInstitution`) for the
      duration of the edit session — the row no longer reparents while
      typing, and reflows to its real group once the panel closes
      (2026-08-10, not yet visually verified in a browser — see chat).
- [x] Fixed account edit form (Name/Institution fields) unusable while
      typing — reported 2026-08-10: every keystroke reverted/jumped and
      the cursor snapped to the end, couldn't click mid-word and keep
      typing. Root cause: those inputs' `value` was bound directly to the
      live store object (`current.name`/`current.institution`), and
      `commit()` writes through `store.updateAccount` — an async DB
      round-trip through PowerSync's live query — with no local state in
      between, so the displayed value only updated once that round-trip
      resolved, snapping the cursor to the end each time. Fixed by giving
      Name/Institution the same local-mirror pattern `goalAmountStr`
      already used correctly in the same form (2026-08-10, not yet
      visually verified in a browser — see chat).
- [x] Reconciled account/currency picker WIP with docs/12 D60/D61 — restored
      `institution` (types.ts, schema.ts, db/schema.sql), `accountLabel`
      back to `institution — name`, AccountsScreen's institution-grouped
      list, and AccountCurrencyPicker's chip grouping key (was name-only,
      which would've silently merged same-named accounts at different
      banks into one chip) (2026-08-10)
- [x] Repo scaffolded — npm workspaces, app/api/db, docker-compose (2026-08-07)
- [x] Accounts management screen, docs/12 (2026-08-07)
- [x] Inbox screen, docs/07 (2026-08-07)
- [x] Local SQLite data layer via PowerSync web SDK, replacing localStorage
      (2026-08-09)
- [x] Categories screen with budget management, Settings hub (2026-08-09)

# Backlog

Legend: 🔵 now · ⚪ next · ⚫ later/someday · 🐛 bug · ✅ done

This is a working list, not a decisions log — items here don't carry "locked"
status the way entries in docs/01's decisions table do. When an item here
turns into an actual architecture/scope decision, it graduates into the
relevant numbered doc and gets a D-number there; this file just tracks that
it needs doing.

## 🔵 Now

- [ ] Commit the account/currency picker WIP (still uncommitted as of
      2026-08-10 — touches EntryZone, AccountsScreen, AccountCurrencyPicker,
      CategoriesScreen, schema.ts, store.tsx, db/schema.sql, types.ts,
      format.ts, seed.ts, home.css, plus docs/03/10/11/12 and CLAUDE.md).
      D60/D61 (institution) and D62-D64 (currency/goals off the account)
      are both resolved — nothing left blocking the commit.

## ⚪ Next

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
- [ ] Remove the "manual"/"AI" source label shown on transaction list rows
      (`t.source` in the meta line) — currently always visible, not wanted.
- [ ] Show which account paid for each transaction directly on the list
      row — currently the collapsed row shows category/date/source but no
      account; account is only visible after tapping into edit mode.

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
- [ ] Transaction rows on Home aren't clickable/tappable — no way to open
      details from the list. (Already addressed by the in-progress WIP —
      TransactionList.tsx's new tap-to-expand edit form — verify once that
      WIP is finished/committed, this may just need finishing, not new work.)
- [ ] Date/Time fields on the transaction edit form overflow each other on
      iOS — native `<input type="date">`/`<input type="time">` side-by-side
      layout needs a responsive fix. Untested on real iOS Safari. Part of
      the same in-progress WIP (the two fields are new).

## ✅ Done

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

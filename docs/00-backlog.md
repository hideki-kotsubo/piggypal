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

- [ ] Date/Time fields (`.field-pair` in `TransactionEditForm`) still
      overflow each other on real iOS Safari — confirmed by the user
      2026-08-11 on an actual device (app.piggypal.codexbase.dev,
      hard-refreshed), after `min-width: 0` on `.field-pair .field-label`
      measurably fixed the same overflow in Playwright's WebKit (Linux/GTK
      port): at 320px viewport, container/content width matched exactly
      post-fix (282px = 282px) there. The `min-width: 0` fix is still in
      place — it's a real, correct fix for the "flex items don't shrink
      below native-control content width" mechanism, it's just not
      sufficient on real iOS Safari, which renders these controls
      differently than Linux WebKit does. Screenshot showed "Aug 10, 2026"
      (month-name date format) vs. the numeric "08/11/2026" my WebKit test
      rendered — worth checking whether iOS's locale-driven longer date
      format is consuming more intrinsic width than accounted for, or
      whether iOS enforces some other minimum (touch-target sizing on the
      native control) that CSS width/min-width alone can't override.
      Needs iteration against a real iOS device or an iOS-accurate remote
      testing service — Linux WebKit has now been shown to diverge from
      real iOS Safari on this specific bug, not just theoretically.
      Deferred — parked per user 2026-08-11, revisit later.

## ✅ Done

- [x] Redesigned the seed categories into a full starter taxonomy —
      requested 2026-08-12, replacing the old 4 flat + 1 demo-group
      placeholder (Mercado/Transporte/Café/Salário, Lazer/Cinema/Museu)
      with 7 real expense groups (Food & Groceries, Housing & Utilities,
      Health & Personal Care, Transportation, Recreation & Entertainment,
      Shopping, Personal & Family — Housing and Utilities merged per the
      user's choice) and 35 leaf subcategories, all English (also the
      user's choice — the app's bilingual promise, docs/09, covers UI
      chrome and AI parsing, not seed category names specifically).
      Retargeted the two seed transactions/budgets that used to point at
      flat categories onto real leaves (Groceries, Rideshare under
      Transportation) rather than the new group categories themselves —
      D74 means a group's budget bar would show $0 spent and look
      phantom/broken, since nothing logs directly to a group once it has
      children. Kept `aiRaw` on the seed transactions in Portuguese
      deliberately — that's demo data for the bilingual pt-BR parsing
      story, independent of the (now English) category names. Verified
      with Playwright: Home's budget bars show real progress
      ($45/$600 Groceries, $18.40/$180 Rideshare), `CategoriesScreen`
      renders all 7 groups with correct children, and the entry-zone
      picker shows all 7 as collapsed group chips (every top-level
      expense category is a group now — a real stress test of the
      picker's group-collapse mechanism at actual intended scale).
      `tsc -b`/`oxlint` clean, zero console errors.
- [x] Category groups: "+ Add subcategory" directly from the parent
      (docs/14 D75) — requested 2026-08-11, the user found picking a
      parent from the Group chip row backwards for the common case (you're
      looking at "Lazer," want to add "Cinema" under it, not create
      "Cinema" then hunt for "Lazer"). A top-level category's edit panel
      now has a "+ Add subcategory" action that opens the create form
      pre-filled with that category as parent (kind inherited too), header
      reading "New subcategory of Lazer." Same create flow, new entry
      point — the Group field itself is unchanged. Verified with
      Playwright: opened Café (a plain category), tapped "+ Add
      subcategory," confirmed the header and pre-selected Group pill,
      saved "Espresso," confirmed it appeared as "↳ Espresso" right under
      Café. `tsc -b`/`oxlint` clean, zero console errors.
- [x] Category groups & subcategories, minimal pass — brainstormed
      2026-08-11, design written to docs/14-category-groups.md (D70-D74)
      before coding, per user's request to start minimal (picker fix
      only, budget rollup explicitly deferred). `categories.parent_id`
      added (nullable self-referencing FK, 2-level cap enforced app-side
      — types.ts, schema.ts, db/schema.sql, docs/03, store.tsx). Built a
      shared `CategoryPicker.tsx` (mirroring `AccountCurrencyPicker`'s
      grouped-chip-row mechanics, but no Grouped/Capped mode setting —
      this hierarchy is authored by the user in `CategoriesScreen`, not
      inferred from scale, so the picker just reflects whatever exists)
      and wired it into all three places that used to render
      `rankedCategories()` flat: `EntryZone`, `InboxScreen`,
      `TransactionEditForm`. A group stays directly selectable as the
      first chip inside its own expanded body (D71). `CategoriesScreen`
      gained a Group field in the category edit form (chip picker of
      eligible same-kind, non-subcategory parents) and D74's guard: the
      budget section is hidden entirely for a category with children, to
      avoid a silently-non-rolling-up budget looking phantom/broken.
      Also lightly restructured `CategoriesScreen`'s own flat list so
      children sort right after their parent with a "↳" prefix, since a
      management list needs the hierarchy visible even without full
      grouping UI. Verified with Playwright end to end: built a
      Lazer→Cinema/Museu hierarchy via seed data, confirmed the
      EntryZone picker shows "Lazer ▸ 2" collapsed and expands to
      Lazer/Cinema/Museu chips, confirmed `CategoriesScreen` shows the
      "↳" nesting, and confirmed the budget section is hidden for Lazer
      but present for Cinema. `tsc -b`/`oxlint` clean, zero console
      errors. Known follow-up spotted but not fixed (out of scope this
      pass): `CategoriesScreen`'s Name field has the same cursor-jump
      bug already fixed elsewhere (Name/Institution, Note) — `value`
      bound directly to the live store category, no local mirror yet.
- [x] Night mode is now user-toggleable (System / Light / Dark, default
      System) — requested 2026-08-10, built 2026-08-11. Added
      `useThemeMode` to `lib/settings.ts` (same localStorage pattern as
      `useAccountPickerMode`), which sets a `data-theme="light"`/`"dark"`
      attribute on `<html>` (or removes it for System). `tokens.css` gained
      explicit `:root[data-theme="dark"]`/`:root[data-theme="light"]`
      override blocks, and the existing `prefers-color-scheme: dark` block
      is now guarded with `:not([data-theme="light"])` so an explicit Light
      override wins even when the OS is dark — same pattern already used in
      `docs/artifacts/*.html`. The module applies the stored preference on
      import (side-effect import added to `main.tsx`, before first render)
      so there's no flash of the wrong theme on load. Toggle chips added to
      Settings under a new "Appearance" section. Verified with Playwright:
      clicking each chip flips `data-theme` and the computed `--bg` value,
      the choice persists across reload, and switching back to System
      removes the attribute — screenshots confirm both Light and Dark
      render correctly, no console errors.

- [x] Fixed the transaction edit form's Note field having the same
      cursor-jump-while-typing bug as AccountsScreen's Name/Institution
      fields — `value` was bound directly to `transaction.note` (live
      store state), and `commit()` writes through `store.updateTransaction`
      — an async DB round-trip — with no local state in between, so the
      cursor snapped to the end on every keystroke. Fixed with the same
      local-mirror pattern (`noteStr`). Verified behaviorally, not just by
      type-check: scripted a mid-string insert with Playwright (typed "X"
      after "Hello" in "Hello world") and confirmed the result was
      "HelloX world," not "Hello worldX" (2026-08-11).

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

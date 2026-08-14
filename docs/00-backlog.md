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

- [ ] Household sharing (multi-user) + P2P device sync — designed
      2026-08-14, docs/24-household-sharing.md and
      docs/25-p2p-device-sync.md (D108-D120, +D117a, +D113 revised). A UI
      sketch for the payer/creator/owner surface itself (docs/26,
      D121-D124, `docs/artifacts/piggypal-household-sharing.html`) is done
      too — badge on list rows, chip vs. caption on the edit screen, owner
      prefix on Accounts, a bare members list in Settings — but it's a
      mockup, not implementation.
      Reopens docs/01's "households deferred" call and docs/05's
      "single-user per account" call, deliberately, per the user. Two
      parts: a data model (`household_id` replaces `user_id` as the sync
      partition key on accounts/categories/transactions/budgets;
      `paid_by_user_id`/`created_by_user_id` on transactions;
      `owner_user_id` on accounts; a merge algorithm for two
      independently-seeded devices connecting) and a new transport
      (WebRTC + QR-code signaling, manual both-sides-acked sync, available
      to every tier — not just paid, not a PowerSync replacement). Still
      design-only for the server/schema/transport work (households and
      household_members tables, sync rules, API validation, actual pairing
      UI, WebRTC wiring) — none of that is built. Two prep items *are*
      done, ahead of the rest: `seed.ts`'s fixed-slug ids for
      accounts/transactions/budgets are now generated (D113, revised
      broader than first scoped — budgets needed it too, for the same
      reason accounts did), verified with `tsc -b`/`oxlint`/Playwright;
      and the QR/SDP-size risk flagged in docs/25 is resolved by a real
      spike (D117a) — captured actual `RTCPeerConnection` offers
      (586-1005 bytes across offline/STUN/multi-interface cases) all fit
      one QR code with headroom against the format's ~2953-byte ceiling.
      Residual open item, not yet tested: physical two-device scan
      reliability at the resulting module density (version ~20-25,
      screen-to-screen). Also now done: the local-only-safe slice of the
      data model itself — `owner_user_id`/`paid_by_user_id`/
      `created_by_user_id` are real columns (local SQLite schema + Postgres
      `db/schema.sql`), backed by a new `app/src/lib/identity.ts`
      (`getLocalUserId()` — closes a docs/05 D11 gap: this had never been
      implemented since nothing needed a local user identity before now),
      populated on every insert path and backfilled on read for
      pre-existing rows. Verified with `tsc -b`/`oxlint` and a Playwright
      pass that reads actual row values back out of SQLite (seeded data,
      a real quick-add transaction, and a real new account all checked).
      `household_id` deliberately still not added anywhere, local or
      server — `schema.ts`'s own stated principle (no sync-partition
      columns locally until there's something to partition) applies to it
      the same way it already applied to `user_id`. Still fully unbuilt:
      `households`/`household_members` tables, sync rules, API validation,
      the merge algorithm itself, and any owner/payer/creator UI (correctly
      invisible per D110 until a household has 2+ members).
      2026-08-14, later same day: a direct question ("I want my phone,
      tablet, and laptop on one account — how?") surfaced a real gap —
      docs/25's P2P pairing didn't distinguish "my own second device" from
      "a different person," so both ran through the household-merge
      algorithm identically, which would've fragmented one person's data
      across fake household members. Fixed in docs/25 (D125-D127, +
      cross-ref in docs/24): pairing now asks "your own device, or
      someone else's?" before anything else. Own-device mode unifies
      identity (the joining device adopts the other's `getLocalUserId()`,
      pre-existing local data asked-before-rewritten, reusing docs/05
      D14's exact pattern) instead of running the two-person merge;
      accounts still don't auto-merge even then (same unsolved class of
      problem as merchant dedup — flagged, not solved, manual cleanup
      available). Paid tier never had this problem — same-email sign-in
      already gives every device the same server `user_id` and PowerSync
      keeps them in sync automatically, no pairing ceremony at all.
      Design only — no code changes from this addendum.
      2026-08-14, later still: a UI sketch for the pairing flow itself
      (docs/27-p2p-pairing-ui-sketch.md, D128-D131,
      `docs/artifacts/piggypal-p2p-pairing.html`) — Settings entry point,
      the own-device-vs-someone-else fork as two full-screen cards, both
      sides of the QR exchange, the D126 merge prompt, and the both-sides
      -acked confirmed state.
      2026-08-14, same day, later still: the pairing prototype itself is
      real. New: `app/src/lib/pairing.ts` (pure WebRTC offer/answer/
      data-channel logic, no QR/camera involved — directly testable),
      `PairingScreen.tsx` (the choice → show/scan → synced flow from
      docs/27), `peers.ts` (a minimal localStorage peer list — just enough
      for frame 1/5, not the fully-designed feature docs/25 flags as
      still open), and a `qrcode`/`qr-scanner` dependency pair for QR
      generation and camera-based scanning. Wired into Settings under a
      new "Sync" section. One real deviation from the docs/27 sketch
      surfaced during the build: a real handshake needs both devices to
      show *and* scan (whoever goes first shows-then-scans, the other
      scans-then-shows-back), so there's an added "who goes first" choice
      the sketch didn't draw — flagged in `PairingScreen.tsx`'s own
      comment. Verified, not just typed-checked: two real
      `RTCPeerConnection`s completing an actual handshake with a correct
      hello/ack (D118, concretely — see `exchangeHello`), a generated QR
      round-tripping through a real decode back to the exact original
      payload, and the full click-through UI (both role branches, camera
      permission + fake-device video, both themes) rendering with zero
      console errors. `tsc -b`/`oxlint` clean.
      Deliberately not done: D125-D127's actual identity unification
      (the "own device" choice is captured but doesn't yet rewrite
      `getLocalUserId()` or merge pre-existing data — frame 4's D126
      sheet isn't wired up) and docs/24's real data merge — "Synced" today
      confirms the connection and handshake are real, not that any
      transaction/account/category data moved. Also still open: real
      two-device physical QR-scan reliability (a fake-video-device test
      isn't the same as a camera reading a real screen — docs/25's own
      flagged unknown, unchanged), and peer management beyond a bare list
      (no rename/forget/manual re-sync).
      2026-08-14, confirmed on real hardware: the user tested an actual
      connection, which established successfully — and found level-M QR
      density slow for a weaker device's camera to resolve, answering
      docs/25's own previously-flagged-but-unverified "physical scan
      reliability" question for real (D132). Fixed by dropping to
      error-correction level L at a larger render size, the exact
      mitigation docs/25 had already named as the right first move: for a
      real ~650-byte offer this takes the code from a 93×93 module grid to
      85×85, each module ~28% physically larger at the same render width.
      Decode correctness reverified after the change.
      Still slow after that — the user's next observation. The remaining
      lever was the payload itself, not the QR settings: `pairing.ts` was
      JSON-wrapping the SDP (`{"sdp":"...","type":"offer"}`), which costs
      bytes two ways — the wrapper structure, and JSON escaping every
      `\r\n` line-ending as four literal characters instead of two raw
      bytes. Fixed by dropping the wrapper (`type` is now passed from
      context instead of traveling in the payload — whoever's decoding
      already knows whether it's an offer or an answer) and collapsing
      CRLF to bare LF before encoding, restored on decode. Confirmed
      empirically, not assumed, that browsers' SDP parsers accept the
      LF-only encoding despite the spec calling for CRLF (D133) — a real
      connection + hello/ack still completed correctly. Measured: 647 →
      569 bytes (12%), 85×85 → 81×81 modules, 3.29px → 3.46px per module —
      each module now ~34% larger than the original level-M/JSON encoding
      this feature shipped with, stacking on top of D132's fix. Decode
      correctness reverified again.
- [ ] "Merge account" as its own explicit action, not only something that
      happens automatically at pairing time — flagged 2026-08-14, future
      work, not designed. Idea: a standalone Settings entry point (paid
      *or* free) for reconciling two datasets that grew up separately —
      e.g. someone who ran the app on two devices for months without ever
      pairing them, or two already-paid users who each subscribed
      independently and now want to combine into one shared household
      (which also reopens the billing question docs/24 explicitly deferred
      — who's billed, what happens to the second subscription). Likely
      reuses docs/25 D125-D127's identity-unification mechanics and docs/05
      D14's ask-before-merging pattern rather than inventing a third one,
      but that's a guess, not a plan — needs its own design pass.
- [ ] Revisit "piggypal" naming once there's a working product to react to
      (parked 2026-08-07 — see docs/01 item 5 for full context: name space
      is saturated, piggypal's real gaps are signaling private/local-first
      and pig-imagery cultural sensitivity, not the collision itself).
- [ ] Server-backed full-history CSV export (docs/08-csv-export.md, D30) —
      for users whose local 18-month window has aged out older transactions.
- [ ] Location/merchant follow-ups still open after docs/15 D78 and
      docs/16-18: showing merchant on TransactionList/RecentList rows
      (search/filter itself shipped, docs/18, but rows still don't show
      merchant directly — only findable via search/filter or opening the
      transaction), Tier 2 AI merchant extraction once the server AI
      pipeline itself exists (docs/16 D92 keeps Tier 1 merchant-free), and
      the merchant-string dedup problem ("Costco" vs "COSTCO #412" vs
      "Costco Gas" fragmenting a spend-by-merchant total) — still not
      solved.
- [ ] Server-side AI pipeline (Tier 2) + sync/auth/Stripe — fully specified
      in docs/02-06 but intentionally not implemented yet (deliberate
      local-only-first build order). Tier 1 (on-device, free, offline) is
      now real — docs/16.
- [ ] Recurring transactions — explicitly out of MVP scope (docs/01).
- [ ] Household sharing — explicitly out of MVP scope (docs/01).
- [ ] docs/04 learning loop (writing corrections back into
      `category_keywords` when a user resolves an Inbox item) and its
      dedupe guard (same amount+date within 2 minutes) — both explicitly
      deferred by docs/16 D91.

## 🐛 Bugs

- [ ] `BudgetBars.tsx:19` throws `Uncaught TypeError: Cannot mix BigInt and
      other types, use explicit conversions` — reported 2026-08-12. Root
      cause: `store.tsx:75` maps `amountCents: r.amount_cents` straight from
      the raw SQLite row with no conversion, and the SQLite driver (wa-sqlite
      via PowerSync) returns `INTEGER` columns as native JS `bigint`, not
      `number` — `types.ts` declares `amountCents: number`, but at runtime
      it's actually a `bigint`, and TS has no way to catch that mismatch
      since the row mapper does no runtime coercion. `BudgetBars.tsx:19`
      (`(spendByKey.get(key) ?? 0) + -t.amountCents`) mixes the `bigint`
      with a plain-number `0`/accumulator, which throws. `store.tsx:444`
      has the identical mixing pattern (`(totals.get(...) ?? 0) +
      t.amountCents`) — likely reproduces wherever that total is consumed
      (trend/home totals), not just this one call site. Not yet fixed;
      real fix is probably at the source — coerce `amount_cents`/
      `amountCents` (and likely `budgets.amount_cents`, same column type)
      to `Number(...)` once in `store.tsx`'s row mappers rather than
      patching every arithmetic call site individually.
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

- [x] Quick-add's blank $0.00/uncategorized transaction survived cancel —
      reported 2026-08-13. Home's "+" (docs/19) inserts a live row before
      navigating to its edit screen; backing out with no edits left it
      behind. Fixed (docs/23, D105): leaving the screen deletes the row if
      it's still exactly $0.00 (every other entry path already requires a
      nonzero amount to insert at all, so that's an unambiguous "untouched
      quick-add" signal). Also added an explicit "Done" button to the edit
      form (D107) — autosave was already correct but gave no visible
      confirmation typing was saved or that the back arrow was safe to tap.
      Verified via Playwright (2026-08-13).
- [x] Voice transcripts never saved — reported 2026-08-13 ("I see the
      transcript of what I said but the app doesn't save the new entry").
      Not a parser bug: `speechInput`'s `onResult` only filled the text
      field (docs/16 D93), and the only submit trigger was Enter *inside*
      the input — there was no submit button in the entry zone at all, so
      a transcript couldn't be committed without raising a keyboard, which
      defeats the hands-free path. Fixed via the parse-preview panel
      (docs/22 D95-97) rather than a bare submit button, per the user's
      request for the confirmation treatment from the location-field
      artifact's frame 1: Tier 1's reading (amount/category/when/account,
      each marked parsed-vs-defaulted) is shown for confirmation, and the
      Save button doubles as the missing commit affordance. Typed entry
      now goes through the same preview — a deliberate, flagged behavior
      change costing one extra tap against the <3s target, reversible to
      voice-only. Verified with Playwright against a stubbed
      SpeechRecognition: a fired transcript ("45 mercado ontem") renders
      the preview and Save persists it to the full list as Groceries /
      yesterday / -$45.00; an unmatched category shows the inbox warn
      tone; Edit dismisses without writing and preserves the text; an
      amount-free utterance still soft-blocks with no preview and no
      insert. `tsc -b`/`oxlint` clean, zero console errors.
- [x] Mic recording indicator (docs/22) — requested 2026-08-13. The
      `listening` state was a static accent fill that read as "selected"
      rather than "live"; now the button carries a breathing halo, the
      placeholder switches to "listening…", and a `role="status"` region
      announces "Listening" (new `.sr-only` utility — the stylesheet had
      no screen-reader convention). The halo's 4px spread is a measured
      ceiling: a first attempt at a ring expanding to 1.9x scale clipped
      flat against `.entry-zone`'s `overflow: hidden` (docs/21), which
      leaves only ~5.7px clearance above the button and ~7.4px to its
      right — caught by measuring in the browser, not by type-check.
      Halo colour is a `color-mix` of `--accent` rather than
      `--accent-soft`, which washed out against `--surface-sunken`.
      Verified with Playwright: halo fits on all sides, box-shadow
      measurably varies across the cycle (1.19px → 3.90px → 2.95px),
      `prefers-reduced-motion` disables the animation but keeps a static
      halo, both themes resolve a visible colour, and voice → preview →
      save still works after the CSS change.

- [x] Formalized the "sunken zone" card pattern (docs/21) — brainstormed
      2026-08-13 after noticing the Home entry box's styling (sunken fill +
      hairline border + radius) had been independently re-derived four
      times at four different radii (`.entry-zone`, `.account-create`,
      `.search-input-row`, `.text-input`), plus three partial copies
      missing the fill (`.trend-card`, `.goal-box`, `.picker-group`).
      `tokens.css` gained a theme-independent radius scale
      (`--radius-lg/md/sm`); the four full-tier components now reference
      it instead of literals; `.trend-card` and `.goal-box` promoted to
      full tier (sunken fill added); `.picker-group`'s dashed/un-sunken
      look kept deliberately, it's a distinct "expanded" signal, not a
      miss. Explicit rule locked in: the box is for zones (grouping unlike
      controls into one interactive unit), not for list rows — Accounts/
      Transactions/Settings row lists confirmed flat on purpose, untouched.
      CSS-only, no component/JSX changes.
- [x] Inbox list now matches TransactionList/RecentList/Search's row style
      (docs/20) — reported 2026-08-13: many pending items each rendering a
      full always-expanded `CategoryPicker` (7 top-level groups) looked
      cluttered, and the screen's deliberate "keep a just-categorized item
      visible, dimmed" mechanic (docs/07 D26) read as confusing at a
      glance ("previously categorized items showing as uncategorized") —
      not a data bug, but a real UX miss now that a full edit screen
      exists to send someone to instead. Rows are now plain
      `.tx-row.tx-row-tappable` links to `/transactions/:id` (docs/17);
      D26's snapshot-on-mount/dim-to-done bookkeeping is gone entirely —
      a live `categoryId === null` filter, same as everywhere else,
      turned out to just be correct once categorizing happens on a
      separate screen. Verified with Playwright: categorizing an item via
      its edit screen and returning to Inbox drops it from the list
      immediately, count goes from 1 to 0 with nothing stale left behind.
      `tsc -b`/`oxlint` clean.
- [x] Quick-add skips the inline amount-pad/category panel (docs/19) —
      implemented 2026-08-13, requested after seeing docs/17's screen in
      practice: tapping "+" now creates a blank transaction immediately
      (amountCents: 0, categoryId: null, default account/currency/now)
      and jumps straight to its dedicated screen instead of stopping at an
      inline keypad + category-chip step first. `EntryZone.tsx` lost its
      collapsed/expanded toggle entirely — one persistent row now (+ /
      type-or-say field / mic), `AccountCurrencyPicker`/`AmountKeypad`/
      `CategoryPicker` no longer imported there. Also fixed a genuine $0
      edge case in `TransactionEditForm`'s direction default (`<= 0` not
      `< 0` — a blank transaction is exactly $0, a state no real
      transaction is ever actually in, and was defaulting to income).
      Typed/voice Tier 1 entry (docs/16) unaffected. Verified with
      Playwright: "+" lands on a blank screen with "−" (expense)
      pre-selected, digit entry produces the right amount/sign, typed
      entry ("45 mercado ontem") still inserts and toasts correctly.
      `tsc -b`/`oxlint` clean.
- [x] Tier 1 local rule-based parser + voice input (docs/16) — implemented
      2026-08-12. `parser.ts`: pure, closed-vocabulary amount/currency/
      date/category/account extraction (bilingual pt-BR/en), never-guess
      degrades to the existing uncategorized inbox. `category_keywords`
      seeded with a small bilingual starter vocabulary and wired into
      `store.tsx` (was a fully unused table before this). `EntryZone`'s
      typed-text box actually works now instead of toasting "not wired up
      yet"; a feature-detected mic button transcribes speech into the same
      field via the Web Speech API, no separate parse path. Merchant
      extraction, the docs/04 learning loop, and its dedupe guard
      explicitly deferred (D91-92, tracked above). Verified with
      Playwright: "45 mercado ontem" inserts Groceries dated yesterday,
      an unmatched utterance degrades correctly to the inbox with the
      right toast copy, an amount-free utterance soft-blocks without
      inserting and keeps the text editable, mic button renders in
      Chromium. `tsc -b`/`oxlint` clean.
- [x] Dedicated transaction screen (docs/17) — implemented 2026-08-12.
      New `/transactions/:id` route (`TransactionScreen.tsx`) replaces
      inline expand-in-place editing for transactions specifically
      (Accounts/Categories unchanged); back navigation uses `navigate(-1)`
      since the screen is now reachable from three places. Tap-entry
      auto-navigates to the new transaction's screen post-insert instead
      of toasting — answers the reported pain point of clicking straight
      back into a just-created transaction to fill in Note/Location/
      Date-Time. Verified with Playwright: Recent-row tap, Transactions-
      list-row tap, and tap-entry submission all land on the dedicated
      screen correctly; Back returns to the right place from each.
      `tsc -b`/`oxlint` clean.
- [x] Transaction search & filter (docs/18) — implemented 2026-08-12.
      Search (note+merchant substring) and filter chips (Category,
      Account, Location, Date range) added inline atop `/transactions`
      (confirmed with the user over the artifact's separate-screen
      staging), filter state in `useSearchParams()` so it survives the
      Back navigation docs/17 introduced, results total shown per
      currency present — never blended (docs/10). Verified with
      Playwright: "Costco" search correctly narrows to 2 rows summing
      -$129.20; "This month" preset correctly shows separate CAD and BRL
      totals; filtered state survives a full page reload. `tsc -b`/
      `oxlint` clean.
- [x] Location/merchant on transactions (docs/15) — implemented 2026-08-12.
      Nullable `merchant` column on `transactions`, a "Location" field in
      `TransactionEditForm` right below Note (same local-mirror-state
      autosave pattern), and `store.rankedMerchants()` feeding a
      recency-ranked, live-substring-filtered suggestion chip row (D79).
      Tier 1 never attempts extraction (D77); AI wiring, list-row display,
      the search/filter screen, and merchant-string dedup are explicitly
      deferred (D78, tracked as a follow-up above). Seed data extended
      with a repeat "Costco" merchant across two transactions to exercise
      the recency ranking.
- [x] Added an "Events & Tickets" leaf under Recreation & Entertainment
      to the seed taxonomy — requested 2026-08-12 after working through
      where things like a ballgame or pool/museum admission actually
      belong (they didn't fit Movies & Streaming, screen entertainment,
      or Hobbies, hands-on participation — a real gap, not covered by
      folding into Kids Activities). Verified with Playwright.
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

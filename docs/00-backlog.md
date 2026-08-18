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
      2026-08-14, later still: the actual data merge is real, closing the
      biggest remaining gap — the user asked directly "is it already
      syncing data?" and the honest answer at the time was no, just the
      connection. `store.applyPeerDataset(peer, adoptPeerIdentity)` now
      implements docs/24's merge rules for real, directly against local
      SQLite (categories by id, accounts/transactions always inserted as
      new rows, budgets resolve a category/month/currency collision to
      the greater amount — D134). `pairing.ts` gained `exchangeJson`, a
      generic both-sides-acked payload exchange (same shape as
      `exchangeHello`, reused for hello too so identity now travels
      alongside the handshake instead of a third round trip).
      D125-D127's identity unification is wired in too: the joining
      device in "my own device" mode gets D126's merge prompt if it has
      pre-existing data, confirming rewrites its accounts/transactions to
      the peer's id and adopts it going forward; declining cancels
      cleanly with nothing changed. "Synced" now shows a real count
      instead of placeholder copy.
      Verified against the real app with ground-truth SQL queries (not
      just trusting the returned summary): a someone-else merge correctly
      skipped an already-present category, added a new one, added a new
      account/transaction under the peer's own identity unchanged, and
      updated an existing budget to a higher peer amount while leaving a
      lower one alone; an own-device merge correctly rewrote every one of
      5 pre-existing local accounts and 5 transactions to the adopted
      identity. `tsc -b`/`oxlint` clean throughout.
      Still open: `category_keywords` deliberately excluded from the sync
      (the learning loop that would ever change them isn't built), no
      cancellation signal if a connection drops between the merge prompt
      and the merge running, and everything already flagged as
      out-of-scope in docs/25 (relay signaling, peer management beyond a
      bare list).
      2026-08-14, real hardware, real bug: the "connection drops between
      the merge-prompt and the merge" gap named right above turned out to
      already be happening, every time — the user reported clicking
      "Merge," both devices showing a bare "Syncing…" with no progress,
      then eventually "Connection dropped before syncing finished." Root
      cause was a genuine deadlock: the joining device pauses at the
      merge-prompt for a user tap, the other device doesn't know to wait
      and sends its data immediately, and `RTCDataChannel` doesn't
      buffer/replay `message` events for listeners attached after the
      fact (the original `exchangeHello`/`exchangeJson` each attached a
      fresh listener per call) — so the impatient side's message could
      arrive while nothing was listening and be lost forever. Fixed by
      `wrapChannel()` (docs/25 D135): every channel gets exactly one
      persistent buffering queue, attached the instant it's available,
      before anything could possibly have been sent. Verified by directly
      reproducing the bug's timing (one side calling `exchangeJson`
      immediately, the other deliberately delayed 2 real seconds) rather
      than just re-running the happy path — confirmed both sides still
      resolved correctly with the right cross-matched data, and that the
      delay was genuinely honored (~2001ms measured, not skipped).
      `tsc -b`/`oxlint` clean; full UI click-through re-verified with no
      regressions.
      2026-08-14, real hardware, two more real bugs: scanning was still
      slow, and a failed scan's retry left the camera dead with the
      browser's own recording indicator still lit. Root cause 1:
      `qr-scanner`'s `stop()`/`destroy()` defer the actual camera-track
      release by 300ms internally (read straight from the library
      source); a fast remount could start a new `getUserMedia()` request
      before the old one actually let go. Fixed with the library's own
      `pause(true)` immediate-release flag — confirmed directly:
      `track.readyState` reads `"ended"` right after calling it, versus
      still `"live"` at the same point with plain `stop()`. Root cause 2,
      surfaced while investigating root cause 1: `QrScanStep` bound one
      persistent `<video>` element via a ref, and React StrictMode's
      dev-mode double-invoke (mount → cleanup → mount, on *every* mount,
      not just the first) created two `QrScanner` instances pointed at
      that same node in immediate succession — reproduced in isolation,
      outside the app entirely, that this can leave *neither* instance's
      stream attached, even though neither `start()` call throws. Fixed
      by creating a fresh `<video>` element per effect run instead of a
      shared ref. Verified by reproducing the user's literal sequence in
      the real component under real StrictMode: enter the scan step,
      confirm a live camera, back out, retry within 50ms — both the first
      attempt and the immediate retry get a genuine live camera. `tsc -b`/
      `oxlint` clean, full UI regression re-checked.
      Also reported same day, not yet investigated: pairing an iPhone and
      a desktop showed "Synced with iPhone" on both screens. Traced the
      label-exchange protocol and it looks correct; `guessDeviceLabel()`
      is pure `navigator.userAgent` sniffing, so the leading suspect is
      the desktop side's UA matching the iPhone pattern (browser
      device-emulation mode) rather than a real protocol bug — asked the
      user to confirm, unconfirmed as of this entry. Proposed fix either
      way: an editable, remembered device name instead of relying solely
      on UA sniffing.
      2026-08-14, real hardware, a third bug: "connection dropped before
      syncing finished" again, right after scanning the second (answer)
      QR code — despite the D135 channel-queue fix and both camera fixes
      already landed. `qr-scanner`'s decode callback fires on every video
      frame that reads the code, not once — holding the phone steady for
      even a moment after a good scan triggers it multiple times, running
      `handleScannedAnswer` concurrently for what felt like one scan. The
      first call's `completeOffer` succeeds; every call after it throws,
      since a `RTCPeerConnection` can only accept one `setRemoteDescription`
      per signaling-state transition — caught by the generic error
      handler, so it looked like total failure even though the first call
      may have already succeeded (and if two calls got far enough, would
      have corrupted the handshake for real via two competing channel
      listeners). Fixed with a `handled` guard (docs/25 D137): the first
      decode pauses the scanner and is the only one that reaches
      `onResult`. Verified by feeding the guard 5 simulated repeat-frame
      decodes of a real QR-encoded payload — confirmed exactly one
      `onResult` call, not five — plus a full UI regression pass. `tsc -b`/
      `oxlint` clean.
      Same message, also asked: how feasible is a WhatsApp-style "linked
      device" model instead of a one-time merge? Answered in chat, not
      designed: what that actually is (each device syncing continuously
      and independently against WhatsApp's servers) is already the paid
      PowerSync path once signed in on multiple devices — no new work
      needed there. A genuinely always-live link over pure P2P isn't
      feasible without a server (mobile browsers suspend backgrounded
      tabs; cross-network devices need signaling infrastructure — the
      relay docs/25 already deferred, D117). Realistic middle ground:
      treat pairing as an ongoing remembered relationship with lighter
      re-sync UX, not true always-live. Not designed further than this.
      2026-08-14, built right after: the first concrete piece of that —
      "once they pair, they'll probably do it again," so a repeat sync
      with a known peer now skips the own-device/someone-else question
      entirely (docs/25 D138-D139). `PairedPeer.id` changed from a
      throwaway random id to the peer's real `getLocalUserId()`, so
      `recordSync` can upsert (update the existing row) instead of always
      appending a duplicate on every sync with the same person. Settings'
      peer rows are now real links straight into `/settings/pair?peer=<id>`,
      which skips the choice screen and starts at "who's showing their
      code first" with the identity already known from last time. The
      merge-prompt needed no changes at all — it already skips itself
      correctly on a repeat sync, since the condition that shows it
      naturally becomes false once identity's already unified. Verified:
      a seeded known peer's row lands directly on the role step with the
      choice screen never rendered (checked for its absence, not just
      the next step's presence); two recordSync calls for the same peer
      leave exactly one row, not two; ordinary first-time pairing
      unchanged. `tsc -b`/`oxlint` clean. Still short of true "linked
      devices" — each repeat sync is still a manual QR ceremony, just
      without the now-redundant question.
      2026-08-14, later still: asked directly why pairing needs two QR
      scans instead of one — answered (WebRTC's offer/answer handshake is
      inherently bidirectional, same shape as any P2P pairing; QR is
      standing in by hand for what a signaling server normally relays
      invisibly), which led to "can we offer both, and let the user
      choose?" Designed and built the same day: docs/28-relay-assisted-
      pairing.md (D140-D145) — a lightweight, anonymous WebSocket relay
      (`api/src/relay.ts`, the first real feature on `api/`, which was
      previously just `/health`) that brokers the same offer/answer
      exchange automatically for two devices that aren't in the same
      room, keyed by a short human-typable code instead of a QR scan.
      Open to every tier, no auth (the user's explicit call — the relay
      never touches financial data). Because an anonymous relay means
      anyone could try to occupy the wrong room slot, added Short
      Authentication String verification (a few emoji derived from both
      sides' real connection fingerprints, shown and confirmed on both
      screens before anything else crosses the channel) — the user chose
      to include this rather than ship without it, given the stakes.
      A new "are you together right now?" question now sits between
      identity and role; picking "no" swaps the QR show/scan screens for
      code-generate/code-enter/SAS-confirm ones. Everything downstream
      (merge, identity unification, the synced summary) is completely
      unchanged and shared with the QR path — `pairing.ts` was already
      transport-agnostic.
      A real bug surfaced while first testing this, not before: the SAS
      confirmation step inserts a human-paced gap between "the data
      channel opens" and "afterHandshake runs" that the QR path never
      had (QR calls afterHandshake immediately on channel-open) — if the
      peer's hello arrived during that gap, it had zero listeners to
      catch it, the same deadlock class as D135, just a different kind of
      pause triggering it. Fixed by wrapping every channel the instant it
      opens, in whichever flow produced it, rather than whenever
      afterHandshake happens to run (docs/28 D145).
      Verified in layers: the raw server relay via direct WebSocket
      clients (full room lifecycle, rejection cases, rate limiting all
      confirmed); the client transport directly (a real relay-mediated
      RTCPeerConnection reaching `connected`, SAS matching exactly on
      both sides of one connection and differing between two independent
      connections); and the full UI across two separate browser contexts
      for both the someone-else and own-device paths, reaching a real
      "Synced" screen with accurate counts on both sides. QR and
      known-peer flows re-verified afterward for regressions from the
      shared code this touched — none found. `tsc -b`/`oxlint` clean on
      both `app/` and `api/`.
      2026-08-14, real deployment + real-device follow-up: `app/.env` now
      points `VITE_RELAY_WS_URL` at a real reverse-proxied `wss://`
      hostname instead of the localhost dev default — no code changes
      needed, confirming the override point (D140's "will change in the
      future" concern) was designed right the first time. Separately,
      using it for real surfaced two code-entry frictions: no auto-dash
      while typing, and no way to avoid transcribing 0/O or 1/I/l by
      hand. Fixed (docs/28 D146): the code field auto-inserts the dash as
      you type, and a "scan a code instead" option reuses the exact same
      QR-scanning component the main pairing flow already has (every
      camera fix that component earned applies here for free); the
      "show code" screen now also renders the code as a QR alongside the
      text, for whichever the two people find easier. Verified: the
      dash-formatting function against 8 edge cases including an
      already-dashed input and a real generated code round-tripping
      unchanged; the type/scan toggle and QR rendering on a freshly
      booted instance (an earlier run's worker-load errors turned out to
      be stale Vite cache on a long-running dev server, not a real bug —
      confirmed by the same test passing clean on a fresh one); a full
      relay pairing re-run end to end confirming the QrShowStep refactor
      didn't regress anything; and a dedicated encode/decode round-trip
      for a real generated code specifically. `tsc -b`/`oxlint` clean.
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

- [x] P2P-paired devices all showed as their bare guessed type ("iPhone",
      "Android device") with no way to tell two of the same type apart —
      requested 2026-08-18, e.g. two iPhones, a Samsung and a Pixel, or
      pairing with a spouse whose phone guesses identically. Fixed same
      day (`docs/30-device-naming.md`, D157-D158): a new "This device's
      name" field in Settings' Sync section lets a device name itself;
      that name (falling back to the old UA guess when unset) is what
      gets sent during pairing instead of always re-guessing. Renaming an
      already-paired peer's name locally (independent of their own
      choice) stays out of scope, same as docs/25's existing bare-list
      peer-management gap.
- [x] App version display + tracking, and an About screen — requested
      2026-08-18. `docs/29-versioning-and-about.md` (D153-D156): root/app/
      api `package.json` synced to one real starting version (`0.1.0`,
      were mismatched placeholders before); Settings gained an "About
      piggypal" row showing it, and a new `/about` screen with a
      first-person "built by one person" blurb, a `mailto:` contact row,
      and the version again. `api`'s `/health` now also reports its
      version. Implemented same day.
- [x] Parser missed absolute dates/times and gave up on merchant entirely
      for real-world inputs — reported 2026-08-17 against
      `"Purchase of $10.61 at amazon.CA Toronto Can on August 16th, 2026
      at 5:25PM (PDT)."`, which parsed as amount-only. Fixed same day
      (docs/16 D151): month-name absolute dates and clock times now parse
      (bilingual, closed vocabulary — "August 16th, 2026", "16 de agosto
      de 2026", "5:25pm", "17:25"), a parenthesized timezone abbreviation
      is recognized and stripped but never used for conversion (this app
      always means the literal wall-clock value, never UTC-converts), and
      a single proper-noun-ish token after "at"/"no"/"na" is guessed as a
      new merchant when no known one matches — flagged `merchantGuessed:
      true` and gated behind the same preview-then-Save confirmation every
      other field already uses, never written silently. Fixing this
      surfaced a real bug: amount extraction ran before date/time
      resolution and could grab a date's day-number or a time's digits
      instead of the real amount (a day-first date especially, since the
      day number appears before the amount in that phrasing) — fixed by
      resolving date/time first and skipping digits already claimed by a
      span. Verified: `tsc`/`oxlint` clean; the exact reported input run
      through the real seeded app end to end (Amount -$10.61, When
      correct to the exact date and time, Merchant "amazon.CA" marked
      guessed); a battery of pure-function cases confirmed the
      day-first-date amount bug is fixed, a bare time with no date
      defaults to today, a lowercase word after "at" is correctly never
      guessed as a merchant, and docs/16 D150's known-merchant path is
      unaffected.
- [x] Note wording follow-up — user's read on the saved note from the
      item above ("Purchase of $ at Toronto Can"): keep "at `<merchant>`"
      readable, but the bare "$" doesn't need to stay. Fixed same day
      (docs/16 D152): `extractDigitAmount` now also claims a bare
      currency symbol next to the amount (cosmetic only, never used to
      set `currency` — a bare "$" is still genuinely ambiguous between
      USD/CAD, docs/10); the merchant guess's span is deliberately left
      unclaimed so "at `<merchant>`" survives into the Note. That reopened
      the exact edge-trim problem D151 solved in the first place (a bare
      "20 at Target" would lose its "at" to the edge trim with nothing
      preceding it) — fixed by giving the trim an exact protected phrase
      to never cut through, found by word-run position, while any other
      unrelated "at" elsewhere still gets cleaned up normally. Verified:
      `tsc`/`oxlint` clean; the exact reported input now saves "Purchase
      of at amazon.CA Toronto Can"; "20 at Target" keeps "at Target"
      together; full regression re-run (known-merchant path, word-amount
      compounds, income triggers, fully-recognized/no-leftover case) all
      confirmed unaffected.
- [x] Merchant identification for voice/typed parsing, and saving
      unrecognized input into the Note field — requested 2026-08-17,
      built same day (docs/16 D150). Both landed together since they
      share the same mechanism: every `parser.ts` extraction function now
      records the text span it matched, threaded through `parseUtterance`.
      Merchant matching is closed-vocabulary against `store.
      rankedMerchants()` — never invents an unseen name, narrowing
      D92/docs/15 D77 rather than reopening the open-vocabulary concern
      those were actually about. Whatever's left after every span is
      removed becomes `note` (previously always a copy of the category
      name); `null` when nothing's left, which docs/07 D148's fallback
      already turns back into the category name for display — no new
      special-casing needed in `EntryZone.tsx`. `aiRaw` still keeps the
      full original utterance regardless, so nothing is lost even where a
      span is mis-computed. Verified: `tsc`/`oxlint` clean; a pure-function
      test against a stubbed ctx confirmed known-merchant matching, word-
      amount compounds ("twenty five"), currency markers, and income
      triggers all get excluded from leftover correctly, including
      overlapping spans (a word that's both a category keyword and part of
      a merchant name); a full real-UI run through the actual seeded app
      (`uber 15 to the airport for meeting` → Merchant: Uber, Category:
      Rideshare, saved row's title reads "to the airport for meeting") and
      a fully-recognized case (`groceries 20` → title falls back to
      "Groceries", not blank) both confirmed end to end.
- [x] App kept asking to allow the microphone every time the mic icon was
      tapped — reported 2026-08-17 on iOS. Root cause: `speechInput.ts`
      built a brand-new `webkitSpeechRecognition` instance on every tap;
      Chrome ties the mic grant to the origin so this never showed there,
      but Safari's grant behaves as scoped to the recognition *instance*
      instead, so each fresh instance looked like a never-before-seen
      request. Fixed (docs/16 D149) by reusing one module-level instance
      across taps, reconfiguring its handlers before each `start()`
      instead of constructing new; a fast abort-then-retap racing ahead of
      the previous session's `end` event (`InvalidStateError` on a reused
      instance) falls back to a fresh instance for that tap rather than
      leaving the mic dead. Verified: `tsc`/`oxlint` clean, and a stubbed
      `SpeechRecognition` constructor confirmed sequential taps reuse the
      same instance (1 construct for 2 taps) while the race case correctly
      recovers via one fallback reconstruct. Flagged honestly in the doc:
      this mitigates a WebKit platform limitation, not guaranteed airtight
      on every iOS/Safari version — worth confirming on the user's actual
      phone.
- [x] Home should be entry + recent only, no budgets/graph — requested
      2026-08-15 as a test ("Could we have a Home screen with just the text
      input and the latests entries? With no budget neither graph?").
      Budgets and the trend chart moved to a new `InsightsScreen.tsx` at
      `/insights` (docs/07 D147), reached from a small ▤ icon next to
      Settings' kebab on Home; both components (`BudgetBars`,
      `TrendSparkline`) moved unchanged, no logic touched. Verified on an
      isolated dev instance (Playwright): Home renders entry box + inbox
      banner + recent only, `/insights` renders trend + budgets, the icon
      link navigates correctly both ways, no console errors.
- [x] List rows should show Category instead of a bare "No note" when a
      transaction has no note — requested 2026-08-15. Added
      `transactionTitle()` (docs/07 D148) — note → category name →
      "Uncategorized" — used by RecentList and TransactionList; InboxScreen
      left untouched since its rows are category-less by definition (that's
      the filter that puts them there). Verified: `tsc`/`oxlint` clean: the
      existing seeded "no note, no category" row still correctly shows
      "Uncategorized" (unchanged behavior), and a direct call to
      `transactionTitle()` with a note-less-but-categorized transaction
      confirmed the new branch returns the category name.
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

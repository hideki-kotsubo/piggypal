# 80 — Desktop (and later tablet) layout

Status: built 2026-10-29 (phases 1–3), released in app 0.15.0.
Decisions D312–D318 (D318: native iPad, 2026-10-30, not released yet).
See "Built" below.

Backlog item this covers (docs/00, ⚫ Later): "Custom UI for tablets and
desktops" (flagged 2026-08-19). Earlier sketch:
`docs/artifacts/piggypal-desktop-tablet-directions.html` (2026-08-20,
directions A rail + side composer, B list + detail, C centered phone
column; none chosen then).

Split out of the same brainstorm: statement import and audit →
docs/81. Desktop-only feature ideas → "Parked" below.

## Scope rule (user, 2026-10-29)

**Layout only, no new features.** The desktop version does exactly what
the phone version does today, arranged for a wide window, mouse and
keyboard. Two principles from the user that outlive this pass:

1. Desktop and phone have **the same functionality**. Desktop may have a
   better *experience* of it (more on screen at once, keyboard,
   hover, drag-and-drop) but never a capability the phone lacks.
2. Test for any later desktop idea: if it has no phone equivalent, it's a
   design gap to close, not a "desktop extra".

## Context

- Today every screen is a single ~480px column (`.home { max-width:
  480px }`, `app/src/styles/home.css`). In a desktop browser the PWA
  already works, just centered with empty space either side.
- **First target: desktop browser / installed PWA** (user, 2026-10-29).
  iPad comes later and means reopening docs/72 D259 (iPhone-only for v1:
  `TARGETED_DEVICE_FAMILY = 1`, because iPad screenshots and iPad review
  become mandatory). Not reopened by this doc.
- Free tier is single-device (docs/01). For most people a desktop is a
  second device, so in practice this serves sync/household users and
  P2P pairing (docs/25). Worth keeping in mind for how much to invest,
  not a blocker.
- The user wants to **add transactions on desktop too**, not only review.
  Entry is a main desktop job.

## Main idea

The phone is for capture (the 3-second entry, docs/07 D22–D26). A big
screen is where you also sit down and review: Inbox, budgets, Insights,
schedules, accounts, receipts. The layout should serve both: fast entry
always one keystroke away, and enough width to see a list and its detail
together.

That points to a mix of the 2026-08-20 directions **A (nav rail) and B
(list + detail)**, not C.

## Decisions

| #    | Decision |
|------|----------|
| D312 | **Entry on wide screens is the top bar.** Today's entry zone ("+" and the typed/voice field with its parse preview) moves into a bar across the top of the main area; the preview drops down under it. "+" and Save open the transaction in the detail pane (docs/17's auto-navigate, in the pane). Chosen 2026-10-29 from the mockup's four placements over the bottom dock, the floating panel and the side column. Phone width keeps docs/31's bottom dock unchanged. |
| D313 | **List + detail side by side on every list screen**: Transactions, Inbox, Accounts, Scheduled, Settings. Selecting a row opens its existing detail screen in the right pane; the URL still changes as today, so links, refresh and Back work. Below 600px, today's push navigation. |
| D314 | **Categories joins D313 by putting its edit form in the detail pane** (proposed 2026-10-29, pending user confirmation in the mockup). Categories has no detail page (docs/79 D311: a tap opens an edit sheet), so on wide screens the sheet's same fields move into the right pane; a sheet on the phone, unchanged. A real category detail page (spending, budget history, its transactions) would be a new screen on the phone too, so it's parked, not part of this pass. |
| D315 | **The top bar (D312) is on every screen on wide windows**, not only Home, so entry is always one click away. Phone keeps the dock on Home only. (2026-10-29) |
| D316 | **Wide Home follows the mockup: an exception to docs/07 D147 on desktop only.** Two columns: Recent on the left; due/inbox banners, this month's budget bars and the trend on the right. Phone Home unchanged (D147 stands there). (2026-10-29) |
| D317 | **Phones are portrait-only in the native apps.** iPhone: landscape removed from `UISupportedInterfaceOrientations` (the `~ipad` list is untouched for a later iPad build). Android: `screenOrientation="portrait"` on the main activity (Android 16 ignores it on large screens, so tablets aren't locked). A browser tab can't be locked, so `useWidthClass()` still treats height < 480 as compact. (2026-10-29) |
| D318 | **The iOS app supports iPad natively** (supersedes docs/72 D259). `TARGETED_DEVICE_FAMILY = "1,2"` in both build configurations; the `~ipad` orientation list (all four, D317) and the width classes give an iPad the tablet layout, and Split View falls back to the phone layout when narrow. D259's reason (a 480px phone column on iPad) is gone with this layout. Store side: 13" iPad screenshots (`social:screenshots --size ipad` / `ipad-landscape`) and review on an iPad. Apple doesn't let later builds drop iPad once it's live. Not yet tried on an iPad or the simulator. (2026-10-30, user's call) |

## Proposals (not yet decided)

### P1 — Width classes, by window width, not device

| Width | Example | Layout |
|---|---|---|
| < 600px | phone, narrow window | today's app, unchanged |
| 600–1024px | small window, later iPad portrait | icon-only nav rail, list + detail where it fits |
| ≥ 1024px | laptop/desktop | labelled nav rail, list, detail pane |

Driven by window width (and CSS container queries per component), never
by user agent: windows resize live, and iPad Split View / Stage Manager
will too.

### P2 — Persistent nav rail replaces in-page navigation on wide screens

Home, Transactions, Inbox (with its count), Insights, Accounts,
Categories, Schedules, Settings. Same routes as today.

### P3 — List + detail split

Where a phone screen pushes a detail route, the wide layout opens it in a
pane beside the list. The URL still changes (`/transactions/:id`,
`/accounts/:id`, `/schedules/...`), so links, refresh and Back behave the
same; below the width threshold it falls back to today's push navigation.
Same components rendered in a pane, not new screens.

Candidates: Transactions → TransactionScreen; Accounts → AccountScreen
(docs/79 D309); Schedules; Inbox item; Settings hub → sub-pages
(docs/79 D310).

### P4 — Entry: the existing typed entry as a top bar

Today's entry zone (docs/31) is the "+" button (blank transaction,
straight to its screen with the keypad, docs/19) and the typed/voice
field with its parse preview (docs/16, docs/22). Corrected 2026-10-29:
an earlier draft of this section described a keypad + chips entry
panel; that was replaced by docs/19 and isn't part of the entry zone.
Not a new feature in any variant: same "+", same parser, same preview.

Four placements to try in the mockup (user wants to try them all
before choosing):

- **Bottom dock (today)**: docs/31's dock, centred in the main area.
  "+"/Save open the transaction in the detail pane (docs/17's
  auto-navigate, just in the pane).
- **Top bar**: the entry in a bar across the top, preview drops down
  under it. "+"/Save open the transaction in the detail pane.
- **Top bar + panel**: same bar, but "+"/Save open the transaction in a
  floating panel, leaving the screen underneath where it was.
- **Side column**: a permanent right-hand column with the entry field,
  preview, and the new transaction's form right under it (2026-08-20
  direction A). Needs ≥1024px; narrower falls back to the dock.

Mockup: `docs/artifacts/flowtab-desktop-prototype.html`
(https://claude.ai/artifact/Sq8rsLd7jgpGo268jtfrMm, private to the
owner) — width slider across the 600/1024 breakpoints, the four entry
placements, and list + detail on/off per screen.

### P5 — Home as a multi-column dashboard

Same blocks as today's Home (budget bars, recent list, due banner,
inbox banner, Insights teaser), arranged in columns instead of one long
scroll. No new blocks.

### P6 — Mouse and keyboard polish (experience, not features)

- `pointer: fine` → denser spacing, hover states.
- Keyboard shortcuts only as accelerators for actions that already exist
  (focus entry, next/previous row, open, close pane, save). Open: is this
  in scope for the first pass or a follow-up?
- Bottom sheets (docs/79 D311) become centered dialogs or side panels on
  wide screens.

## Open questions

1. ~~Which screens get the split (P3)?~~ Decided: all (D313, D314).
2. ~~Fate of the bottom-docked entry zone on wide screens?~~ Decided:
   top bar (D312).
3. Keyboard shortcuts (P6): first pass or later?
4. Mockups first: redo the 2026-08-20 directions artifact at ~820px and
   ~1280px with P1–P5, before any code?
5. Language check: rail labels and pane headers in pt-BR, es, fr and the
   CJK locales (docs/73, docs/76) at the narrow rail width.
6. Shared computers: with private records/PIN (docs/77) and E2E
   (docs/78), does a desktop browser need an idle lock? (Possibly not
   new: check what the PIN already covers.)

### Answers (2026-10-29)

- Q2 (entry zone on wide screens): tried in the mockup → **top bar**
  (D312).
- Q1 (which screens split): **all of them** (D313), Categories via its
  edit form (D314).
- Q3 (keyboard shortcuts): **later**, not in the first pass.
- Q4: **yes, mockup first**: an interactive prototype at ~820px and
  ~1280px where the entry variants and per-screen split can be toggled.

## Technical plan (2026-10-29)

Written against the code as of app 0.14.1. Nothing built yet.

### What the code looks like today

- Flat routes in `main.tsx` (`BrowserRouter` + `<Routes>`, react-router
  7, not a data router). Every screen renders its own page:
  `<main className="home">` + its own `.app-bar` with a back link.
- `.home` is a centred `max-width: 480px` column (`styles/home.css`).
  That's useful here: a screen dropped into a 400px list pane or a
  ~560px detail pane mostly just fits.
- Entry zone + toast live only in `App.tsx` (Home), the dock is
  `position: fixed` (docs/31), the toast is Home's local state.
- Detail screens: `TransactionScreen` (`navigate(-1)` on finish, plus the
  docs/23 fresh-blank cleanup), `AccountScreen`, `ScheduleScreen`, the
  Settings sub-pages. Inbox has no detail route: its rows link to
  `/transactions/:id`.
- Categories edit in a `BottomSheet` from local state (docs/79 D311);
  `BottomSheet` portals to `body` with a scrim.
- Sticky day labels use `top: env(safe-area-inset-top)`; that works
  inside any scrolling pane too.

### Building blocks

1. **`lib/layout.ts` — `useWidthClass()`**: `compact | medium |
   expanded` from `matchMedia`, re-rendering on change. Rule: compact if
   width < 600 **or height < 480**, so an iPhone in landscape (allowed in
   `Info.plist`, ~850×390) keeps the phone layout. Medium 600–1023,
   expanded ≥ 1024. Pure `classify(width, height)` with a Vitest test.
2. **`AppShell`** — one layout route wrapping every route. Compact:
   renders `<Outlet />` only, so the phone DOM is exactly today's. Wide:
   `NavRail` + top bar (title + entry, D312) + `<Outlet />` + a toast host.
   The shell is a fixed-height viewport (`100dvh`); panes scroll
   individually, the body doesn't.
3. **`NavRail`** — `NavLink`s for Home, Transactions, Inbox (with count),
   Insights, Accounts, Categories, Scheduled, Settings; labels at
   expanded, icons only at medium. Reuses existing `nav.*`/`settings.*`
   strings where they exist.
4. **`SplitLayout`** (D313) — a nested-route layout: `list` element on the
   left, `<Outlet />` (or an empty state) on the right. Compact: the child
   route if one matched, else the list, which is today's behaviour.
5. **`PaneContext`** — `usePane()` tells a screen it's in a `list` or
   `detail` pane, and the list path to close back to. Used to hide each
   screen's own back link in the list pane (the rail replaces it), and
   to make the detail pane's back/Done go to the list route instead of
   `navigate(-1)`. Each screen's `.app-bar` stays; no rewrite of ~20
   headers.
6. **`BottomSheet` modes** (D314, P6) — a sheet on compact. Wide: if a
   `DetailSlot` is provided (Categories' split), it portals inline into
   the detail pane with no scrim. Otherwise it's a centred dialog (CSS
   under the shell). One change covers every sheet.

### Routes after the change

| Path | List pane | Detail pane |
|---|---|---|
| `/transactions`, `/transactions/:id` | `TransactionList` | `TransactionScreen` |
| `/inbox`, `/inbox/:id` (**new path**) | `InboxScreen` | `TransactionScreen` |
| `/accounts`, `/accounts/:id` | `AccountsScreen` | `AccountScreen` |
| `/schedules`, `/schedules/:id` | `SchedulesScreen` | `ScheduleScreen` |
| `/settings`, `/settings/*` | `SettingsScreen` hub | sync, appearance, language, entry, household (+ link-device, pin), pair, delete-account, about |
| `/categories` | `CategoriesScreen` | its edit form via `DetailSlot` (no URL change, as today) |

- `/transactions/duplicates` stays a full-width sibling route (more
  specific path, ranked first).
- Inbox rows link to `/inbox/:id` on every width, so the Inbox list stays
  beside the transaction. On the phone it behaves as today (Back returns
  to the Inbox).
- `/about` moves under `/settings/about`, with `/about` redirecting.
- Deep links stay valid: `/transactions/:id` on desktop now opens with
  its list beside it.

### Phases (each one shippable, phones unchanged throughout)

1. **Shell**: `useWidthClass`, `AppShell`, `NavRail`, top bar with the
   screen title (no entry yet), pane scroll model. Every screen still
   single-pane, centred.
2. **Splits** (D313, D314): `SplitLayout` + nested routes for the table
   above, `PaneContext`, row highlight (`aria-current` via `useMatch`),
   empty-pane states, `BottomSheet` modes.
3. **Entry** (D312): `EntryZone` in the top bar, parse preview as a
   drop-down under it, toast host in the shell. Home on wide (P5, see
   open questions).
4. **Polish + checks**: `pointer: fine` density and hover, rail/pane
   strings in all 10 locales (parity test), Playwright pass.

### Risks found while reading the code

- **Blank transactions left behind in the pane.** On the phone, leaving
  a fresh $0 transaction runs docs/23's cleanup (`finish()`). In a pane
  you can click another row without pressing Done. The cleanup has to
  run when the pane's transaction id changes or unmounts too, not only
  on Done/Back.
- **Crossing a breakpoint remounts screens** (resizing a window past
  600/1024). Forms autosave, so nothing saved is lost, but an
  in-progress entry draft or an open sheet resets. Acceptable; noted.
- **Fixed elements.** The dock, toast and sheet are `position: fixed`
  against the viewport. In the shell they must anchor to the main area,
  not the whole window (the rail would sit under them). Handled by
  rendering dock/toast only in compact and the shell's own host on wide.
- **Safe areas** (docs/65) only matter on phones, which stay compact.
  Recheck when iPad comes (D259).
- **Phones get the new code too** (native apps bundle `app/dist`), so
  "compact = today's DOM" is the guarantee to verify, not assume.

### Verification

- Vitest: `classify()`; existing suites and the i18n parity test.
- Playwright against the dev server (:3001) at 390×844, 844×390 (phone
  landscape, must stay compact), 820×1180, 1280×800 and 1440×900, light
  and dark: navigation, each split, Inbox filing, Categories in the pane,
  a sheet as a dialog, entry → detail pane, blank-row cleanup on
  switching rows. Screenshots at each width for review.
- 390×844 compared with a screenshot of the current build: no visible
  difference.
- On a real phone after release (user): Home, entry, a transaction, a
  sheet.

### Open questions for the build

1. ~~Top bar on every screen, or Home only?~~ Every screen (D315).
2. ~~Home on wide (P5)?~~ Follow the mockup, desktop-only exception to
   D147 (D316).
3. ~~Phone in landscape?~~ Native apps locked to portrait on phones,
   height rule kept for browsers (D317).

## Built (2026-10-29, `feat/desktop-layout`)

- **Phase 1, shell:** `lib/layout.ts` (`classify`/`useWidthClass`, with
  `layout.test.ts`), `AppShell.tsx` as a layout route around every route
  in `main.tsx` (compact renders the bare `<Outlet />`), rail with inbox
  count, top bar title, `styles/shell.css`. Root screens hide their own
  back link and title there. `nav.home`/`nav.main` strings in all base
  locales. D317: iPhone `UISupportedInterfaceOrientations` portrait only,
  Android `screenOrientation="portrait"`.
- **Phase 2, splits:** `SplitLayout.tsx` (`SplitLayout` route layout,
  `SlotSplit` for Categories) and `lib/pane.ts` (`usePane`,
  `useDetailSlot`). Routes nested as in the table above; `/inbox/:id`
  new, `/about` → `/settings/about`. Rows are `NavLink`s so the selected
  one is highlighted; Transactions keeps its filters in the detail URL.
  `TransactionScreen` closes to its list in a pane and runs docs/23's
  fresh-blank cleanup when the pane lets go of a transaction (counted,
  so StrictMode's double mount doesn't delete it). `BottomSheet` renders
  inline in Categories' slot and as a centred dialog elsewhere on wide
  windows. `split.*` empty-pane strings in all base locales.
- **Phase 3, entry + Home:** `EntryZone` in the top bar on every screen
  (D312, D315), its preview dropping over the content; toast host in the
  shell, so it survives the navigation after "+". Wide Home is two
  columns: Recent | banners, trend, budget bars (D316). Phone Home
  untouched.
- **Checked:** `tsc -b`, oxlint (no new warnings), Vitest 264/264,
  production build. Playwright against the dev server at 1280×800,
  820×1180 and 390×844, light and dark: entries through the top bar,
  each split, Inbox at `/inbox/:id`, Categories in the pane, account
  edit as a dialog, "+" opening the pane, blank row removed when
  switching rows (5 → 6 → 5), phone detail/back and Home unchanged, no
  page errors. Not yet on a real phone or tablet. Phase 4 (pointer
  density, keyboard later) not started.
- **Fixes after the user's first try (2026-10-30):** the wide frame is
  `--surface`, not `--bg`, so a centred screen column has no grey bands
  beside it. `SplitLayout` keys the detail outlet by pathname: picking
  another row used to keep the open `TransactionEditForm` with the first
  record's fields. Location chips (both platforms, transaction and
  scheduled-payment forms): a set location shows alone as the picked
  chip, otherwise the six most used (`lib/locationSuggestions.ts`,
  recency on a tie, starts-with first), narrowed only while typing.
  Before, the stored value filtered the list, so a longer location hid
  the others.

## Parked (new features, out of this pass, recorded so they're not lost)

All of these follow the same-functionality rule: each needs a phone
version too.

- **Multi-select + bulk edit**: recategorize/move/delete many
  transactions at once. Desktop: Shift/⌘-click; phone: long-press to
  select. Backlog already has a related multi-select item.
- **Data grid**: spreadsheet-style transaction table, sort by any
  column, filter with conditions (amount > 200, date between…), possibly
  in-cell editing. Phone equivalent: the same sort/filter rules in a
  filter sheet over the day-grouped list. Backlog: "Spreadsheet-style
  filterable data view" (2026-08-23).
- **Multi-line paste entry**: paste several lines, get several parsed
  transactions to confirm. Bridge to docs/81.
- **Drag-and-drop receipt photos** onto a transaction (docs/77 part B).
  Arguably just a desktop way to attach, once attaching exists.
- **Statement import and audit** → docs/81.
- **iPad + Mac "Designed for iPad"**: after the desktop web layout,
  reopening docs/72 D259 as its own release. Android tablets get the
  same responsive code for free.

## Suggested order (from the brainstorm, not decided)

1. Mockups at two widths (open question 4).
2. Width classes + nav rail + list/detail on Transactions.
3. Entry top bar + Home dashboard.
4. The rest of the list/detail screens, dialogs for sheets.
5. Later: parked items, then iPad.

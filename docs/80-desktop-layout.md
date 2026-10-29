# 80 — Desktop (and later tablet) layout

Status: design, 2026-10-29. Entry placement and list + detail decided
(D312–D314) after trying the mockup; the rest of the proposals still get
D-numbers once agreed. Nothing built yet.

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

# 08 — CSV Export

## Core principle

A trust signal for a privacy-positioned app: get all your data out without
ever touching the server. Purely local, client-side, free on both tiers —
gating it would undercut the pitch, and unlike sync/LLM it costs nothing
server-side to give away (doc 01's tiering rationale is specifically about
gating the *expensive* features).

## Mechanism

- Reads directly from on-device SQLite. No API call, works offline, works
  identically for free and paid users.
- Builds a `Blob` and triggers a browser download (`URL.createObjectURL` +
  `<a download>`) — no server round-trip.
- Triggered from Settings, reached via the app-bar kebab (doc 07's layout).
- Exports everything on-device in one tap — no date-range filter in v1. A
  full CSV is trivially filterable afterward in any spreadsheet tool, so the
  filter UI isn't pulling its weight yet.

## Format

Columns: `date, amount, category, account, note, source, ai_raw`

- `date` — `occurred_on`, ISO 8601 (`YYYY-MM-DD`). Avoids MM/DD vs DD/MM
  ambiguity for a Vancouver + Brazil audience.
- `amount` — signed decimal dollars, 2 places (negative = expense, positive
  = income), mirroring the DB's signed `amount_cents` directly rather than
  splitting into separate amount/direction columns.
- `category` — category name, or `Uncategorized` if `category_id` is null.
- `account` — account name.
- `note` — the cleaned note/merchant text.
- `source` — `manual` | `ai` | `import`.
- `ai_raw` — the original utterance, blank when not applicable. Costs
  nothing to include and reinforces the transparency angle: the user can see
  exactly what the parser captured.
- Soft-deleted transactions (`deleted_at is not null`) excluded.

Encoding: UTF-8 **with BOM** — without it, Excel mangles accented
characters ("Café," "Mercado") on open, a real issue given the bilingual
pt-BR/en data this app actually produces.

Delimiter/decimal: comma-delimited, period-decimal (not a pt-BR-locale
semicolon/comma variant). Most portable across Excel, Sheets, pandas, etc.
A BR-locale Excel user pays one extra "Text to Columns" step in exchange for
not maintaining two export formats.

## Scope boundary: local-only in v1

Local devices retain an 18-month transaction window (doc 03's sync rules);
older history lives server-side only. v1's export is capped at whatever's
on-device — for most users that's their full history anyway, and it keeps
this feature at zero new API surface.

**Backlog, not v1**: a server-backed "full history" export endpoint for
users whose local window has aged out older data. Would need a new
authenticated API route and — because it's a server call — most likely
becomes a de facto paid-tier feature the way sync/parse are, rather than
the free/local export this doc describes. Revisit once real users are
old enough for the 18-month cap to bite.

## Decisions locked in this doc

| # | Decision | Why |
|---|---|---|
| D27 | CSV export is local-only, client-side, free on both tiers | Zero new API surface; matches the "never locked in" trust framing without server cost |
| D28 | Export dumps everything on-device in one tap, no date-range filter in v1 | A full CSV is easy to filter afterward; the filter UI isn't earning its place yet |
| D29 | Columns: `date, amount, category, account, note, source, ai_raw`; ISO dates, signed decimal amount, UTF-8 with BOM, comma-delimited/period-decimal | Portable, unambiguous for a bilingual audience, and Excel-safe for accented text |
| D30 | Server-backed full-history export deferred to backlog | Local-only covers most users; the server variant is materially more scope (new endpoint, likely paid-gated) than this doc otherwise needs |

# 09 — Language & i18n

## Core principle

Full bilingual UI (pt-BR + English) in v1 — chrome, labels, buttons, settings,
error messages — not just the already-bilingual input parsing (doc 04). This
matches the app's own positioning and the audience it's built for.

## Language selection

- Detected from `navigator.language` on first launch, stored as a local
  device preference (localStorage/IndexedDB key), overridable anytime in
  Settings.
- Not synced across devices in v1 — one extra setting per device is cheap
  friction, and syncing it would mean a new synced preferences concept for a
  single field. Revisit only if this becomes a real annoyance.
- Works before any account exists — consistent with D10 (auth is opt-in);
  language is a pure client concern with no server dependency either.

## Implementation

Recommend a standard i18n library (i18next, or react-intl/FormatJS) over a
hand-rolled key lookup — reconsidered from the instinctively "boring" hand-
rolled option once real content surfaced a real need: doc 07's inbox banner
copy ("3 entries need a category" vs. "1 entry needs a category") requires
correct pluralization, and pt-BR/English don't share plural rules 1:1. A
standard library is the actually-boring choice here — hand-rolling
pluralization is the kind of undifferentiated correctness work D1's PowerSync
rationale already argues against doing yourself elsewhere in this project.

Two locale files (`en.json`, `pt-BR.json`), loaded at build/runtime. Missing
key in either language falls back to English rather than showing a raw key
or blank string.

## What's translated vs. what isn't

- **Translated**: all UI chrome, category *seed* labels at first launch
  (pt-BR UI gets "Mercado, Transporte, Lazer…"; EN UI gets "Groceries,
  Transport, Fun…" — after that, categories are free-text and user-owned,
  no ongoing translation layer needed).
- **Not translated (internal enums)**: `accounts.kind`, `transactions.source`
  stay fixed English-keyed values in the DB (`checking`, `manual`, `ai`, …);
  only their *display label* is looked up per language — standard
  code/display separation, not a partial-i18n gap.
- **Currency codes** (ISO 4217) are universal, never translated — see
  docs/10 for how currency and language formatting interact.

## Formatting

Dates and numbers via native `Intl.DateTimeFormat` / `Intl.NumberFormat`
keyed to the **UI language** — zero library needed, correct grouping/decimal
conventions for free. Currency *symbol* comes from the transaction/account's
own currency code, independent of UI language (docs/10) — a pt-BR-UI user
with a CAD transaction sees "CA$45,00" (pt-BR grouping, CAD symbol), not a
mix-up of the two axes.

## Decoupled from input language

UI language and the language someone types an entry in are unrelated. A
pt-BR-UI user can type "5 coffee" and it parses fine; an EN-UI user can type
"45 mercado ontem" the same way — doc 04's parser already ignores UI
language entirely. Worth stating explicitly since it's a nice emergent
property, not something that needed extra engineering.

## Decisions locked in this doc

| # | Decision | Why |
|---|---|---|
| D31 | Full bilingual UI (pt-BR + English) in v1, not just input parsing | Matches the app's stated positioning and audience |
| D32 | Language auto-detected from browser locale, per-device setting, not synced | Zero server dependency, cheap enough friction to not justify a synced-preferences concept for one field |
| D33 | Standard i18n library (i18next/react-intl) over hand-rolled key lookup | Pluralization differs between pt-BR/English (doc 07's inbox banner copy needs it); a library is the actually-boring choice here |
| D34 | Number/date formatting via native `Intl` APIs keyed to UI language; currency symbol keyed to the transaction's own currency, independent axis | No library needed; correctly separates "how you read numbers" from "what currency this was" |
| D35 | Internal enums (`accounts.kind`, `transactions.source`) stay fixed English-keyed values; only display labels are translated | Standard code/display separation |

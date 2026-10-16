# 73 — Multi-language UI and voice (en, pt-BR, es, fr)

2026-10-16. Planned with the user the same day. Phase 1 started on branch
`feat/i18n`.

## Why, and what this reopens

The user asked for a multi-language UI, voice entry included, in
Portuguese (Brazil), Spanish and French alongside English. Two of
docs/09's decisions are reopened here on purpose; the backlog's "Spanish
support" item (2026-08-23) had already flagged them as needing an
explicit decision:

- **D31** said "full bilingual UI", meaning pt-BR + English. It is now four
  languages, some with regional variants (D261).
- **D32** said the language is auto-detected from the browser and never
  shown as a setting. It stays per device and not synced, as D32 says,
  but now there's a picker in Settings (D262).

Also reversed: the comment in `app/src/lib/seed.ts` that records a
2026-08-12 decision to keep starter category names English, and docs/09's
plan to translate starter categories once, at first launch. Translating
only at first launch can't handle two devices on one account set to
different languages, so display-time translation (D266) replaces it.

docs/09's other decisions still stand: D33 (use a standard i18n library,
now settled as i18next, D263), D34 (Intl formatting, sharpened in D265),
D35 (internal enums stay English).

## Where things stood before this doc

- docs/09 was spec only: no i18n library, every UI string hardcoded in
  English across about 7,200 lines of components.
- `app/src/lib/format.ts` hardcodes `UI_LOCALE = 'en-CA'`, and
  `formatRelativeDate` returns English "today" and "yesterday" literals.
- `app/src/lib/speechInput.ts` passes `navigator.language` to the Web
  Speech API, with no language choice.
- `app/src/lib/parser.ts` mixes pt-BR and English vocabulary in one set of
  word lists (numbers, weekdays, months, currencies, income triggers, edge
  filler words). Spanish only works where words happen to be shared
  ("tres").
- Native apps: iOS declares the speech permission (docs/62 D234). Android
  WebView support for `webkitSpeechRecognition` is untested and probably
  missing (backlog, docs/62).

## Languages and variants

| Tag | Picker label | File |
|---|---|---|
| `en` | English | `en.json`, the source of truth and the final fallback |
| `pt-BR` | Português (Brasil) | `pt-BR.json` |
| `es` (shown as `es-419`) | Español (Latinoamérica) | `es.json`, neutral Latin American Spanish |
| `es-ES` | Español (España) | `es-ES.json`, only the strings that differ |
| `fr` (shown as `fr-FR`) | Français (France) | `fr.json` |
| `fr-CA` | Français (Canada) | `fr-CA.json`, only the strings that differ |

Each regional file holds only the strings that differ from its base
language, for example *móvil/celular*. A string that's missing falls back
along `es-ES → es → en`, so a regional file can start empty. The user's
2026-10-16 answer to "how bad would offering all the variants be" was to
take them all, since this fallback chain makes them cheap. Português
(Portugal) could be added later at the same cost.

## Category and account names across languages

The user's requirement (2026-10-16): a starter category is the same
category in every language. Groceries (EN) is Mercado (PT). When the
language changes, the name changes with it. Two devices on one account
set to different languages each show their own language.

This works without schema changes, because starter categories already
have fixed slug ids shared by every install (docs/24 D112, `seed.ts`):

- The database keeps storing the English starter name, as today.
- Each locale file has a `seedCategory.<id>` entry, e.g.
  `seedCategory.cat-food-groceries`: Groceries / Mercado / Supermercado /
  Épicerie.
- A single `categoryLabel(category)` helper decides what to show. If the
  id is a starter id **and** the stored name equals that id's starter
  label in *any* language, the category was never renamed, so it shows
  the current UI language's label. Otherwise it shows the stored name
  exactly as typed.
- "In any language" makes an edit on a Portuguese device safe: if the edit
  form shows "Mercado" and the user saves it unchanged, the result still
  counts as never renamed and still translates on other devices. The edit
  form also skips writing a name that didn't change.
- Existing users get this automatically, because their stored names are
  the English starter names.
- A user-created category, or a starter one the user renamed ("Costco
  runs"), shows the user's own text in every language.

Starter accounts (`Cash`, `Checking`, seeded in `seed.ts`) get the same
treatment. Their ids are random uuids, so the match is by `kind` plus
"stored name equals the starter name for that kind in any language".
Sign-in merge's name matching (`mergeMatch.ts`, docs/46 D168) keeps
working because the stored value is still English.

Places that show category names today, and will go through the helper:
`store.tsx`, `format.ts`, `parser.ts`, `CategoriesScreen`,
`CategoryPicker`, `TransactionList`, `TransactionEditForm`,
`ScheduleScreen`, `BudgetBars`, `DuplicateTransactionsScreen`.

## Voice

- A **Voice language** setting, per device, defaulting to "Same as app".
  It's separate from the UI language because people often run the app in
  one language and speak in another (docs/09's "decoupled from input
  language" still holds).
- The recognizer gets a full regional tag. If the device locale is in the
  same language, its region is used (`es-AR`, `en-GB`). Otherwise each
  variant has a default: `pt-BR`, `es-MX` for `es`, `es-ES`, `fr-FR`,
  `fr-CA`, and `en-US` for `en`. Recognizers don't reliably accept
  `es-419`, so it's never sent.
- On web and PWA it stays the Web Speech API (`speechInput.ts`).
- In the native apps, Phase 4 adds a native speech plugin
  (`@capacitor-community/speech-recognition` or similar). Step one is
  checking that it supports Capacitor 8. It covers Android, where WebView
  probably has no Web Speech. It can also ask the device which languages
  it supports, so a language the device can't recognize gets a clear
  message instead of a silent failure. Whether iOS also moves to the
  plugin or keeps WebKit's recognizer depends on the real-device test
  already in the backlog.

## Parser

`parser.ts`'s word lists get split into one pack per language: `en`,
`pt`, `es`, `fr`. The packs cover number words, weekday and relative-date
words, month names, currency words, income triggers, merchant connector
words and edge filler words.

- **Typed text** is matched against all packs, the same "parser ignores UI
  language" property docs/09 describes.
- **Conflicts:** some words mean different things in different languages.
  "no" is "in the" in Portuguese but "not" in Spanish; "de" appears in all
  of pt, es and fr; "sept" is French for seven but an English month
  abbreviation. When the input came from voice, the voice language's pack
  wins. For typed text, the UI language's pack wins.
- Category matching includes every language's starter labels plus
  per-language starter keywords (`seedCategoryKeywords` gains es and fr
  entries).
- Each language gets its own test file with real utterances
  ("45 supermercado ayer", "12 café hier", ...).

## Text outside the app

Included in the first release:

1. **The magic-link sign-in email** (`api/src/auth/email.ts`). The app
   sends its UI language with the sign-in request, and the API picks the
   matching template, falling back to English.
2. **The system permission prompts.** iOS: `InfoPlist.strings` per
   language for `NSMicrophoneUsageDescription`,
   `NSSpeechRecognitionUsageDescription` and `NSCameraUsageDescription`.
   Android: `values-xx/strings.xml` for the app name and any user-facing
   strings.

Later, not in this project: App Store and Google Play listings, the
website (`website/`).

## Translations

Claude drafts pt-BR, es, es-ES, fr and fr-CA. The user reviews pt-BR as a
native speaker. es and fr should get a native reviewer before they're
advertised. Until then the changelog and store copy shouldn't present them
as fully reviewed.

## Phases

1. **Setup, no visible change.** Install `i18next` and `react-i18next`;
   create the locale files and i18n init; add the language setting
   (`settings.ts`) and the Settings picker; make `format.ts` follow the UI
   locale; add a key-parity test.
2. **Move all strings into `en.json`**, screen by screen. Mechanical; the
   app should look exactly the same in English afterwards.
3. **Translations.** pt-BR, es, fr and the regional files, plus
   `categoryLabel()` and the starter-account labels.
4. **Voice.** The Voice language setting, regional tags, and the native
   plugin.
5. **Parser.** Language packs, conflict rules, per-language tests.
6. **Outside the app.** The sign-in email and native permission strings.

Phases 1-2 are the bulk of the work but carry little risk. 4 and 5 can
run alongside 3.

Releasing: this changes both `app/` and `api/` (phase 6), so it needs the
full release, staging, prod-server and native store-build steps.

## Decisions

| # | Decision | Why |
|---|---|---|
| D261 | UI languages: `en`, `pt-BR`, `es` (Latin America), `es-ES`, `fr` (France), `fr-CA`. Regional files hold only differences, with the fallback chain variant → base language → `en`. Supersedes D31. | The user asked for pt-BR, es and fr, and chose to offer every variant once it was clear the fallback chain makes them cheap. |
| D262 | Settings has a language picker: "Automatic (device)" plus the six languages. Automatic maps `navigator.languages` to the closest supported language, else `en`. Stored per device in localStorage and never synced. Amends D32. | The user wants each device able to use its own language (2026-10-16). It works before sign-in and has no server dependency. |
| D263 | i18next + react-i18next, with every locale bundled into the app rather than lazy-loaded. A missing key falls back to `en`. Settles D33. | Offline-first app, small JSON files. i18next uses `Intl.PluralRules`, so French plurals (0 counts as singular) work. |
| D264 | A unit test fails if a base locale file (`pt-BR`, `es`, `fr`) is missing a key `en.json` has, or has a key `en.json` doesn't. Regional files are exempt from "missing", not from "extra". | Catches untranslated strings before release without forcing regional files to repeat everything. |
| D265 | Intl formatting uses the UI language plus the device's region when they share a language (UI `es` on an `es-AR` device formats as `es-AR`), else the chosen tag. The currency symbol still comes from the transaction's currency (D34). | Dates and number grouping follow where the person actually is, at no cost. |
| D266 | Starter category names are translated when shown, keyed by their fixed slug id. A category counts as never renamed when its stored name equals that id's starter label in any language. The stored name stays English. Supersedes docs/09's first-launch translation and seed.ts's 2026-08-12 note. | Same category in every language, devices with different languages show their own, existing data works with no migration or schema change. |
| D267 | Starter accounts (`Cash`, `Checking`) are translated the same way, matched by `kind` plus starter name in any language. | Same reasoning as D266. Their ids are random, so the match is by kind and name. |
| D268 | A per-device Voice language setting, defaulting to "Same as app". The recognizer always gets a full regional tag (device region if it matches, else a per-variant default; never `es-419`). | People often speak a different language than the app is set to; recognizers want a concrete region. |
| D269 | The native apps use a native speech plugin, on Android at least; web keeps the Web Speech API. Whether iOS moves too follows the real-device test. | Android WebView most likely has no Web Speech. The plugin can also report which languages the device supports. |
| D270 | The parser's vocabulary is split into per-language packs (en, pt, es, fr), all active for every input. On conflicting words the voice language's pack wins for voice input, the UI language's pack for typed input. | Full es/fr parsing (user, 2026-10-16) without breaking typed input in other languages, and with a rule for words like "no", "de", "sept". |
| D271 | The first release also translates the magic-link email (the app sends its language with the sign-in request) and the native permission prompts. Store listings and the website come later. | Users see the email and the permission prompts in their first minutes; store copy is a separate effort. |

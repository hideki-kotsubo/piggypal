# 73 — Multi-language UI and voice (en, pt-BR, es, fr)

2026-10-16. Planned with the user the same day. All six phases built the
same day: 1-3 on `feat/i18n` (merged to `main`, not yet released), 4-6 on
`feat/i18n-voice-parser`. See the status sections below. Not released;
nothing native has run on a device yet.

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
   (`lib/i18n.ts`) and the Settings picker; make `format.ts` follow the UI
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

## Phase 1 status (2026-10-16)

- `app/src/lib/i18n.ts`: language list, `resolveLanguage()` (D262),
  `formatLocaleFor()` (D265), the stored preference (`flowtab:language`,
  removed when Automatic), synchronous i18next init imported from
  `main.tsx` before first paint, and `useLanguagePreference()`. Sets
  `<html lang>`.
- `app/src/locales/*.json`: `en`, `pt-BR`, `es`, `fr` with the strings
  moved so far; `es-ES` and `fr-CA` start empty and fall back to their
  base language.
- `format.ts` is fully translated: the Intl locale comes from
  `uiLocale()`, and its literals (today/yesterday/N days ago, just
  now/N minutes ago, Today/Tomorrow, never, Uncategorized) are i18n keys.
- Settings has a Language section: "Automatic · <detected language>" plus
  the six languages as chips.
- `i18n.test.ts` (15 tests): key parity, required plural forms per
  language from `Intl.PluralRules` (pt, es and fr all need `_many`), the
  detection and locale rules, and the regional fallback. Checked that
  the parity test fails when a key or a `_many` form is removed.
- Checked in headless Chromium at 390px: device locales en-CA, pt-BR,
  es-AR and fr-CA each pick the right Automatic language; picking
  Français switches the label and `<html lang>` right away and survives a
  reload; Automatic clears the stored value.
- Screens that don't call `useTranslation()` yet don't re-render on a
  language change. They pick it up when they next mount, which is fine
  because routes remount on navigation. Phase 2 adds `useTranslation()`
  to every screen, which removes this gap.
- Library versions: i18next 26 and react-i18next 17. The older majors
  declare a TypeScript ^5 peer and conflict with this repo's TS 6.

## Phases 2-3 status (2026-10-16)

Done together rather than in sequence: the parity test (D264) fails as
soon as a key exists only in English, so every key went in with its
pt-BR, es and fr text at once.

- Every screen and banner, plus the user-facing strings in `lib/`
  (`format.ts`, `syncNow.ts`'s last-synced text, `schedules.ts`'s
  `describeCadence`, `household.ts`, `manualMerge.ts`, `settings.ts`'s
  generic device names, `auth.ts`/`relayClient.ts` error messages), is
  translated: 526 keys in `en.json` (the other base languages have a few more because of their extra plural forms).
- Not translated on purpose: errors that come back from the server
  (`body.error`, phase 6), debugging-only errors ("Not signed in.",
  "Unexpected relay message"), the changelog (docs/59 D226), and
  `changelog.ts`'s en-US date format, which the website generator shares.
- Sentences with bold parts use `<Trans>` with named tags, so
  translators can move the bold part.
- Delete-account confirmation word is translated (EXCLUIR / ELIMINAR /
  SUPPRIMER); English DELETE is always accepted too.
- `describeCadence` uses Intl weekday/month names and i18next ordinal
  plurals for day numbers ("1st", French "1er"); the parity test checks
  ordinal (`_ordinal_*`) forms against `Intl.PluralRules({ type:
  'ordinal' })`.
- D266/D267 built: `lib/starterLabels.ts` (`categoryLabel`,
  `accountName`), used everywhere a category or account name is shown,
  including `accountLabel()` and `transactionTitle()`. The category and
  account edit forms start from the translated label and only write when
  the user edits. `starterLabels.test.ts` checks the scenarios from the
  user's requirement and that `en.json`'s starter labels equal
  `seed.ts`'s names.
- Home wordmark (docs/51 D190 closed): one natively written pool per
  language in `wordmarkPhrases.ts`, not line-by-line translations;
  regional variants share their base pool.
- Regional files: es-ES has 29 overrides (Añadir for Agregar, Ajustes,
  móvil, coche, a plazos, Apple's "Añadir a pantalla de inicio") plus
  starter-name differences (IBI, Luz, Aparcamiento, Aficiones, Guardería,
  Taxi y VTC…). fr-CA has "courriel" where the French base now says
  "e-mail", plus starter names (Épicerie, Loyer/Hypothèque, Magasinage,
  Essence…).
- Checked in headless Chromium at 390px for en-CA, pt-BR, es-MX, es-ES,
  fr-FR and fr-CA: 12 routes each, no raw keys in the page text, no page
  errors, starter categories in each language, and a typed entry
  ("45 mercado ontem") going through preview and save in Portuguese.
- Native `<input type="date">` and the time picker follow the device's
  own locale, not the app's. On a phone that's the system language;
  nothing to do in the app.
- `guessDeviceLabel()`'s generic fallbacks are translated when created.
  The value is saved and shown to other household members as-is,
  same as any device name.

## Phases 4-6 status (2026-10-16)

**Voice (phase 4).**
- `lib/voiceLanguage.ts`: the Voice language setting (`flowtab:voice-language`,
  removed for "Same as app"), `speechTagFor()` and `currentSpeechTag()`.
  Settings shows the section only where voice entry exists.
- D268 refined while building: a variant picked by region (pt-BR, es-ES,
  fr-CA) is sent exactly as picked. Only a base language (en, es, fr)
  takes the device's region, and never the other variant's (an es-ES
  phone with "Latinoamérica" picked still gets es-MX).
- D269 settled for iOS: `@capacitor-community/speech-recognition` 7.0.1
  ships no `Package.swift`, so it can't join this Swift Package Manager
  iOS project (docs/52). The Android app uses it (it builds against the
  app's own SDK 36 settings); iOS keeps WebKit's recognizer.
  `capacitor.config.ts`'s `ios.includePlugins` lists every other plugin,
  so new iOS plugins must be added there too. `cap update` for both
  platforms was run here: Android gained the plugin, iOS's
  `Package.swift` is unchanged.
- `speechInput.ts`: Android goes through the plugin (permission check,
  `start({ language, popup: false })`), web and iOS through Web Speech
  with `lang` set. The plugin's error texts map onto Web Speech's
  codes, and EntryZone now says why voice stopped (permission,
  language not available, network, not understood); "no speech" and
  "aborted" stay silent. Android has no separate "language not
  supported" error, so that case shows "Couldn't catch that".
- Checked in headless Chromium with a stubbed recognizer: UI in
  English, voice set to Português, the recognizer received `pt-BR` and
  "quarenta e cinco no mercado ontem" became $45 / Groceries /
  yesterday.

**Parser (phase 5).**
- `lib/parserVocab.ts`: one pack per language (numbers, joiners,
  articles, today/yesterday/day-before words, "last <weekday>"
  patterns, months and date shape, income words, merchant connectors,
  edge fillers, starter-category keywords, reserved words). D270's
  conflict rule as built: the input language's pack goes first, and
  its `reserved` words drop other languages' readings: es reserves
  "no", fr "sept", pt "dos"/"des", en "once".
- `parseUtterance` takes `language`, `categoryAliases` and
  `accountAliases`. EntryZone passes the voice language for speech and
  the UI language for typing, plus `starterCategoryAliases()` /
  `starterAccountAliases()` from `starterLabels.ts` (every language's
  starter names, for never-renamed rows only). The parser itself
  still imports no React or i18n.
- Built-in pack keywords match starter category ids directly, so
  existing installs get Spanish/French keywords without reseeding
  `category_keywords`. Pack keywords and aliases match whole words
  (accent-aware); the user's own names and saved keywords keep the old
  substring matching.
- Two behaviour fixes found while writing the tests: an article
  ("um café cinco", "un café cinco") is no longer read as the amount 1
  when another number word is present, and a group plus its own
  subcategory ("transporte uber") resolves to the subcategory instead
  of counting as ambiguous.
- Dates: each language's own shape is tried first ("15 de marzo 30" is
  the 15th, not English-style "marzo 30"). The French "16 août" shape
  only accepts French month names.
- `parser.test.ts`: 24 tests, the first tests the parser has had,
  across en/pt/es/fr plus the conflict rules.

**Outside the app (phase 6).**
- API: `POST /api/auth/request-link` takes `language`;
  `api/src/auth/emailTemplates.ts` has the email in en/pt/es/fr
  (regional variants share their base), English for anything else.
  User-facing auth errors now carry a stable `code` (`link_invalid`,
  `code_invalid`, `device_link_expired`, `sign_in_again`,
  `not_owner`) next to the English `error`. Checked by rendering
  every language with tsx; the API has no test runner.
- App: sends `i18n.language` with the link request, and `auth.ts`'s
  `serverError()` shows translated text for known codes and the
  caller's translated fallback otherwise. It never shows the server's
  English sentence.
- iOS: `InfoPlist.strings` in `pt-BR.lproj`, `es.lproj` and `fr.lproj`
  for the camera, microphone and speech prompts, registered in
  `project.pbxproj` (variant group, Resources phase, `knownRegions`).
  Checked by parsing the project with the `xcode` npm package; not yet
  built in Xcode.
- Android: nothing to add. Its permission dialogs are system text in
  the phone's language, and the only app string is "Flowtab".

**Not verified yet (needs a phone):** the Android plugin actually
recognizing speech, the iOS prompts appearing translated, and a real
email send in each language.

## Fixes from real-device testing (2026-10-16, after 0.6.0)

The user tested the home-screen PWA on two iPhones (XR, 12) with the app
in Português:

- **Voice froze after a failed attempt.** After a session that heard
  nothing, every later tap showed "listening" and never answered. The
  cause: docs/16 D149's single reused `SpeechRecognition` instance stops
  responding on iOS after a no-result session. `speechInput.ts` now runs
  one session per tap. A session that ends without a result (nothing
  heard, an error, or a new 15-second watchdog) discards the instance,
  so the next tap starts a fresh one. A successful session or a cancel
  the user tapped keeps the instance, so D149's "no repeat prompt"
  still holds while things work. Late events from a discarded instance
  are ignored. "Nothing heard" now shows "Didn't hear anything" instead
  of the silence that read as a frozen app. `speechInput.test.ts`
  covers this with a fake recognizer, including one that never answers.
- **"cem dólares em combustível" saved as reais.** iOS's Portuguese
  dictation writes it as "$100 em combustivel", and a bare "$" was
  deliberately ambiguous (docs/10), so the account's BRL default won.
  Packs now have `speechDollar`; Portuguese sets USD, since its
  dictation writes reais as "R$". It applies only to speech
  (`fromSpeech` from EntryZone). Typed "$" and other languages are
  unchanged: Spanish "$" is pesos in Mexico, and French "100 $" is CAD
  in Canada.
- Not yet confirmed on a phone: that the fresh instance actually
  revives the mic on iOS. If iOS still stalls, the watchdog at least
  ends the session after 15 seconds with a message.

## Dollars, preview pickers, voice chip (2026-10-16, after 0.6.1)

Real report: voice set to English, "15 dollars in ice cream" (iOS wrote
"$15 in ice cream") saved as R$ 15. English "dollars" wasn't a currency
marker at all, and a bare "$" was deliberately ambiguous (docs/10). So
the account's default, BRL, won, which is clearly wrong when the
person said dollars.

- **D272** (reopens docs/10's "a bare dollar stays ambiguous", agreed
  with the user 2026-10-16): "dollars", "bucks" or a bare "$" with no
  country is *some dollar*. The parser returns `dollarFamily: true`;
  EntryZone resolves it as (1) the account's usual currency if it's
  already a dollar, (2) else the dollar currency used most recently,
  (3) else the per-device **Dollars ($) mean** setting (`lib/dollar.ts`,
  `flowtab:default-dollar`; defaults to CAD on a Canadian device
  region, USD otherwise). The preview marks it "which dollar? tap to
  change". New explicit markers: canadian dollars / dollars canadiens /
  dólares canadenses / canadienses → CAD; american / US dollars /
  dollars américains / dólares americanos → USD. Plain "dólares" stays
  USD. A bare "$" per language (`dollarSign` in each pack): pt typed =
  some dollar, pt speech = USD (iOS dictation, see the fix above);
  es = nothing (pesos); en and fr = some dollar.
- **Preview pickers.** The "Understood" panel's currency and account
  are `AccountCurrencyPicker` pills, so either can be fixed before
  saving. This closes the 2026-10-06 backlog item. A currency that was
  said or picked survives an account change; a defaulted one follows
  the account. The picker's buttons now carry `type="button"` (inside
  EntryZone's form they would have submitted it).
- **Voice language chip** next to the mic (EN, PT, ES-ES, FR-CA…). It
  opens the language list as a row inside the entry card; a floating
  popover was clipped by `.entry-zone`'s `overflow: hidden`. Picking a
  language mid-listen aborts and restarts in the new language; a
  session counter in EntryZone ignores the aborted session's late
  callbacks.
- **Snacks keywords** in all four packs (ice cream, sorvete, picolé,
  helado, botanas, glace, crème glacée, grignotines…).
- **Empty names**, found from the same screenshot ("Cash —", no
  "default" badge). An account whose name was cleared in the edit form
  matched every entry, because every text contains "". The parser now
  skips empty account, category and merchant names, and `accountLabel()`
  shows just the institution when the name is empty.
- Checked in headless Chromium with a stubbed recognizer: the session
  started in pt-BR and restarted in en-US after switching mid-listen;
  "15 dollars in ice cream" became a guessed dollar under Snacks; the
  pill changed it to USD and it saved. 195 tests.
- **D273** (the user said yes, same day): amounts used `narrowSymbol`,
  so CAD and USD both showed as "$". Once more than one dollar currency
  is in use on the device (transactions, budgets, scheduled payments),
  `formatAmount()` swaps the symbol for an explicit one (CA$, US$, A$,
  NZ$, S$, HK$, `DOLLAR_SYMBOLS` in `lib/dollar.ts`) through
  `formatToParts`, so each locale keeps its own order and spacing
  ("US$ 15,00" pt-BR, "15,00 CA$" fr). With a single dollar currency it
  stays "$". StoreProvider calls `setDollarCurrenciesInUse()` before
  rendering its children. Checked in headless Chromium: "-$15.00" with
  one CAD entry, then "-US$20.00 · -CA$15.00" after adding a USD one.

### Glossary

One word per concept, so the same thing reads the same everywhere:

| en | pt-BR | es | fr |
|---|---|---|---|
| transaction / entry | lançamento | movimiento | opération |
| account | conta | cuenta | compte |
| category | categoria | categoría | catégorie |
| budget | orçamento | presupuesto | budget |
| scheduled payment | pagamento agendado | pago programado | paiement programmé |
| household | família | hogar | foyer |
| device | dispositivo | dispositivo | appareil |
| sign in / sign out | entrar / sair | iniciar / cerrar sesión | se connecter / se déconnecter |
| expense / income | despesa / receita | gasto / ingreso | dépense / revenu |
| sync | sincronização | sincronización | synchronisation |
| Settings | Configurações | Configuración (es-ES Ajustes) | Paramètres |

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
| D272 | "Dollars", "bucks" or a bare "$" with no country is some dollar: the account's usual currency if it's a dollar, else the most recently used dollar, else the per-device Dollars ($) mean setting (CAD on a Canadian region, else USD). Shown as a guess in the preview, changeable there. A bare "$" means nothing in Spanish (pesos) and USD in Portuguese speech. Reopens docs/10's "bare dollar stays ambiguous". | A real entry said "dollars" and saved as reais; picking among dollars, visibly, beats a confidently wrong currency. |
| D273 | Once more than one dollar currency is in use on the device, every dollar amount shows its explicit symbol (CA$, US$…); with one, plain "$" as before. | Someone spending in CAD and USD couldn't tell "$15" entries apart. |

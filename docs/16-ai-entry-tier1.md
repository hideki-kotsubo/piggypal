# 16 — Tier 1 Local Parser + Voice Input

## The problem

Docs/04 specs a two-tier entry pipeline, but until now zero of it existed
in code: `format.ts` had only display formatting, `category_keywords` was
a fully unused table, and `EntryZone`'s typed-text box was a stub that
just toasted "isn't wired up yet." That leaves free-tier users (and anyone
offline) with tap-entry as the only real input path. This closes the
Tier 1 half for real — free, offline, on-device — plus voice as a thin
input layer on top, matching the backlog's "Voice input, simple version"
item.

## Scope for this pass — Tier 1 only, merchant stays out, learning loop deferred

- **No Tier 2 changes.** The server LLM path (docs/04's `/api/parse`) is
  still fully unimplemented — this doc doesn't touch it.
- **Merchant/location extraction stays out of scope.** Discussed directly:
  open-vocabulary proper nouns are a materially fuzzier extraction problem
  than the closed vocab below, and a wrong guess is worse than a blank
  field — the same reasoning docs/15 D77 already used to keep merchant
  Tier-2-only. Flagged as a real possible future extension, not
  attempted here.
- **The docs/04 learning loop is deferred.** This pass seeds and *reads*
  `category_keywords`; it does not write new keywords back when a user
  corrects an Inbox item. A real, separate piece of future work.
- **The docs/04 dedupe guard is deferred** (same amount+date within 2
  minutes → "looks like a duplicate?").

## `parser.ts` — a pure, closed-vocabulary module

`app/src/lib/parser.ts` has no React/store imports. `parseUtterance(text,
ctx)` returns `{ amountCents, direction, currency, occurredAt, categoryId,
accountId }` — every field nullable except `direction`, and null means
"caller applies its own default," never a guess:

- **Amount**: digit forms first (`R$45,00`, `45,00`, `45.00`, `45`,
  `$18.40`) — a bare integer "45" → 4500 cents, matching docs/04's
  tool-schema description verbatim. A small bilingual number-word table
  (1–19 + tens, "quarenta e cinco"/"forty five") is a fallback only when
  no digits appear — whole-dollar amounts only, no cents from word form.
- **Currency**: explicit symbol/word map only (`r$`/reais→BRL,
  `¥`/ienes/yen→JPY, `€`/euros→EUR, us$/usd/dólares→USD, cad/c$→CAD). A
  bare `$` matches nothing → falls through to the caller's default, per
  docs/04's "never infer from amount size or vocabulary alone."
- **Date**: closed set only — hoje/today, ontem/yesterday, anteontem,
  "last <weekday>" (en) / "<weekday> passada" / "última <weekday>" (pt).
  No match → `null`, caller uses now.
- **Category**: matches `category_keywords` plus each category's own bare
  name, substring-contains against the full utterance. Exactly one
  distinct category matched → that id; zero or two-or-more → `null`
  (never-guess, same rule docs/04 already uses for Tier 2).
- **Account**: exact-name matching only, no fuzzy matching (docs/04
  verbatim). An utterance naming both an account's institution and its
  bare name ("no Visa do TD") is trusted even when the bare name alone is
  shared by another account elsewhere; bare-name-only matches are trusted
  only when exactly one account carries that name. No match → `null`,
  caller falls back to `store.defaultAccountId()`.
- **Direction**: defaults `expense`; a small bilingual income-trigger list
  (recebi, salário, deposit, received, got paid, paycheck, income) flips
  it.

## `category_keywords`: seeded, not learned yet

The table existed in schema since docs/03 but had zero rows and zero
readers anywhere in the app. `seed.ts` now ships a small bilingual starter
vocabulary (`seedCategoryKeywords`) across a handful of leaf categories —
not exhaustive, same "starter, not full taxonomy" spirit as
`seedCategories` itself — so the parser has something to match against on
a fresh account. `store.tsx` reads the table into `store.categoryKeywords`
via a `db.watch`, alongside the existing four.

## `EntryZone`'s typed submit: parse, insert, or degrade to Inbox

`submitTyped` no longer shows the stub toast. It calls `parseUtterance`
and:
- **No amount found at all** → soft-blocks: shows a toast, doesn't insert,
  leaves the text in the field to edit. Docs/04's literal failure-mode
  table says "save raw utterance as draft," but there's no draft concept
  anywhere in the schema (`amount_cents` is `NOT NULL`) — this is a
  deliberate, flagged deviation from that literal wording.
- **Amount found, category ambiguous/unmatched** → inserts anyway
  (`source: 'ai'`, `aiRaw: <original text>`, `categoryId: null`), which
  lands it in the existing uncategorized-inbox flow (docs/07) with zero
  Inbox-side changes needed — exactly docs/04's "never blocks, worst case
  lands in inbox" principle.
- **Amount and category both resolve** → inserts directly, `note` set to
  the resolved category's name — matching the existing seed-data
  precedent for AI-sourced rows (`note = category.name` when categorized,
  `null` when not), so `RecentList`'s note-based row label doesn't show
  "Uncategorized" for a successfully-parsed entry.

Unlike tap-entry's post-submit auto-navigate (docs/17), typed/voice entry
keeps the toast+undo pattern (`onSubmitted('Added'` or `'Added to your
inbox — needs a category', undoFn)`) — it doesn't get an auto-navigate
behavior in this pass, so the two `EntryZone` submit paths now genuinely
differ in post-submit UX by design.

## Voice: a thin layer, no separate parse path

A mic button next to the typed-entry field (feature-detected, hidden
entirely when unsupported — a real gap on desktop Firefox) uses the
browser's built-in `SpeechRecognition`/`webkitSpeechRecognition` to
transcribe speech straight into the same text field. There is no separate
voice-parsing path — whatever lands in the field gets parsed by
`parseUtterance` exactly the same way typed text does.

**Worth knowing, not a blocker**: despite costing nothing on our side,
most browsers' built-in speech recognition still round-trips through the
browser vendor's own cloud service — this isn't genuinely offline
speech-to-text, just free of *our* AI cost. A fully offline in-browser
model is a much bigger undertaking and out of scope here. Recognition
language defaults to `navigator.language` (best-effort — no language
toggle exists yet, docs/09 is spec-only) rather than the UI's own
hardcoded `en-CA` display locale.

**iOS re-prompting the mic every tap, fixed 2026-08-17 (D149)**: reported
on real hardware. Root cause — `startSpeechInput` constructed a fresh
`webkitSpeechRecognition` instance on every tap. Chrome ties the mic grant
to the origin (matters not at all there), but Safari doesn't reliably do
that for `SpeechRecognition` specifically — the grant behaves as if it's
scoped to the instance, not the origin, so a new instance each tap looked
like a never-before-seen consumer. Fixed by reusing one module-level
instance across taps (the standard mitigation for this WebKit quirk),
reconfiguring its handlers before each `start()` rather than constructing
new. A fast abort-then-immediately-retap can race ahead of the previous
session's `end` event and throw `InvalidStateError` on a reused instance
that still thinks it's active — caught, and falls back to a fresh instance
for that one tap rather than leaving the mic button dead. Flagged
honestly: this mitigates a platform limitation, it isn't a guaranteed fix
across every iOS/Safari version.

## Merchant matching, and saving what wasn't recognized (D150)

Two related gaps closed together, 2026-08-17, backlogged the day before:
Tier 1 never attempted merchant identification (D92), and everything the
parser couldn't map to a structured field was silently discarded —
`confirmPreview` wrote `note: category?.name ?? null`, never the leftover
words.

**Merchant**: closed-vocabulary, same never-guess principle as
category/account matching above — `matchMerchant` only recognizes a
merchant the user has already used at least once (`store.rankedMerchants()`
passed in as `ctx.merchants`), never invents a name it's never seen. This
narrows D92/docs/15 D77 rather than overturning them: *open*-vocabulary
merchant extraction (spotting a brand-new merchant on first mention) is
still Tier 2/AI territory, unbuilt; recognizing an *already-known* one is
squarely Tier 1's kind of problem, the same closed-vocabulary shape as
everything else in this file. Shown in the parse-preview panel as a
"Merchant" row, only when one was actually recognized — no "defaulted"
state exists for it the way currency/account/date have one, since there's
nothing to default an optional field to.

**Unrecognized leftover**: every extraction function now also records the
text span (`[start, end)` offsets) it matched, threaded through
`parseUtterance` as it runs. Once every field's been extracted, the
original text minus every recognized span — sorted, cursor-merged so
overlapping spans (a category keyword and a merchant name sharing a word,
say) don't get double-counted — is what's left: `"costco 45 groceries with
mom"` recognizes the merchant, amount, and category, leaving `"with mom"`.
That leftover becomes the transaction's `note` (`null` if nothing's left,
i.e. the whole utterance was recognized), replacing the old category-name
copy — which is safe because docs/07 D148's list-row fallback (note →
category name → "Uncategorized") already exists and picks up exactly that
slack when `note` is null. The full original utterance is untouched in
`aiRaw` regardless, so nothing is ever actually lost even if a span gets
mis-computed — `note` is a nicety on top, not the only copy.

## Absolute date/time, and a guessed-merchant exception (D151)

Reported the day after D150 shipped, against a real bank-notification-
style input: `"Purchase of $10.61 at amazon.CA Toronto Can on August
16th, 2026 at 5:25PM (PDT)."` parsed as amount-only — no date (only
relative keywords existed: hoje/ontem/anteontem/last-weekday), no
merchant (amazon.CA had never been used before, so D150's closed
vocabulary correctly had nothing to match), and the whole tail became an
undifferentiated leftover note.

**Absolute date + time**: `resolveAbsoluteDate` adds a closed, bilingual
month-name vocabulary ("August 16th, 2026" / "16 de agosto de 2026") —
still a fixed vocabulary lookup, not open-ended date parsing, the same
shape as the relative-keyword matching it sits beside. A separate
`resolveTimeOfDay` pass recognizes a clock time ("5:25pm", "17:25")
independently and overrides whatever date was resolved (or today's, if
only a time was given) — so a date alone, a time alone, and both together
all resolve sensibly from one shared base. A parenthesized timezone
abbreviation ("(PDT)") is recognized and stripped from the leftover text
but never used for conversion — this app already treats every date/time
as the literal wall-clock value the user means (`nowLocal()`, `format.ts`
D-numbers on UTC-vs-local elsewhere), so "5:25PM (PDT)" is taken as
literally 5:25pm, not converted to the device's own zone.

Fixing this exposed a real ordering bug: `extractDigitAmount` ran before
date/time resolution and just grabbed the first digit sequence in the
whole text — for a day-first date ("16 de agosto..., 45 no mercado") or a
time before the amount ("at 5:25pm I spent 45"), that's the date's day
number or the time's digits, not the real amount. Fixed by resolving
date/time first and having amount extraction skip any digits already
claimed by a span (`spans.some(...)` overlap check, same technique
`guessNewMerchant` below already used).

**A guessed merchant, the one deliberate exception to "never guess"**:
`guessNewMerchant` grabs a single token right after "at"/"no"/"na"
(en/pt), only when it has a proper-noun-ish signal (starts uppercase, or
contains a "." like a domain — "amazon.CA" doesn't start uppercase but
does have the dot) — a narrow heuristic, not the closed-vocabulary
guarantee the rest of this file gives. Deliberately a *single* token, not
a greedy multi-word capture: "amazon.CA Toronto Can" has no reliable way
to separate merchant from city from country abbreviation without real
NLU, and under-capturing (missing a multi-word merchant name) is a much
safer failure mode than over-capturing filler into the guess. What makes
attempting a guess safe at all despite the never-guess rule everywhere
else: the docs/22 parse-preview panel already gates every field behind an
explicit Save, including "defaulted" currency/account/date — a guessed
merchant reuses that exact gate (`merchantGuessed: true`, shown with the
same badge styling as a defaulted field, editable by hitting Edit) rather
than writing anything silently. Its span is claimed like every other
recognized field, so it disappears from the leftover note too instead of
showing up twice.

Verified: `tsc`/`oxlint` clean. The exact reported input, run through the
real seeded app end to end — Amount -$10.61, When "2 days ago, 5:25 p.m."
(matching August 16 5:25pm against the real test date), Merchant
"amazon.CA" marked guessed, saved note "Purchase of $ at Toronto Can" (no
merchant-name duplication). A battery of pure-function cases confirmed:
the day-first pt-BR date no longer corrupts the amount (was reading "16"
as $16.00, now correctly $45.00), a bare time with no date defaults to
today, a lowercase non-name word after "at" ("arrived at work") is
correctly never guessed, and a known merchant (docs/16 D150's closed-
vocabulary path) is unaffected — still a confirmed match, not a guess.

## Decisions locked in this doc

| # | Decision | Why |
|---|---|---|
| D90 | Tier 1 is a pure `parser.ts` module, closed-vocabulary throughout, never-guess-degrades to `categoryId: null` | Matches docs/04's own "ambiguity degrades to friction, never data loss" principle; a pure module with no store/React imports is easy to reason about independent of the UI that drives it |
| D91 | `category_keywords` is seeded with a small starter bilingual vocabulary and read in this pass; the docs/04 learning loop (writing corrections back) is explicitly deferred | The parser needs something to match against on a fresh account; writing back corrections is a distinct, separable piece of work not required to make Tier 1 useful |
| D92 | Merchant/location extraction stays out of scope for Tier 1, flagged as a real possible future extension | Same reasoning as docs/15 D77 — open-vocabulary proper nouns are a fuzzier problem than the closed category/account/date vocab above. **Narrowed by D150**: *closed*-vocabulary merchant matching (already-known merchants only) is in Tier 1 now; genuinely open-vocabulary extraction is still out of scope |
| D93 | Voice input is a thin Web Speech layer that only populates the existing text field — no separate parse path; genuinely-offline STT is out of scope | Reuses the exact same Tier 1 parser typed input already goes through; a fully offline model is a much bigger undertaking than this pass |
| D94 | Unparseable-amount input soft-blocks with a toast (text stays editable) rather than docs/04's undefined "draft" concept | `amount_cents` is `NOT NULL` in the schema — there's no draft row shape to save into |
| D149 | `speechInput.ts` reuses one `SpeechRecognition` instance across taps (module-level, reconfigured per call) instead of constructing fresh each time | Fixes iOS Safari re-prompting for mic permission on every tap — its grant behaves as scoped to the instance rather than the origin, unlike Chrome and unlike Safari's own `getUserMedia` behavior |
| D150 | `parser.ts` gains closed-vocabulary merchant matching (against `store.rankedMerchants()`, never an unseen name) and every extraction function now records the text span it matched, so `parseUtterance` can compute whatever's left over; that leftover becomes `note` instead of a copy of the category name | Merchant: narrows D92/docs/15 D77's Tier-1-never-guesses-merchant call to "never guesses an *unseen* one" — recognizing an already-known merchant is closed-vocabulary, the same shape as category/account matching. Note: nothing the user said should be silently thrown away when it doesn't map to a structured field; docs/07 D148's fallback already covers the case where there's no leftover to show |
| D151 | Absolute month-name dates and a clock time are now parsed (bilingual, closed vocabulary); a single proper-noun-ish token after "at"/"no"/"na" is guessed as a new merchant when no known one matches, flagged `merchantGuessed: true` rather than written silently; amount extraction now skips digits already claimed by a date/time span | Date/time: same closed-vocabulary shape as the rest of the file, just a bigger fixed vocabulary (month names) than before. Merchant guess: the one deliberate exception to never-guess, made safe by reusing docs/22's existing preview-then-Save confirmation gate rather than inventing a new one — under-capturing (a single token) is a safer failure mode than over-capturing location/date words into the guess. Amount-skip: a day-first date or a pre-amount time would otherwise have its own digits mistaken for the amount |

**Implemented 2026-08-12.**

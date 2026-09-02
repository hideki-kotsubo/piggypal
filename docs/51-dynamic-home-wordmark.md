# 51 — Dynamic Home Header Wordmark

## The idea

Flagged 2026-09-01: the Home app-bar's static `"piggypal"` label
(`App.tsx`, top-left, next to the Insights/Settings icons) felt like
wasted space for a line that never changes. Replace it with a rotating
pool of short phrases/taglines instead of the app name.

## The fix

**`app/src/lib/wordmarkPhrases.ts`** — two string pools and one picker.
`GENERAL_PHRASES` (~54 lines, spanning classic-idiom, private/offline,
voice-first, tactile-calm, punchy, and zen-mantra registers — kept as a
single mixed pool per the user's call, not narrowed to one tone) and
`HOUSEHOLD_PHRASES` (~16 couple/household-flavored lines — "Whose turn
was it anyway?", "Two under one roof," etc.). `pickWordmarkPhrase(hasHousehold)`
returns a random pick from `GENERAL_PHRASES`, or the combined pool once
a household is real.

**`App.tsx`** — `hasHousehold(useHouseholdPeers())` (docs/38's existing
household-detection hook, reused as-is, no new plumbing) gates the pool;
`useMemo(() => pickWordmarkPhrase(household), [household])` picks once
per Home mount and only re-picks if `household` itself flips (e.g. store
data finishes its first load after initial paint) — not on a timer.
`piggypal` no longer appears in the rotation at all; the ask was to
replace the wordmark, not supplement it.

**`home.css`** — `.wordmark` gained `min-width: 0`, `overflow: hidden`,
`white-space: nowrap`, `text-overflow: ellipsis`; `.app-bar-actions`
gained `flex-shrink: 0`. The static word "piggypal" never came close to
the app-bar's available width; several rotated phrases (the longest is
39 characters) do, especially at narrower phones (iPhone SE-class,
375px). Without this, a long phrase would either wrap to a second line
or shove the Insights/Settings icons off-canvas; with it, the wordmark
shrinks first and truncates with an ellipsis, icons untouched.

## Decisions locked in this doc

| # | Decision | Why |
|---|---|---|
| D188 | The wordmark is *replaced*, not supplemented — "piggypal" is not in the rotation pool, and re-picks once per Home mount rather than on an interval | Matches the literal ask ("instead of the app's name"); a ticking header on a finance app's most-visited screen reads as a gimmick, not a feature |
| D189 | `HOUSEHOLD_PHRASES` only enter the pool once `hasHousehold()` is true, reusing docs/38's `useHouseholdPeers()` unchanged | A solo user (the common case today) seeing "whose turn was it anyway?" with no one to mean is confusing, not charming — same gating principle docs/26/38 already applied to the payer/owner UI itself |
| D190 | Phrase pool is English-only for now — a flagged exception to docs/09 D31's full pt-BR + English UI decision, not a silent gap | No pt-BR phrase set exists yet; several English idioms in the pool ("Chalk it up," "Off the grid, on the record") don't translate cleanly, so a real pt-BR pass needs its own pass rather than a mechanical translation — tracked in docs/00-backlog |

## Still open

- No pt-BR phrase set (D190) — tracked in docs/00-backlog.
- The phrase pool itself is a first draft (~64 lines after the same-day
  trim below) — no usage data exists yet on which tones/lines land vs.
  feel off; expect this list to get trimmed or extended once someone's
  actually seen it rotate day to day.
- Three borderline lines ("Purely yours," "Just between us," "Resting
  safely in the pouch") were flagged during review as weaker,
  arguable privacy-adjacent claims but deliberately left in — the user
  asked only for the six confirmed overclaims below to be cut.

**Same day, revised**: six `GENERAL_PHRASES` lines were found to
overclaim once checked against docs/41-43's real sync/auth
architecture — "Zero eyes, pure privacy," "No prying eyes, just quiet
records," "Stored right here," "Stored in peace, right here," "Off the
grid, on the record," and "Off the wire" all assert the data never
leaves the device or is never seen by anyone else, which is only true
for the free/local-only tier — once someone signs in, transactions
genuinely upload to a real Postgres server via PowerSync. Removed
rather than reworded, at the user's request.

**Implemented 2026-09-01.** Verified: `tsc -b`/`oxlint` clean on `app`.
Headless-Chromium (Playwright) pass against the live dev server —
confirmed the wordmark shows a rotated phrase (not the literal string
"piggypal") and changes across repeated loads of `/`; confirmed no
solo-user (no household) load ever showed a `HOUSEHOLD_PHRASES` line
across 7 sampled loads; confirmed the longest pool phrases render with
no icon overlap at both 390px and 375px viewports, ellipsis-truncating
correctly once box width is deliberately squeezed. Not verified: real
two-person household data actually surfacing `HOUSEHOLD_PHRASES` end to
end (would need a real paired/synced second identity, not fabricated
here) — the gating logic itself is the same already-verified
`hasHousehold()`/`useHouseholdPeers()` docs/38 already ships.

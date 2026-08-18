# 30 — Naming This Device for P2P Sync

## The problem

Docs/25's P2P pairing labels each side of a sync purely from
`guessDeviceLabel()`'s UA sniff — "iPhone", "Android device", "Mac", and
so on. Reported directly: this breaks down as soon as someone owns more
than one device of the same guessed type (two iPhones, a Samsung and a
Pixel both reading "Android device") or pairs with another person whose
device guesses identically to their own ("iPhone" on both sides of a
spouse/partner pairing) — Settings' paired-devices list (docs/25 D138)
has no way to tell those apart.

## The fix

**A per-device custom name, sent instead of the raw guess.**
`app/src/lib/settings.ts` gains `guessDeviceLabel()` (moved here from
`PairingScreen.tsx`, unchanged), a `DEVICE_LABEL_KEY` localStorage entry,
and two exports: `useDeviceLabel()` for the Settings input (mirrors the
raw stored value, including empty, so the field can be cleared back to
the placeholder without snapping back mid-edit — the same local-mirror
lesson docs/00-backlog's account-edit-form bug already taught this
codebase) and `effectiveDeviceLabel()` (custom label if set, else the UA
guess) for actual use at pairing time. `PairingScreen.tsx`'s
`exchangeHello` call now sends `effectiveDeviceLabel()` instead of a
fresh `guessDeviceLabel()` call — an unrenamed device behaves exactly as
before, and a renamed one sends its real name instead.

Settings gained a "This device's name" text field at the top of the Sync
section (`.text-input`/`.field-label`, same pattern as AccountsScreen's
Institution/Name fields), placeholder text showing the live UA guess so
an unrenamed device still shows what it'll be called. Nothing on the
*receiving* side needed to change — `peers.ts`'s `recordSync` already
upserts a peer's label on every sync (docs/25 D138's "in case a device's
guessed name changed"), so a renamed device's new name propagates to
anyone who re-syncs with it, no extra plumbing.

Deliberately out of scope, same as docs/25's existing "peer management
beyond a bare list" gap: renaming an *already-paired peer* locally
(independent of what they call themselves) isn't built here — this pass
only lets a device name itself for others, not let others locally
override that name. Left in the backlog if it turns out to still be
wanted once this is in use.

## Decisions locked in this doc

| # | Decision | Why |
|---|---|---|
| D157 | This device's name is user-editable in Settings, stored local-only (`localStorage`, never synced), falling back to the existing UA guess when unset/cleared | Directly fixes the reported ambiguity (two iPhones, spouse's identically-guessed phone) with the smallest change — reuses the exact label already flowing through `exchangeHello`, no new protocol field |
| D158 | Renaming the peer's *displayed* name locally (independent of their own chosen name) is not built in this pass | Docs/25 already flagged general peer management as unbuilt; this pass solves the reported case (name your own device) without expanding scope into a second, different feature |

**Implemented 2026-08-18.** Verified: `tsc -b`/`oxlint` clean; Settings'
new field screenshotted end-to-end against the real running dev server
(typing, clearing back to the placeholder with no value snap-back, and
persisting across a reload, confirmed via `localStorage` read directly).
Not verified: an actual two-device WebRTC pairing showing the custom name
on the peer's side — needs two real devices/browser contexts exchanging
a live offer/answer, not reproducible in this environment. The one-line
`exchangeHello` call site change was traced directly instead.

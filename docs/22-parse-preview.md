# 22 — Parse Preview: Confirming Tier 1's Reading Before It Writes

## The problem

Reported 2026-08-13: **"I see the transcript of what I said but the app
doesn't save the new entry."**

Not a parser bug — a missing commit affordance. `speechInput`'s `onResult`
only called `setTypedText(transcript)` (docs/16 D93: "voice only populates
the existing text field"), and the sole thing that submitted the entry zone
was the form's `onSubmit`, i.e. pressing Enter *inside* the input. There was
no submit button anywhere in the entry zone.

So after speaking, the transcript sat in the field with no way to commit it
unless the user tapped the field to raise a keyboard and hit Enter — which
defeats the entire point of the hands-free path. D93 was doing exactly what
it said; the gap was that the text field had no submit affordance for any
path that doesn't involve typing.

## What was chosen instead of a bare submit button

A plain submit button would have fixed the bug. The user asked instead for
the parse-preview treatment from
`docs/artifacts/piggypal-location-field.html`'s frame 1 — show what the
parser understood, then confirm — which fixes the same bug (**the confirm
button *is* the commit affordance**) while also surfacing Tier 1's reading
before anything is written.

That second half matters more than it looks. Tier 1 resolves five fields
from one utterance, and until now the user's only signal about how it read
them was the row that appeared afterward. Voice adds a whole extra layer of
uncertainty on top — a mis-transcription and a mis-parse produce the same
symptom, and the user couldn't tell them apart.

## Behavior

`EntryZone` gained a `Preview` state. On submit (Enter) or on a voice
transcript, `buildPreview()` parses, resolves defaults, and renders a panel
inside the entry zone's own sunken card (docs/21 — no fill of its own, just
a top hairline):

| Row | Shows |
|---|---|
| Amount | signed, currency-formatted |
| Category | resolved name, or "Uncategorized — goes to your inbox" in a `--warn` tone |
| When | relative date ("yesterday") |
| Account | `accountLabel()` |

Each row carries a small uppercase `default` marker when the value came from
a store fallback rather than the utterance. This is the point of the panel:
a defaulted account presented identically to a spoken one would be exactly
the silent guess the never-guess principle exists to prevent.

- **Save** → writes the transaction (`source: 'ai'`, `aiRaw` = the original
  utterance), clears the field, keeps the existing toast + undo.
- **Edit** → dismisses the panel, leaves the text in the field.
- **Editing the text** dismisses the panel too, rather than leaving a stale
  parse of older wording on screen.
- **No amount found** still soft-blocks with a toast and no panel (docs/16
  D94 unchanged) — there's nothing to confirm.

## Recording indicator

Requested in the same session. The mic button's existing `listening` state
was a static accent fill, which read as "selected" more than "live" — speech
capture is time-bounded, so the cue needs to move. While listening:

- the button carries a breathing halo (`box-shadow` spread, 0 → 4px);
- the input's placeholder switches to "listening…";
- a `role="status"` live region announces "Listening" (with a new `.sr-only`
  utility — the stylesheet had no screen-reader convention before this).

**The 4px spread is a measured ceiling, not a taste call.** The first
attempt was a ring expanding to 1.9× scale, which clipped visibly: the
button sits ~5.7px below `.entry-zone`'s top edge and ~7.4px inside its
right edge, and the zone is `overflow: hidden` for its rounded corners
(docs/21). Anything larger gets cropped flat. Rather than drop that
`overflow: hidden`, the cue was sized to the clearance that exists.

The halo colour is `color-mix(in srgb, var(--accent) 45%, transparent)`
rather than `--accent-soft` — that token sits nearly on top of
`--surface-sunken` behind it, so the halo washed out. This matters most
under `prefers-reduced-motion`, where the halo holds still and is the only
remaining live-vs-idle signal.

## Both paths, not just voice

Typed entry no longer inserts directly on Enter; it goes through the same
preview. That's a deliberate behavior change to docs/16, on two grounds:
D93's "no separate parse path" principle argues against voice and typing
diverging at the commit step, and the preview's value (seeing which fields
were understood vs defaulted) applies equally to typed input.

The cost is one extra tap on the typed path, against docs/01's <3s manual
entry target. Flagged rather than hidden: if that tap proves annoying in
real use, making the preview voice-only is a small change — the preview is
built by the same `buildPreview()` either way.

## Decisions locked in this doc

| # | Decision | Why |
|---|---|---|
| D95 | Tier 1 parse results are confirmed in an inline preview before insert, not written directly | Voice had no commit affordance at all (the reported bug); and a five-field parse from one utterance deserves a visible reading before it becomes a row |
| D96 | The preview marks which values were parsed vs defaulted | A defaulted account shown identically to a spoken one is the silent guess that docs/04's never-guess principle exists to prevent |
| D97 | Typed entry goes through the same preview as voice, accepting one extra tap against the <3s target | D93's "no separate parse path" — the two inputs shouldn't diverge at the commit step. Reversible to voice-only if the tap proves annoying |

**Implemented 2026-08-13.**

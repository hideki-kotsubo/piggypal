# 28 — Relay-Assisted Pairing

## The problem

docs/25's QR-code signaling only works when both devices are physically
together — one screen showing a code, the other's camera reading it.
Asked directly: why can't remote pairing (partner traveling, second
device not in the room) work too? Answered in chat, designed here:
a lightweight signaling relay, available to every tier (the user's
explicit call — no auth, no billing, since the relay never touches
financial data and the privacy/cost argument for keeping it server-free
is much weaker than it is for the sync/AI paid gates).

This is the first real feature on `api/` — everything there today is a
`/health` route.

## What the relay is, and isn't

It brokers exactly one thing: the WebRTC offer/answer exchange (a few KB
of connection-setup text), for exactly as long as it takes two devices to
find each other. It never sees, stores, or has any concept of budgeting
data — once the data channel opens, everything flows directly
device-to-device exactly as it already does over QR (docs/24/25's merge,
identity unification, all of it, completely unchanged). The relay's only
job is replacing "show a QR, scan a QR, show a QR back" with "read this
code aloud, type it in" when the two devices aren't in the same room.

## Room protocol

WebSocket, in-memory rooms keyed by a short code the *initiating* device
generates client-side (`crypto.getRandomValues()`, 8 characters from a
32-symbol alphabet excluding visually ambiguous characters — `0/O`,
`1/I/L` — shown as `XXXX-XXXX`). 8 characters from 32 symbols is
~1.1 trillion combinations; combined with a short room TTL and
per-IP rate limiting on join attempts, brute-forcing an active code
within its lifetime is infeasible.

```
Device A                    Relay                    Device B
--------                    -----                    --------
connect, {create, code} --->
                             (room created, waiting)
pairing.startOffer() ------------------------------->  (device A's own
{signal, offerPayload} --->                             WebRTC mechanics,
                             (buffered until B joins)    unchanged from
                                                          docs/25)
                                                connect, {join, code}
                        <--- {signal, offerPayload} <---
                                              pairing.answerOffer(...)
                        <--- {signal, answerPayload} ---
{signal, answerPayload} --->
pairing.completeOffer(...)
```

Messages are opaque to the relay — `{type: 'signal', data}` is forwarded
to whichever other socket is in the room, no inspection, no parsing.
Rooms are deleted the moment both sides have exchanged one signal each,
or after a short TTL (a few minutes) if nobody completes the pairing —
whichever comes first. Nothing persists past that.

**Everything about the actual WebRTC mechanics is unchanged.**
`pairing.ts`'s `startOffer`/`answerOffer`/`completeOffer` already don't
know or care how their `offerPayload`/`answerPayload` strings get from
one device to the other (docs/25 already designed this as a pure,
transport-agnostic module) — the relay is a second transport for the
exact same payloads the QR path already produces, not a new mechanism.

## The security question, and the fix

An anonymous relay with no auth means anyone who guesses or observes an
active room code before the real second device joins could occupy that
slot instead — and would then complete a genuine, correctly-encrypted
WebRTC handshake with device A, just with the wrong party. This isn't a
concern over QR (physical proximity is the trust anchor — nobody scans
your screen without being in the room); removing that proximity removes
the anchor, so something has to replace it.

**Short Authentication String (SAS) verification** — the same class of
mechanism Signal's safety numbers and ZRTP use for pairing two parties
with no pre-existing trust and no trusted third party. Once the data
channel opens, both devices already have both DTLS fingerprints in hand
(their own local description's, and the peer's remote description's —
already present in the SDP text, no new exchange needed): sort the two
fingerprints into a canonical order, hash them together, map bytes of the
digest to a small fixed emoji palette. Both sides compute the identical
value from the identical two fingerprints — shown as "do both devices
show 🐘 🎸 🌙?" with an explicit confirm, read aloud over whatever channel
the two people already used to share the code in the first place. A
genuine impostor occupying the wrong room slot produces a *different*
fingerprint pair than the real two devices would have compared with each
other directly, so the mismatch is visible before anything proceeds —
including against an active relay-level attacker, not just a passive
room-squatter (room-already-full is a second, simpler signal that also
catches the squatting case on its own, but doesn't cover a
faster/smarter attacker).

Runs *before* `exchangeHello` — nothing about identity or data crosses
the channel until both humans have confirmed.

## What doesn't change

- The identity fork (own device vs. someone else), the merge algorithm,
  identity unification, the merge-prompt, the synced summary — all of
  docs/24/25 exactly as designed, regardless of which transport
  established the connection.
- The known-peer "skip the choice screen" flow from docs/25's last
  addendum applies identically to a relay-established repeat sync.

## What's out of scope here

- TURN relaying for the *data* itself (this doc is signaling only; if two
  devices can't reach each other directly after signaling completes,
  that's a separate, unaddressed NAT-traversal gap — noted, not solved).
- Any UI for canceling/leaving a room early beyond the existing Cancel
  button's blanket "abandon and exit" behavior.
- Horizontal scaling of the relay (in-memory rooms assume one server
  instance — fine for now, a real constraint if this ever needs to run
  behind a load balancer).

## Decisions locked in this doc

| # | Decision | Why |
|---|---|---|
| D140 | The relay is open to every tier, no auth, no billing | User's explicit call — it never touches financial data, so the privacy/cost argument for a hard server-free line (docs/05 D10) is much weaker here than for sync/AI. Also sidesteps a real sequencing problem: gating it would require auth, which isn't built yet |
| D141 | Room codes are 8 characters from a 32-symbol alphabet (ambiguous characters excluded), generated client-side by the initiator | Balances human-typability against brute-force resistance; combined with a short TTL and rate limiting, makes guessing an active code within its lifetime infeasible |
| D142 | Relay messages are opaque `{type, data}` envelopes the server never inspects beyond routing | Keeps the relay's blast radius minimal by construction — it structurally cannot leak or misuse budgeting data because it never parses anything that could contain it |
| D143 | SAS (Short Authentication String) verification — a few emoji derived from both sides' DTLS fingerprints, shown and confirmed on both screens before anything else crosses the channel | Standard, proven mitigation for pairing two devices with no pre-existing trust and no auth; defends against an active attacker occupying the wrong room slot, not just a passive one — code entropy alone only addresses brute-force, not a code that leaked out-of-band |
| D144 | The relay only ever brokers the offer/answer exchange — all downstream logic (identity, merge, UI) is completely unchanged and shared with the QR transport | `pairing.ts` was already transport-agnostic by design; the relay is a second way to deliver the same payloads, not a parallel pairing system |
| D145 | Every data channel is wrapped with `wrapChannel` the instant it opens — in the flow that produced it (QR's `handleScannedOffer`/`handleScannedAnswer`, relay's `startRelayFlow`/`submitRelayCode`) — never deferred to whenever `afterHandshake` happens to run | A real bug, found while first testing this feature: the QR flow calls `afterHandshake` immediately on channel-open, so it never showed this, but the SAS confirmation step deliberately inserts a human-paced gap between "channel opens" and "afterHandshake runs" — if the peer's hello arrived during that gap, it had zero listeners to catch it at all, the same root cause as D135's deadlock, just triggered by a different kind of pause |

**Implemented and verified, 2026-08-14.** `api/src/relay.ts` (room
lifecycle, rate limiting), `app/src/lib/relayClient.ts` (code generation,
the relay WebSocket transport, SAS derivation — reusing `pairing.ts`'s
`startOffer`/`answerOffer`/`completeOffer` completely unchanged), and
`PairingScreen.tsx`'s new "are you together right now?" fork plus the
code-generate/code-enter/SAS-confirm screens.

Verified in layers, not just the happy path at the end:
- Server relay directly, via raw WebSocket clients (no browser/WebRTC
  involved): the full create → join → signal → signal round trip; a
  third device rejected from an already-completed room; a duplicate room
  code rejected; rate limiting confirmed kicking in exactly at the
  configured threshold (20 legitimate rejections, then rate-limit
  rejections after).
- Client relay transport directly: a real two-way relay-mediated
  `RTCPeerConnection` handshake reaching `connected` on both sides: SAS
  computed independently on both sides from the same real connection
  matched exactly; a second, independent connection produced a
  *different* SAS, confirming the derivation is genuinely tied to the
  actual per-connection fingerprints rather than a static value.
- Full UI, two separate browser contexts (independent local
  SQLite/localStorage, same as two real devices) hitting the real relay
  server: both the "someone else" merge path and the "my own device"
  identity-unification path (correctly triggering D126's merge-prompt on
  the joiner) reached a real "Synced" screen with accurate counts on both
  sides. The QR path and the known-peer flow were re-verified afterward
  for regressions from the shared code this touched (`afterHandshake`'s
  signature change) — none found.

Not yet done: TURN relaying for the data channel itself if direct P2P
fails post-signaling (flagged as out of scope above, still true).

**Real-deployment config, resolved same day.** `VITE_RELAY_WS_URL` (the
override the code already supported, D140's "will change in the future"
concern anticipated exactly this) is now set via `app/.env` to a real
reverse-proxied hostname (`wss://` — not `ws://`, since the app itself is
served over HTTPS and browsers block a secure page from opening an
insecure WebSocket). No code changed for this, only the env value —
confirming the override point was designed correctly the first time.

**Code-entry UX improved, same day**, after real-device testing exposed
the two friction points D141's code format was always going to have:
auto-inserted dash while typing (`normalizeRelayCode`, shared by both the
typed and scanned paths so they always normalize identically), and a
"scan a code instead" option on the entry screen using the exact same
`QrScanStep` component the QR pairing flow already uses — every camera-
lifecycle and repeat-decode fix that component already has applies here
for free. The "show code" screen now also renders the code as a QR
(`QrCanvas`, extracted from `QrShowStep` without changing its behavior)
so a nearby device can scan instead of transcribe, sidestepping 0/O and
1/I/l confusion entirely when scanning is used; the plain text is still
there for the genuinely-remote, read-over-a-phone-call case scanning
can't help with.

Verified: `normalizeRelayCode` against 8 edge cases (bare input, an
already-dashed input not getting double-dashed, short/exact-length input,
pasted spaces, over-length truncation, a real generated code round-
tripping unchanged) — all correct. The type<->scan toggle and the show-
code QR rendering, confirmed on a freshly booted dev instance after an
early run surfaced `qr-scanner`-worker load errors that turned out to be
stale Vite dependency-cache state on a long-running instance, not a code
bug (same test, zero errors on a fresh instance). A full two-device relay
pairing re-run end to end after the `QrShowStep`/`QrCanvas` extraction,
confirming no regression. A dedicated encode round-trip for a real
generated code specifically (not just the SDP payloads tested
elsewhere) — exact match.

| # | Decision | Why |
|---|---|---|
| D146 | Code entry auto-formats with a dash as you type, and offers scanning a QR of the code as an alternative to typing — both normalize through the same function so typed and scanned input can never diverge | Real-device testing surfaced both frictions directly: typing a bare code without the dash is awkward, and manually transcribing it risks exactly the 0/O, 1/I/l confusion QR scanning sidesteps entirely when the other device is close enough to use it |

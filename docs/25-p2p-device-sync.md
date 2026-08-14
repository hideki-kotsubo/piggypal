# 25 — Peer-to-Peer Device Sync

## The problem

docs/02's PowerSync/Postgres path is paid-tier only — by design, free tier
makes zero server calls (docs/05 D10). But sync across devices isn't only a
paid-tier want: a free user with a phone and a laptop still wants both to
agree, and two free users forming a household (docs/24) need *some* way to
actually exchange data without a subscription. Separately, even a paid user
wants a fast/offline path — syncing directly with a partner's phone across
the kitchen table shouldn't require a round trip through Azure, and it
should keep working if neither device has internet at all.

This is genuinely new infrastructure — nothing in docs/02-05 covers
device-to-device transport, only the client↔PowerSync↔Postgres path.

## Not tier-gated, not a PowerSync replacement

P2P sync is a capability every user gets, regardless of tier. It doesn't
compete with PowerSync — the two answer different questions:

- **PowerSync**: "make my data available from anywhere, anytime, even when
  the other device isn't around." Paid-only, needs connectivity to Azure.
- **P2P**: "sync these two specific devices, right now." Free and paid
  both, works fully offline if the devices can reach each other at all.

A paid household still benefits from P2P as a supplement (faster than
round-tripping through the cloud when both people are in the same room;
keeps working mid-flight with no wifi) — it's additive, not a fallback
users get demoted to.

## Transport: WebRTC

A browser PWA has no access to raw LAN discovery (no mDNS, no socket
scanning — sandboxed on every browser, for good reason). So "just find each
other on the same network" isn't available as a primitive; something has to
broker the initial connection. WebRTC is the right layer for the connection
itself once that's done: a direct, encrypted data channel between the two
browsers that opportunistically uses the fastest available path (local
network if both peers are actually on one, relayed over the internet via
STUN/TURN otherwise) — one mechanism instead of building "LAN mode" and
"remote mode" separately.

## Signaling: the unavoidable bootstrap step

Before a WebRTC data channel exists, the two peers need to exchange a
connection offer/answer (SDP) through some other channel first — that
exchange is "signaling," and it's the one piece that can't be avoided.

**v1: QR code exchange, fully serverless.**

1. Device A generates a WebRTC offer, renders it as a QR code.
2. Device B scans it, generates an answer, renders *its* QR code.
3. Device A scans that back — connection established.

Zero server, zero network dependency for the handshake itself — this is
the only approach that satisfies "works with both devices fully offline,"
which the user explicitly wants covered. It also reuses the pairing-code UX
already wanted for household connect (docs/24) — scanning a code *is* the
pairing ceremony, not a separate step bolted onto it.

**Spike results (2026-08-14)**: the flagged size risk was overstated.
Captured real offers from an actual headless-Chromium `RTCPeerConnection`
(single data channel, full — non-trickle — ICE gathering, since a QR
exchange is one-shot with no ongoing channel to trickle candidates over
afterward):

| Scenario | Offer size |
|---|---|
| Host candidates only (no STUN — the fully-offline case) | 586 bytes |
| + one STUN-derived `srflx` candidate | 720 bytes |
| Synthetic multi-interface (several host candidates, closer to a real laptop with wifi + ethernet + virtual adapters) | ~1005 bytes |

All three encode into a single QR code with real headroom against the
format's hard ceiling (version 40, ~2953 bytes at low error-correction):
version 16-18 at EC level L, 18-25 at EC level M, depending on scenario.
Confirmed via the `qrcode` npm package's actual segment/version
calculation, not just theoretical capacity tables.

The residual, narrower question the numbers don't answer: **physical
scan reliability at that module density** (version ~20-25, screen-to-screen
rather than print — glare and camera-vs-display pixel moiré are real
failure modes print-based QR codes don't have to deal with). That needs an
actual two-device test, not a computed answer. If it turns out to matter,
the fix is simple and doesn't need the multi-frame/compact-encoding
mitigations originally floated: drop to error-correction level L (a
screen-to-screen scan is a clean signal source, not worn/dirty like print,
so lower redundancy is a reasonable trade), render the code larger, or
drop the STUN-derived candidate for the same-room case where it isn't
needed anyway.

One implementation note the spike surfaced: for the genuinely-offline case,
`RTCPeerConnection` must be constructed with **no** `iceServers` at all —
otherwise gathering can stall waiting on an unreachable STUN server before
falling back. The 586-byte host-only measurement above used no ICE
servers and gathered in well under a second.

**Deferred: relay-assisted signaling for remote pairing.** Pairing with
someone not physically in the room (inviting a traveling partner) needs
signaling to happen over the internet instead of by scanning each other's
screens. That means a small relay — a stateless rendezvous that shuttles a
few KB of connection metadata between two devices holding the same short
code, then gets out of the way. It never sees or stores actual financial
data, so it doesn't need the subscription gate, but it is still a server
component that has to be hosted. Explicitly out of v1 — QR/in-person
pairing ships first; this is a later enhancement, not a blocker.

## Own device vs. someone else's — the identity question

Surfaced 2026-08-14 by a direct question: "I want my phone, tablet, and
laptop on the same account — how does that work?" The honest answer
exposed a real gap. On the **paid** path this already works with zero new
mechanism: sign into the same email everywhere (docs/05), each device gets
back the *same* server-side `user_id`, and PowerSync's `user_id`-keyed
bucket keeps all of them in lockstep automatically — no pairing ceremony
at all. On the **free/P2P** path, nothing distinguished "pairing my own
second device" from "pairing with a different person" — both ran through
docs/24's household-merge algorithm exactly the same way, which is wrong
for the solo case: every device generates its own `getLocalUserId()`
(`identity.ts`), so a phone and tablet belonging to one person would show
up as two different people. Concretely: `paid_by_user_id`/`owner_user_id`
badges (docs/26) would fragment one person's spending across two fake
household members, and accounts (D112: never merged, always moved) would
duplicate — "Visa" from the phone and "Visa" from the tablet landing as
two separate rows instead of being recognized as the same card.

**The fix is an explicit fork at the start of pairing, not a new merge
algorithm.** docs/24's actual data-level merge (categories dedupe by seed
id, accounts/transactions move, budgets resolve to the greater amount) is
unchanged either way — what differs is only which *identity* a device's
rows carry going forward, decided before that merge runs:

1. Before scanning/generating the pairing QR, the app asks: **"Is this
   your own device, or someone else's?"**
2. **Someone else's** → today's docs/24 behavior, unchanged. Each side
   keeps its own `getLocalUserId()`; that becomes their distinct
   `household_member` identity.
3. **My own device** → identity unification instead. The *joining*
   device overwrites its stored `getLocalUserId()` value to match the
   device it's pairing with, rather than keeping the one it generated on
   first launch. If the joining device already has pre-existing local
   data (it wasn't a fresh install — it had been used standalone under
   its own, now-being-discarded id), that data's `owner_user_id`/
   `paid_by_user_id`/`created_by_user_id` needs rewriting to the adopted
   id too, or every pre-existing row stays mislabeled as a different
   "person" forever. This is the exact same shape of decision docs/05 D14
   already made for the PowerSync path ("device joining an existing
   account with pre-existing standalone local data: ask before merging,
   never silently rekey or silently discard") — reused here rather than
   inventing a second UX pattern: ask before rewriting, offer to keep the
   device's prior data separate instead if declined.
4. Once identity is resolved (adopted or kept distinct), docs/24's normal
   data merge runs exactly as already designed — this step only decided
   *whose* the rows are, not how they combine.

**Accounts still don't auto-merge, even in "my own device" mode** — and
that's a deliberate non-fix, not an oversight. There's no reliable way to
tell "this is genuinely the same real Visa, entered independently on two
devices" from "I happen to have two different Visas" — that's the same
unsolved fuzzy-matching problem already flagged for merchant-string dedup
(docs/00-backlog). Post-pairing, two "Visa" rows are still a real
possibility, now both correctly owned by the same person — the user
archives the duplicate manually, same as any accidental double-entry
today. This is strictly better than the pre-pairing state (two fully
disconnected datasets), just not fully automatic.

## Sync semantics: manual, both-sides-confirmed

Unlike PowerSync's continuous background replication, P2P sync is a
discrete, user-triggered session with a clear start and end — matches how
the user actually described wanting it to work, and fits a mechanism with
no always-on server to stay connected to anyway:

1. User taps "Sync" (can be done as many times a day as wanted, not just
   once).
2. Connection established (fresh pairing via QR, or a remembered peer if
   already paired before — remembering a peer is a smaller problem than
   the household merge itself, still needs its own design pass).
3. Each side computes its outbound changeset (rows with `updated_at` after
   the last successful sync with this specific peer) and sends it.
4. Each side applies the incoming changeset. First-ever sync with a given
   peer runs docs/24's merge algorithm; every sync after that is
   incremental — same conflict rule as PowerSync (last-write-wins by
   `updated_at`, delete wins over concurrent edit — docs/03's existing
   policy, reused rather than inventing a second one).
5. Each side sends an explicit ack once its incoming changeset is fully
   applied. "Sync complete" only shows once **both** acks are in — this is
   the "guarantee all data has been received/sent" the user asked for,
   concretely.
6. Per-peer last-synced watermark updates only after both acks land.

**Open question, not designed**: what happens if the connection drops
mid-sync, after one side has applied changes but before both acks land?
The watermark-only-updates-on-full-ack rule means a retry naturally
re-sends anything unconfirmed, but "naturally re-sends" hasn't been
checked for what it does to already-applied rows (should be a safe
no-op given idempotent last-write-wins upserts, but that's an assumption
to verify, not a guarantee yet).

## Explicitly out of scope for v1

- Relay-assisted remote signaling (above).
- More-than-two-device sync sessions. A household of 3+ converges through
  repeated pairwise syncs (gossip-style — eventually consistent across
  everyone, no N-way session), not a single multi-party handshake.
- Any P2P-specific conflict UI. Same silent LWW policy as PowerSync.
- Remembering/managing paired peers (rename, forget, see last-synced time)
  — needed for a real UI but not designed here.

## Decisions locked in this doc

| # | Decision | Why |
|---|---|---|
| D115 | P2P sync is available to every tier, not a free-tier consolation prize | Paid users want it too, for speed and full-offline capability; it's additive to PowerSync, not competing with it |
| D116 | Transport is WebRTC, one mechanism for both same-network and remote peers | Browsers can't do raw LAN discovery; WebRTC's own ICE negotiation already picks the fastest available path without the app needing to special-case "local" vs "remote" |
| D117 | v1 signaling is QR-code exchange only, fully serverless; relay-assisted remote signaling is deferred | Satisfies the explicit "must work fully offline" requirement; a relay is real infrastructure to host and is a separable enhancement, not a blocker for the in-person case |
| D117a | QR-code signaling confirmed buildable-as-designed: real offers (586-1005 bytes across offline/STUN/multi-interface scenarios) fit a single QR code with real headroom (version 16-25 of a 40-version format) | Spike (2026-08-14) replaced the original "may not fit" guess with measured data from an actual `RTCPeerConnection` + the `qrcode` package's real version calculation; residual risk narrowed to physical scan reliability, not data size |
| D118 | Sync is a manual, user-triggered, both-sides-acked session, not continuous background replication | Matches how the user described wanting it to work; there's no always-on server for a P2P link to stay connected to anyway |
| D119 | First sync with a new peer runs docs/24's merge algorithm; subsequent syncs are incremental via the same LWW policy docs/03 already uses for PowerSync | One conflict policy across both transports instead of two to reason about |
| D120 | 3+ member households converge via repeated pairwise P2P syncs, not a multi-party session | Keeps the transport layer pairwise-simple; eventual consistency across a household is good enough, matching the LWW policy already in place |
| D125 | Pairing asks "your own device, or someone else's?" before running any merge; the docs/24 data-merge algorithm itself is unchanged either way — only whether identity gets unified or kept distinct changes | Solo multi-device sync and household sharing were being conflated: every device's own `getLocalUserId()` was being treated as a distinct person unconditionally, which is correct for a different person and wrong for your own second device |
| D126 | "My own device" mode overwrites the joining device's `getLocalUserId()` to match the device it's pairing with; pre-existing local data on the joining device gets asked-before-rewritten to the adopted id, reusing docs/05 D14's exact "ask before merging, never silently rekey or discard" pattern | A silent identity swap would either strand pre-existing rows under an orphaned id or silently relabel them; D14 already solved this shape of problem for the PowerSync path — no reason to invent a second pattern for P2P |
| D127 | Accounts still never auto-merge in "my own device" mode, matching D112 | No reliable way to distinguish "same real account, entered on two devices" from "coincidentally same name" — same class of unsolved problem as merchant-string dedup (docs/00-backlog). Manual archive-the-duplicate is an acceptable, already-available fallback |

**Partially implemented, 2026-08-14.** The transport and the docs/27
pairing UI are real: `app/src/lib/pairing.ts` (pure WebRTC offer/answer/
data-channel logic — no QR/camera code, so it's directly testable) plus
`PairingScreen.tsx` (the choice → show/scan → synced flow, wired into
Settings). QR generation (`qrcode`) and camera scanning (`qr-scanner`) are
real dependencies, not stubs. Verified: two real `RTCPeerConnection`s
completing a genuine handshake with a correct hello/ack exchange (D118,
made concrete — see `exchangeHello` in `pairing.ts`), a generated QR
round-tripping through an actual decode back to the exact original
payload, and the full click-through UI (including camera permission +
fake-device video) rendering with no console errors in both themes.

**Still not implemented, deliberately deferred**: D125-D127's identity
unification itself (the "own device" choice is captured in the UI but
doesn't yet rewrite `getLocalUserId()` or prompt to merge pre-existing
data — frame 4's D126 merge sheet isn't wired up) and docs/24's actual
data merge (categories/accounts/transactions/budgets) — "Synced" today
means the connection and handshake are real, not that any transaction
data moved. Also still open: remembering peers beyond one localStorage
list with no manage/forget UI, and relay-assisted remote signaling
(unchanged from before, still explicitly out of scope).

**The physical scan-reliability question is answered — the flagged risk
was real.** The user tested on actual hardware (not a fake-video-device
simulation): a real connection established successfully, but level-M
density was slow for a weaker device's camera to resolve. Fixed by taking
the exact mitigation this doc already named as the right first move
(D117a) before it was known to be needed: dropped to error-correction
level L and increased the rendered size. For a real ~650-byte offer, that
took the code from a 93×93 module grid to 85×85 — fewer modules *and*
~28% more physical size per module at the same render width (measured:
2.58px → 3.29px per module). Decode correctness reverified after the
change (D132).

Still slow after that fix — the user's next observation. The remaining
lever wasn't QR settings at all, it was the payload itself: `encodeDescription`/
`decodeDescription` in `pairing.ts` were wrapping the SDP in
`JSON.stringify({ sdp, type })`, which costs bytes two ways — the
`{"sdp":"...","type":"offer"}` structure itself, and JSON escaping every
`\r\n` line-ending in the SDP as four literal characters instead of the
two raw bytes they are. Fixed by dropping the JSON wrapper entirely
(`type` never needs to travel — `answerOffer` always decodes an offer,
`completeOffer` always decodes an answer, so it's passed as a parameter
from context instead) and stripping CRLF to bare LF before encoding,
restored on decode. SDP officially requires CRLF per spec, but browsers'
own parsers accept bare LF in practice — confirmed empirically, not
assumed: a real `setLocalDescription`/`setRemoteDescription` round trip
with the LF-only encoding still completed a genuine connection and
hello/ack exchange correctly (D133). Measured effect on a real offer: 647
→ 569 bytes (12%), 85×85 → 81×81 modules, 3.29px → 3.46px per module —
stacked on top of D132's fix, each module is now ~34% larger than the
original level-M/JSON encoding this doc shipped with. Decode correctness
reverified again after the change.

| # | Decision | Why |
|---|---|---|
| D132 | QR generation uses error-correction level L (not M) at a larger render size, confirmed by a real-device test that level M was slow to scan on weaker hardware | Closes D117a's flagged-but-unverified risk with a real answer instead of a computed one; L was already the named mitigation, just not yet known to be necessary until tested |
| D133 | The offer/answer payload is the raw SDP with CRLF collapsed to LF, not JSON-wrapped with an explicit `type` field | Removes pure encoding overhead (JSON structure + escaping) with no loss of information — `type` is always known from which step of the flow is decoding, and browsers accept LF-only SDP in `set{Local,Remote}Description` despite the spec calling for CRLF, confirmed with a real connection test, not assumed |

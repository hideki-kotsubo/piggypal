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

**Not yet implemented** — design only. The QR/SDP-size question is now
resolved by spike (D117a); the one remaining pre-implementation unknown is
physical two-device scan reliability at the module densities measured
above, not data size.

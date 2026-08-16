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

**The data merge and identity unification are now real too, 2026-08-14.**
`store.applyPeerDataset(peer, adoptPeerIdentity)` implements docs/24's
rules directly against local SQLite (no `household_id` needed for this —
see docs/24's own updated note): categories merge by id, accounts and
transactions are always inserted as new distinct rows, budgets resolve a
`(category, month, currency)` collision to the greater amount. The full
protocol: after `exchangeHello`, each side calls the new `exchangeJson`
(same both-sides-acked shape as `exchangeHello`, generic over the payload)
to trade full local datasets, then applies the peer's with
`applyPeerDataset`. D125-D127's identity unification is wired in too —
`exchangeHello` now also carries each side's `getLocalUserId()`, the
joining device (whoever scanned rather than showed first, in "my own
device" mode) gets D126's merge-prompt if it has any pre-existing local
data, and confirming rewrites that device's existing accounts/
transactions to the peer's id before merging, exactly mirroring docs/05
D14's "ask before merging, never silently rekey or discard" (D134).
"Synced" now shows a real count — categories/accounts/transactions/
budgets actually added or updated, not placeholder copy.

Verified against the real app with ground-truth SQL queries, not just
`applyPeerDataset`'s return value: a "someone else" merge correctly
skipped re-adding an already-present category by id, added a genuinely
new one, added a new account/transaction carrying the peer's own identity
unchanged, and updated an existing budget to a peer's higher amount while
leaving a lower one alone; an "own device" merge correctly rewrote every
one of this device's pre-existing accounts and transactions to the peer's
id and adopted it going forward, while the peer's own inserted rows
already carried the right id by construction.

Still open: remembering peers beyond one localStorage list with no
manage/forget UI, relay-assisted remote signaling (unchanged from before,
still explicitly out of scope), and `category_keywords` are deliberately
excluded from the exchanged dataset (the docs/04 learning loop that would
ever change them post-seed isn't built, docs/16 D91 — nothing there yet
worth the extra merge-rule surface). Also reported, not yet
investigated/fixed: pairing an iPhone and a desktop showed "Synced with
iPhone" on **both** screens — `guessDeviceLabel()` is pure
`navigator.userAgent` sniffing, and the label-exchange protocol itself
(traced through `exchangeHello`) looks correct, so the likely explanation
is the desktop side's UA matching the iPhone pattern somehow (browser
device-emulation mode is the leading guess), not a protocol bug — but
unconfirmed pending the user's answer. Proposed fix regardless of root
cause: an editable, remembered device name instead of relying solely on
UA sniffing.

**A real bug, found on real hardware, 2026-08-14: the exact
"connection drops between the merge-prompt and the merge" gap named just
above turned out to be worse than a missing cancellation signal — it was
a genuine, reproducible deadlock, not a flaky edge case.** The joining
device pauses at D126's merge-prompt for a user tap; the other device
doesn't know to wait and proceeds straight into `exchangeJson`
immediately. The original `exchangeHello`/`exchangeJson` each attached a
fresh `channel.addEventListener('message', ...)` per call — and
`RTCDataChannel` does not buffer or replay `message` events for listeners
attached after the fact. So the impatient side's message could arrive
while the paused side had no listener at all, and was silently dropped
forever. Once the user finally tapped "Merge," it was too late: the
paused side's exchange could never see that first message, the impatient
side could never get an ack for it either, and both sides deadlocked
until the browser's own connection-level timeout eventually surfaced as
"Connection dropped before syncing finished" — which is what the user
saw and reported.

Fixed by `wrapChannel()` (D135): every channel is wrapped exactly once,
the moment it becomes available (`afterHandshake` in `PairingScreen.tsx`)
— before anything could possibly have been sent — with a persistent
message queue that buffers everything from that point on. `exchangeHello`
and `exchangeJson` now consume from this queue instead of attaching their
own listeners, so a message that arrives during an arbitrarily long pause
is still there, in order, whenever the paused side actually asks for it.
Also centralizes error/close handling (the original per-call handlers
only reacted to `'error'`, not `'close'`, and only while that specific
exchange was in flight).

Verified by directly reproducing the bug scenario, not just re-running
the happy path: two real `RTCPeerConnection`s, one side calling
`exchangeJson` immediately while the other deliberately waited 2 real
seconds (simulating sitting at the merge-prompt) before calling it —
confirmed both sides still received the correct, cross-matched payload,
and that the 2-second delay was genuinely honored (measured elapsed time
~2001ms, not a short-circuited skip). The full UI click-through was
re-verified afterward too, no regressions.

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
| D134 | docs/24's merge runs directly against local SQLite via `store.applyPeerDataset`, no `household_id` column involved; identity unification (D125-D127) piggybacks the peer's `getLocalUserId()` onto the existing `exchangeHello` handshake rather than a separate round trip | The local schema was never going to get a partition column it has nothing to partition (schema.ts's own stated principle) — the merge rules apply just as well against one device's plain table set. Reusing the hello round trip for identity avoids a third message exchange for a single string |
| D135 | Every data channel is wrapped exactly once, immediately on availability, with a persistent buffering message queue (`wrapChannel`); `exchangeHello`/`exchangeJson` consume from it instead of attaching their own per-call listeners | `RTCDataChannel` doesn't buffer/replay `message` events for late-attached listeners — a real, reproducible deadlock (not flakiness) when one side of the protocol pauses for user input (D126's merge-prompt) while the other proceeds immediately. Found on real hardware, confirmed by directly reproducing the exact timing, not just inferred from re-reading the code |

## Camera lifecycle: two more real bugs, found on real hardware

Reported 2026-08-14, same day, after D132/D133/D135: scanning was still
slow, and — more seriously — if a scan attempt failed to finish and the
user retried right away, the camera wouldn't come back at all, with the
browser's own recording indicator still showing the camera as in use.
Both turned out to be real, and different from anything fixed above.

**Bug 1 — `qr-scanner`'s `stop()`/`destroy()` defer the actual camera
release by 300ms.** Read directly from the library's source: `pause()`
(which `stop()` calls internally) schedules the real `MediaStreamTrack`
release via `setTimeout(..., 300)` unless called with an explicit
`immediate` flag — presumably to avoid visible flicker on a quick
pause/resume. `QrScanStep`'s cleanup called plain `scanner.stop()`,
un-awaited, so a fast remount (a failed scan's retry, or React
StrictMode's dev-mode double-invoke on *every* mount) could start a
brand-new `getUserMedia()` request while the old stream was still
technically held — camera contention, the still-lit recording indicator.
Confirmed directly, not inferred: a track's `readyState` measured
immediately after calling `pause(true)` reads `"ended"`, versus still
`"live"` at the same point with plain `stop()`.

**Bug 2 — two `QrScanner` instances sharing one `<video>` element can
leave *neither* attached, if constructed close enough together.**
Investigating bug 1 surfaced this separately: `QrScanStep` bound a single
persistent `<video>` via a ref, so React StrictMode's mount → cleanup →
mount (on every mount, in dev — not just the first) created two
`QrScanner` instances pointed at the exact same DOM node in immediate
succession. Reproduced directly, isolated from this app entirely: two
instances sharing one `<video>`, torn down and recreated back-to-back,
left `video.srcObject` `null` even though *neither* instance's `start()`
call threw. Two separate `<video>` elements, same timing, worked cleanly
every time — the shared node itself was the trigger, not raw timing.

Fixed together: `QrScanStep` now creates a fresh `<video>` element
imperatively per effect run (appended into a container ref, removed on
cleanup) instead of a single JSX-bound one, so no two instances can ever
contend over the same node regardless of mount timing; cleanup calls
`scanner.pause(true)` before `destroy()` for the immediate release bug 1
found. Verified by reproducing the user's literal reported sequence, not
just the happy path: enter the scan step, confirm a live camera, back out
immediately, retry within 50ms — both the first attempt and the
immediate retry get a genuine live `MediaStreamTrack`, in the real
component under real StrictMode, not a simplified reproduction. Full UI
click-through re-verified, `tsc -b`/`oxlint` clean.

| # | Decision | Why |
|---|---|---|
| D136 | `QrScanStep` creates a fresh `<video>` element per effect run instead of binding one persistent JSX ref; cleanup calls `scanner.pause(true)` before `destroy()` | Two real bugs found on real hardware: `qr-scanner`'s default stop path defers the actual camera release by 300ms (fixed by forcing the immediate variant), and two scanner instances sharing one `<video>` node — which React StrictMode's dev-mode double-invoke creates on every mount, not just the first — could leave neither attached. Both confirmed by direct reproduction, not inferred from reading the code alone |

## A third real bug: the decode callback fires more than once

Reported 2026-08-14, same day, after D136: "connection dropped before
syncing finished" right after scanning the second (answer) QR code —
despite D135's channel-queue fix and D136's camera fixes both already
landed. Different bug again, same "found by actually using it" pattern.

`qr-scanner`'s decode callback fires on **every video frame** that
successfully reads the code, not once per code — holding the phone
steady for even a fraction of a second after a good scan triggers it
several times in a row. `QrScanStep` passed that callback straight
through to `onResult` with no debouncing, so `handleScannedAnswer` (or
`handleScannedOffer`) ran multiple times concurrently for what the user
experienced as one scan. The first call's `completeOffer` succeeds,
advancing the `RTCPeerConnection`'s signaling state past the point where
a second `setRemoteDescription` is valid — so every call after the first
throws, caught by the generic error handler and shown as "Connection
dropped," even though the first call may already have succeeded. Worse
case, not just a false alarm: if two calls both got far enough,
`wrapChannel` would be invoked twice on the same channel, each attaching
its own listener — every subsequent message delivered to both,
corrupting the handshake for real.

Fixed with a `handled` guard in the decode callback (D137): the first
successful decode pauses the scanner and is the only one that reaches
`onResult`; every decode after that is a no-op. Verified two ways: the
exact guard logic, fed 5 simulated repeat-frame decodes of the same
real QR-encoded payload (via `QrScanner.scanImage`, the actual library
call `qr-scanner` uses internally per frame) — confirmed exactly one
`onResult` call and one `pause()` call, not five; and a full UI
regression pass with no change in behavior for the normal single-scan
path. `tsc -b`/`oxlint` clean.

| # | Decision | Why |
|---|---|---|
| D137 | `QrScanStep`'s decode callback guards against firing more than once per mount (`handled` flag, pauses the scanner on first hit) | `qr-scanner` calls back on every frame that reads the code, not once — without a guard, a steady hold triggers the whole completeOffer/answerOffer flow multiple times, and the underlying RTCPeerConnection can only accept one setRemoteDescription per signaling-state transition, so every call after the first throws |

## Feasibility question: WhatsApp-style linked devices instead of a merge

Asked 2026-08-14, alongside the bug above — not yet designed, answered in
chat rather than built. Short version: what WhatsApp's linked-devices
model actually is (each device syncing continuously and independently
against WhatsApp's own servers, not peer-to-peer between devices) is
already what docs/05's paid PowerSync path provides once signed in on
multiple devices — no new engineering. A genuinely *live*, always-on
link over pure P2P isn't feasible without a server: mobile browsers
suspend backgrounded tabs (no persistent WebRTC connection while the app
isn't open), and two devices on different networks need signaling
infrastructure to find each other at all — exactly the relay this doc
already deferred (D117). What's realistic within the free/P2P
constraints is treating a pairing as a remembered, ongoing relationship
rather than a one-off event — which the peer list already half-does —
with lighter re-sync UX and maybe opportunistic same-network auto-sync,
short of true always-live. Not designed further than this yet; see chat
for the fuller reasoning.

## Lighter repeat sync: remembered peers skip the choice screen

Built 2026-08-14, right after the feasibility question above — "once
they pair, they'll probably do it again," so the first concrete piece of
that "remembered relationship" idea, scoped down from the fuller
WhatsApp-style question to what's actually achievable over P2P: a repeat
sync with an already-known peer no longer re-asks "your own device, or
someone else's?" — it's remembered from the first sync instead.

`peers.ts`'s `PairedPeer.id` changed from a throwaway per-sync random id
to the peer's actual `getLocalUserId()` (already exchanged via
`exchangeHello`) — a stable key that lets `recordSync` **upsert** instead
of append, so a second sync with the same peer updates their row in
place (new `lastSyncedAt`, refreshed label) rather than adding a
duplicate. `identityMode` is stored alongside it. Settings' peer rows are
now real links (`/settings/pair?peer=<id>`, previously static
`<div>`s); `PairingScreen` reads that `peer` query param, looks it up
against the remembered list, and if found, initializes `identity` from
the stored `identityMode` and starts at the `role` step directly instead
of `choice` — skipping straight to "who's showing their code first,"
since that's the only thing left that's genuinely a fresh, per-session
decision. Cancel from a known-peer session exits straight to Settings
rather than falling back to a `choice` screen that was never shown.

Nothing about the merge-prompt (D126) needed to change — it already
skips itself correctly on a repeat sync, for free: the check that decides
whether to show it compares the peer's id against this device's *current*
`getLocalUserId()`, which already equals the peer's id after the first
sync unified them, so the condition that triggers the prompt is simply
false the second time.

Verified: seeding a known peer and tapping its Settings row lands
directly on `role` with the choice screen never rendered at all (checked
for absence, not just presence of the next step), with the peer's label
shown in context ("sync with Bob's Phone"); Cancel from there goes
straight to `/settings`. Upsert behavior verified directly against the
real hook: two `recordSync` calls with the same peer id leave exactly one
row, with the second call's label winning — not two rows. Full UI
regression re-checked for the ordinary first-time (no known peer) path,
unchanged. `tsc -b`/`oxlint` clean.

Still short of true "linked devices": each repeat sync is still a
manual, user-initiated QR ceremony (no way around that without a
server/relay, per the feasibility discussion above) — this only removes
the now-redundant *question*, not the pairing action itself.

| # | Decision | Why |
|---|---|---|
| D138 | `PairedPeer.id` is the peer's real `getLocalUserId()`, not a throwaway random id; `recordSync` upserts by it instead of always appending | Makes "the same peer" a real, checkable fact instead of an assumption — required for both not-duplicating peer rows and for the known-peer flow to look anything up at all |
| D139 | A known peer's Settings row jumps straight to the `role` step (`/settings/pair?peer=<id>`), skipping `choice`; `identity` is initialized from the stored `identityMode` | The own-device/someone-else question has exactly one correct answer once you've synced with a peer before — re-asking it is friction with no decision left to make, not a safety check worth repeating |

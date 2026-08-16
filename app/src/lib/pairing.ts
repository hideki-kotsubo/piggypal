// docs/25: WebRTC data-channel transport for P2P device sync, QR-code
// signaling. Pure connection-establishment logic — no QR image
// generation/scanning and no UI live here, so this half is testable by
// calling it directly (two RTCPeerConnections in the same test) without a
// camera or a rendered QR code at all.

// docs/25's spike: no iceServers configured at all for the fully-offline
// case — an unreachable STUN server can stall ICE gathering waiting for a
// response that never comes. Same choice here as the spike used to get
// its 586-byte offline measurement.
function newPeerConnection(): RTCPeerConnection {
  return new RTCPeerConnection({ iceServers: [] });
}

// A QR exchange is one-shot with no ongoing channel to trickle candidates
// over afterward, so the SDP has to be "complete" (every candidate
// gathered) before it's encoded — same non-trickle approach the docs/25
// spike measured real offer sizes against.
function waitForIceGatheringComplete(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const check = () => {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', check);
        resolve();
      }
    };
    pc.addEventListener('icegatheringstatechange', check);
  });
}

function waitForChannelOpen(channel: RTCDataChannel): Promise<RTCDataChannel> {
  if (channel.readyState === 'open') return Promise.resolve(channel);
  return new Promise((resolve, reject) => {
    channel.addEventListener('open', () => resolve(channel), { once: true });
    channel.addEventListener('error', (e) => reject(e), { once: true });
  });
}

// docs/25 D132's real-device finding — QR scan speed on weaker cameras is
// sensitive to every byte, not just the error-correction/render-size
// knobs already tuned. Two sources of pure encoding overhead removed
// here, on top of that: no JSON wrapper (the `type` field never needs to
// travel — whoever's decoding already knows from context whether they're
// reading an offer or an answer, so it's passed as a parameter instead),
// and CRLF stripped to bare LF before encoding (SDP requires CRLF per
// spec, but browsers' own SDP parsers accept bare LF in practice — this
// alone saves 1 byte per line, and avoiding JSON.stringify's escaping of
// \r\n as four literal characters saves another 2 bytes per line on top
// of that). Restored on decode; the wire format is otherwise unchanged.
function encodeDescription(desc: RTCSessionDescription): string {
  return desc.sdp.replace(/\r\n/g, '\n');
}

function decodeDescription(payload: string, type: RTCSdpType): RTCSessionDescriptionInit {
  return { sdp: payload.replace(/\n/g, '\r\n'), type };
}

export interface OfferSession {
  pc: RTCPeerConnection;
  offerPayload: string; // what frame 3's QR encodes
  channelPromise: Promise<RTCDataChannel>; // resolves once the data channel is actually usable
}

// Device A, frame 3 ("show your code"). Creates the data channel itself —
// per WebRTC's model, only the offering side calls createDataChannel();
// the answering side receives it via the 'datachannel' event in
// answerOffer() below.
export async function startOffer(): Promise<OfferSession> {
  const pc = newPeerConnection();
  const channel = pc.createDataChannel('piggypal-sync');
  const channelPromise = waitForChannelOpen(channel);

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitForIceGatheringComplete(pc);

  return { pc, offerPayload: encodeDescription(pc.localDescription!), channelPromise };
}

export interface AnswerSession {
  pc: RTCPeerConnection;
  answerPayload: string; // what gets shown back for device A to scan
  channelPromise: Promise<RTCDataChannel>;
}

// Device B, frame 4 ("scan theirs, then show mine"). Takes the offer
// payload scanned from device A's QR.
export async function answerOffer(offerPayload: string): Promise<AnswerSession> {
  const pc = newPeerConnection();
  const channelPromise = new Promise<RTCDataChannel>((resolve, reject) => {
    pc.addEventListener(
      'datachannel',
      (e) => {
        waitForChannelOpen(e.channel).then(resolve, reject);
      },
      { once: true },
    );
  });

  await pc.setRemoteDescription(decodeDescription(offerPayload, 'offer'));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await waitForIceGatheringComplete(pc);

  return { pc, answerPayload: encodeDescription(pc.localDescription!), channelPromise };
}

// Device A, back at frame 3/4's boundary — scans device B's answer QR and
// feeds it back into the offer side's connection to complete the
// handshake. From here, `session.channelPromise` resolves once ICE/DTLS
// actually finishes, same as the answering side.
export async function completeOffer(session: OfferSession, answerPayload: string): Promise<void> {
  await session.pc.setRemoteDescription(decodeDescription(answerPayload, 'answer'));
}

// A real bug, found on real hardware (2026-08-14): docs/25 D126's
// merge-prompt pauses the *joining* device for user confirmation before
// it continues the protocol, but the *other* device doesn't know to
// wait — it proceeds immediately. RTCDataChannel does not buffer/replay
// 'message' events for listeners attached after the fact, so a raw
// `channel.addEventListener('message', ...)` created fresh inside each
// exchange function (the original design) could miss a message that
// arrived during the gap while the joining device was sitting at the
// prompt — a real, reproducible deadlock, not flakiness.
//
// Fix: wrap the channel exactly once, the moment it's available (before
// anything could possibly have been sent), with a persistent listener
// that buffers every message. Whatever calls next() later — regardless
// of how long "later" is — still sees everything that arrived in the
// meantime, in order.
export interface PairedChannel {
  send(msg: unknown): void;
  next(): Promise<unknown>;
}

export function wrapChannel(channel: RTCDataChannel): PairedChannel {
  const buffered: unknown[] = [];
  const waiting: { resolve: (msg: unknown) => void; reject: (err: unknown) => void }[] = [];
  let closedError: unknown = null;

  function fail(err: unknown) {
    if (closedError) return;
    closedError = err;
    while (waiting.length > 0) waiting.shift()!.reject(err);
  }

  channel.addEventListener('message', (event) => {
    let msg: unknown;
    try {
      msg = JSON.parse(event.data as string);
    } catch {
      return;
    }
    const w = waiting.shift();
    if (w) w.resolve(msg);
    else buffered.push(msg);
  });
  channel.addEventListener('error', (e) => fail(e));
  channel.addEventListener('close', () => fail(new Error('Data channel closed before syncing finished')));

  return {
    send(msg) {
      channel.send(JSON.stringify(msg));
    },
    next() {
      if (buffered.length > 0) return Promise.resolve(buffered.shift());
      if (closedError) return Promise.reject(closedError);
      return new Promise((resolve, reject) => waiting.push({ resolve, reject }));
    },
  };
}

export interface HelloResult {
  peerLabel: string;
  peerLocalUserId: string;
}

// docs/25 D118's "both sides confirm" made concrete at the smallest
// possible scale: each side sends a hello carrying who they are, replies
// with an ack the moment it sees the peer's hello, and only resolves once
// it has BOTH received the peer's hello (so it knows who it's talking to)
// AND received an ack for its own hello (so it knows the peer received
// it) — the two one-directional confirmations D118 describes, made real
// over an actual data channel instead of just described in prose.
//
// Carries localUserId alongside the display label — docs/25 D125's
// own-device identity unification needs to know the peer's actual
// getLocalUserId() value, not just a friendly name, and piggybacking it
// on the handshake that already has to happen avoids a third round trip.
export async function exchangeHello(pc: PairedChannel, myLabel: string, myLocalUserId: string): Promise<HelloResult> {
  pc.send({ type: 'hello', label: myLabel, localUserId: myLocalUserId });

  let peerHello: { label: string; localUserId: string } | null = null;
  let ackReceived = false;

  while (peerHello === null || !ackReceived) {
    const msg = await pc.next();
    if (typeof msg !== 'object' || msg === null || !('type' in msg)) continue;

    if (
      msg.type === 'hello' &&
      'label' in msg &&
      typeof msg.label === 'string' &&
      'localUserId' in msg &&
      typeof msg.localUserId === 'string'
    ) {
      peerHello = { label: msg.label, localUserId: msg.localUserId };
      pc.send({ type: 'ack' });
    } else if (msg.type === 'ack') {
      ackReceived = true;
    }
  }

  return { peerLabel: peerHello.label, peerLocalUserId: peerHello.localUserId };
}

// docs/25 D119: first sync with a new peer runs docs/24's merge algorithm
// — this is the transport half of that, generic over whatever payload
// shape the caller wants merged (kept domain-agnostic deliberately, same
// reasoning as the rest of this file: no category/account/transaction
// knowledge belongs here, that's store.tsx's applyPeerDataset). Same
// both-sides-acked shape as exchangeHello, and the same fix: consumes
// from the channel's persistent queue rather than attaching its own
// listener, so it can safely be called well after the channel opened —
// exactly the "answerer paused at the merge-prompt" case that surfaced
// the original bug.
export async function exchangeJson<T>(pc: PairedChannel, localPayload: T): Promise<T> {
  pc.send({ type: 'payload', data: localPayload });

  let peerPayload: T | null = null;
  let ackReceived = false;

  while (peerPayload === null || !ackReceived) {
    const msg = await pc.next();
    if (typeof msg !== 'object' || msg === null || !('type' in msg)) continue;

    if (msg.type === 'payload' && 'data' in msg) {
      peerPayload = msg.data as T;
      pc.send({ type: 'payload-ack' });
    } else if (msg.type === 'payload-ack') {
      ackReceived = true;
    }
  }

  return peerPayload;
}

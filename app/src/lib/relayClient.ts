import { answerOffer, completeOffer, startOffer } from './pairing';
import type { AnswerSession, OfferSession } from './pairing';

// docs/28: relay-assisted signaling, a second transport for the exact
// same offer/answer payloads the QR path already produces — pairing.ts's
// startOffer/answerOffer/completeOffer are reused unchanged. Only the
// question "how does this text get to the other device" differs.

// Dev default matches CLAUDE.md's `npm run dev:api` port. Real deployment
// needs a real value here (env-overridable) — not addressed yet, this is
// still a local-dev-only wire-up.
const RELAY_WS_URL = import.meta.env.VITE_RELAY_WS_URL ?? 'ws://localhost:3000/relay';

// No ambiguous characters (0/O, 1/I/L) — meant to be read aloud or typed,
// not scanned. 8 symbols from this 32-character alphabet is ~1.1e12
// combinations (docs/28 D141).
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export function generateRoomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const chars = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]);
  return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
}

// Same lesson as pairing.ts's wrapChannel (docs/25 D135): attach the
// listener the instant the connection exists, buffer everything, so a
// message that arrives before a caller asks for it specifically is never
// lost. Applies here too — a raw WebSocket has the identical "no replay
// for late listeners" behavior RTCDataChannel does.
interface RelayConnection {
  send(msg: unknown): void;
  next(): Promise<Record<string, unknown>>;
  close(): void;
}

function connectRelay(): Promise<RelayConnection> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(RELAY_WS_URL);
    const buffered: Record<string, unknown>[] = [];
    const waiting: { resolve: (msg: Record<string, unknown>) => void; reject: (err: unknown) => void }[] = [];
    let closedError: unknown = null;

    function fail(err: unknown) {
      if (closedError) return;
      closedError = err;
      while (waiting.length > 0) waiting.shift()!.reject(err);
    }

    ws.addEventListener('open', () => {
      resolve({
        send(msg) {
          ws.send(JSON.stringify(msg));
        },
        next() {
          if (buffered.length > 0) return Promise.resolve(buffered.shift()!);
          if (closedError) return Promise.reject(closedError);
          return new Promise((res, rej) => waiting.push({ resolve: res, reject: rej }));
        },
        close() {
          ws.close();
        },
      });
    });
    ws.addEventListener('message', (event) => {
      let msg: unknown;
      try {
        msg = JSON.parse(event.data as string);
      } catch {
        return;
      }
      if (typeof msg !== 'object' || msg === null) return;
      const w = waiting.shift();
      if (w) w.resolve(msg as Record<string, unknown>);
      else buffered.push(msg as Record<string, unknown>);
    });
    ws.addEventListener('error', () => {
      fail(new Error('Could not reach the relay.'));
      reject(new Error('Could not reach the relay.'));
    });
    ws.addEventListener('close', () => fail(new Error('Relay connection closed before pairing finished.')));
  });
}

async function expectOrThrow(conn: RelayConnection, type: string): Promise<Record<string, unknown>> {
  const msg = await conn.next();
  if (msg.type === 'error') throw new Error(typeof msg.message === 'string' ? msg.message : 'Pairing failed.');
  if (msg.type !== type) throw new Error(`Unexpected relay message: ${String(msg.type)}`);
  return msg;
}

export interface RelayOfferResult {
  code: string;
  session: OfferSession;
  // Resolves once the answer has arrived over the relay and been applied
  // (completeOffer) — kept separate from the rest so the caller can show
  // `code` to the user immediately, instead of only after the *entire*
  // handshake (which depends on a human reading and typing the code on
  // another device) has finished. Getting this split wrong was caught
  // while first testing this module, not assumed correct from the start.
  connected: Promise<void>;
}

// The initiator: generate a code, create the room, send the offer the
// instant it's ready (buffered server-side until someone joins — no need
// to wait), then wait for the answer to come back over the same socket.
export async function startRelayOffer(): Promise<RelayOfferResult> {
  const code = generateRoomCode();
  const conn = await connectRelay();
  conn.send({ type: 'create', code });
  await expectOrThrow(conn, 'created');

  const session = await startOffer();
  conn.send({ type: 'signal', data: session.offerPayload });

  const connected = (async () => {
    const answerMsg = await expectOrThrow(conn, 'signal');
    await completeOffer(session, answerMsg.data as string);
    conn.close();
  })();

  return { code, session, connected };
}

// The joiner: enter the code, receive the (possibly already-waiting)
// offer, answer it, send the answer back.
export async function joinRelayAsAnswerer(code: string): Promise<AnswerSession> {
  const conn = await connectRelay();
  conn.send({ type: 'join', code });
  await expectOrThrow(conn, 'joined');

  const offerMsg = await expectOrThrow(conn, 'signal');
  const session = await answerOffer(offerMsg.data as string);
  conn.send({ type: 'signal', data: session.answerPayload });
  conn.close();

  return session;
}

// docs/28 D143 — Short Authentication String verification. Both sides
// already have both DTLS fingerprints in hand (their own local
// description's, the peer's remote description's — no new exchange
// needed): sorted into a canonical order so it doesn't matter which side
// computes it, hashed together, mapped to a few emoji from a fixed
// palette. Identical inputs -> identical output on both screens; a
// mismatch means whoever's on the other end of this connection isn't who
// the other screen thinks it's talking to.
const SAS_EMOJI = [
  '🐘', '🎸', '🌙', '🍕', '🚀', '🦋', '🐋', '🌵', '🔥', '❄️', '🌈', '⚡',
  '🍎', '🐝', '🦉', '🐢', '🌻', '🍄', '🎈', '🧩', '🔑', '💎', '🎯', '🧭',
  '🌊', '🏔️', '🌴', '🍇', '🐙', '🦊', '🐳', '🦖',
];

function extractFingerprint(sdp: string): string {
  const match = /a=fingerprint:sha-256 ([0-9A-Fa-f:]+)/.exec(sdp);
  if (!match) throw new Error('No DTLS fingerprint found.');
  return match[1].toUpperCase();
}

export async function computeSas(pc: RTCPeerConnection): Promise<string[]> {
  const local = extractFingerprint(pc.localDescription!.sdp);
  const remote = extractFingerprint(pc.remoteDescription!.sdp);
  const [first, second] = [local, remote].sort();
  const digestBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${first}|${second}`));
  const bytes = new Uint8Array(digestBuffer);
  return [0, 1, 2].map((i) => SAS_EMOJI[bytes[i] % SAS_EMOJI.length]);
}

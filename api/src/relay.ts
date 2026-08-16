import { WebSocketServer, type WebSocket } from 'ws';
import type { Server } from 'node:http';

// docs/28: an anonymous, ephemeral signaling relay for WebRTC pairing —
// brokers exactly one offer + one answer per room, then forgets
// everything. Never inspects message contents beyond routing (D142) —
// structurally cannot leak budgeting data because it never parses
// anything that could contain it. No auth (D140) — the relay never
// touches financial data, so the privacy/cost argument docs/05 D10 makes
// for keeping free tier server-free doesn't apply here the way it does
// to sync/AI.

const ROOM_TTL_MS = 5 * 60 * 1000;
const MAX_JOIN_ATTEMPTS_PER_IP_PER_MINUTE = 20;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

interface Room {
  code: string;
  creator: WebSocket;
  joiner: WebSocket | null;
  // The creator sends its offer as soon as it's ready, which is often
  // before the joiner has even entered the code — buffered here and
  // delivered the instant someone joins, rather than requiring the
  // creator to somehow know when to (re)send it.
  pendingOfferSignal: unknown;
  timeout: NodeJS.Timeout;
}

const rooms = new Map<string, Room>();
const joinAttemptsByIp = new Map<string, { count: number; windowStart: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = joinAttemptsByIp.get(ip);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    joinAttemptsByIp.set(ip, { count: 1, windowStart: now });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_JOIN_ATTEMPTS_PER_IP_PER_MINUTE;
}

function send(ws: WebSocket, msg: unknown): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

// notifyReason set only for an unexpected/incomplete teardown (a device
// disconnected mid-pairing) — the successful-completion path closes the
// room silently, since finishing is the expected outcome, not an error.
function closeRoom(code: string, notifyReason?: string): void {
  const room = rooms.get(code);
  if (!room) return;
  clearTimeout(room.timeout);
  rooms.delete(code);
  if (notifyReason) {
    send(room.creator, { type: 'error', message: notifyReason });
    if (room.joiner) send(room.joiner, { type: 'error', message: notifyReason });
  }
}

export function attachRelay(server: Server): void {
  const wss = new WebSocketServer({ server, path: '/relay' });

  wss.on('connection', (ws, req) => {
    const ip = req.socket.remoteAddress ?? 'unknown';
    let myRoomCode: string | null = null;
    let myRole: 'creator' | 'joiner' | null = null;

    ws.on('message', (raw) => {
      let msg: unknown;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (typeof msg !== 'object' || msg === null || !('type' in msg)) return;

      if (msg.type === 'create' && 'code' in msg && typeof msg.code === 'string') {
        if (rooms.has(msg.code)) {
          send(ws, { type: 'error', message: 'That code is already in use — try again.' });
          return;
        }
        const code = msg.code;
        const timeout = setTimeout(() => closeRoom(code, 'Pairing code expired.'), ROOM_TTL_MS);
        rooms.set(code, { code, creator: ws, joiner: null, pendingOfferSignal: null, timeout });
        myRoomCode = code;
        myRole = 'creator';
        send(ws, { type: 'created' });
        return;
      }

      if (msg.type === 'join' && 'code' in msg && typeof msg.code === 'string') {
        if (isRateLimited(ip)) {
          send(ws, { type: 'error', message: 'Too many attempts — wait a moment and try again.' });
          return;
        }
        const room = rooms.get(msg.code);
        if (!room || room.joiner) {
          send(ws, { type: 'error', message: 'That code is invalid or already used.' });
          return;
        }
        room.joiner = ws;
        myRoomCode = msg.code;
        myRole = 'joiner';
        send(ws, { type: 'joined' });
        if (room.pendingOfferSignal) {
          send(ws, { type: 'signal', data: room.pendingOfferSignal });
        }
        return;
      }

      if (msg.type === 'signal' && 'data' in msg && myRoomCode) {
        const room = rooms.get(myRoomCode);
        if (!room) return;
        if (myRole === 'creator') {
          if (room.joiner) send(room.joiner, { type: 'signal', data: msg.data });
          else room.pendingOfferSignal = msg.data;
        } else if (myRole === 'joiner') {
          send(room.creator, { type: 'signal', data: msg.data });
          // Exactly one offer + one answer relayed now — the room has
          // done its only job (D142). Closing immediately, rather than
          // waiting for a disconnect or the TTL, shrinks the window an
          // anonymous room code is guessable/usable to the minimum.
          closeRoom(myRoomCode);
        }
        return;
      }
    });

    ws.on('close', () => {
      if (myRoomCode) closeRoom(myRoomCode, 'The other device disconnected.');
    });
  });
}

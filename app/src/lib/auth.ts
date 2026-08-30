import { useState } from 'react';
import { getDeviceId, getLocalUserId } from './identity';
import type { Account, Category, Profile } from './types';

// docs/05's magic-link flow, client side — talks to docs/41's real
// api/src/auth/routes.ts. Mirrors relayClient.ts's own VITE_-env-with-
// localhost-fallback pattern for the dev/prod split.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

export interface AuthAccount {
  userId: string;
  email: string;
}

const AUTH_ACCOUNT_KEY = 'piggypal:auth-account';

// Non-secret UI marker only — "who am I signed in as," never a token
// (docs/05 D13: the access JWT is memory-only below; the refresh token is
// an httpOnly cookie this module never reads directly). The access token
// being lost on reload is fine — refreshAccessToken() mints a new one
// from the cookie — but losing "which email did I sign in with" on every
// reload would leave Settings with no way to show sign-in state at all,
// so that one fact alone is persisted here.
// Exported directly (not just via the hook below) for App.tsx's one-time
// "was this device signed in before?" check on load, outside any
// component's render cycle.
export function getAuthAccount(): AuthAccount | null {
  try {
    const raw = localStorage.getItem(AUTH_ACCOUNT_KEY);
    return raw ? (JSON.parse(raw) as AuthAccount) : null;
  } catch {
    return null;
  }
}

// Plain function (not part of the hook), same reasoning as peers.ts's
// clearPairedPeers — store.tsx's resetLocalData runs outside any
// component and already clears paired peers on reset; a real gap found
// testing this for real: it left this marker behind, so a reset device
// still showed "Signed in as ___" and auto-attempted a reconnect with a
// refresh cookie that reset didn't (and can't, being local-only) touch —
// confusing 401 in the console for what's actually a completely expected
// "fresh device, not signed in" state.
export function clearAuthAccount(): void {
  localStorage.removeItem(AUTH_ACCOUNT_KEY);
}

export function useAuthAccount(): [AuthAccount | null, (account: AuthAccount | null) => void] {
  const [account, setAccountState] = useState<AuthAccount | null>(getAuthAccount);
  function setAccount(next: AuthAccount | null) {
    if (next) localStorage.setItem(AUTH_ACCOUNT_KEY, JSON.stringify(next));
    else localStorage.removeItem(AUTH_ACCOUNT_KEY);
    setAccountState(next);
  }
  return [account, setAccount];
}

// docs/05 D13: the access JWT lives in memory only, for this module's own
// lifetime — never localStorage, never touched by any other file.
let accessToken: string | null = null;

function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API_BASE_URL}${path}`, { credentials: 'include', ...init });
}

const PENDING_EMAIL_KEY = 'piggypal:pending-auth-email';

// docs/41's `/api/auth/verify` response has no email in it (userId only —
// the server has no reason to echo back what the client already sent at
// request-link time). Assumes the magic link is opened on the same
// device/browser it was requested from — true for how a PWA's own
// installed instance handles its own mailto links in practice, and the
// only way this code can show "signed in as ___" without changing
// docs/41's already-tested response shape.
export async function requestMagicLink(email: string): Promise<void> {
  localStorage.setItem(PENDING_EMAIL_KEY, email);
  const res = await apiFetch('/api/auth/request-link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error('Could not send the sign-in link — check the email address and try again.');
}

export function takePendingEmail(): string {
  const email = localStorage.getItem(PENDING_EMAIL_KEY) ?? '';
  localStorage.removeItem(PENDING_EMAIL_KEY);
  return email;
}

export interface VerifyResult {
  accessToken: string;
  userId: string;
  isNewUser: boolean;
}

// docs/41's `/api/auth/verify` needs two client-only values (localUserId,
// deviceId) the emailed link itself can't carry — that doc's own
// "interpretation call #1" note. This is the app-side caller it was
// waiting on.
export async function verifyMagicLink(token: string): Promise<VerifyResult> {
  const params = new URLSearchParams({ token, localUserId: getLocalUserId(), deviceId: getDeviceId() });
  const res = await apiFetch(`/api/auth/verify?${params}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: string });
    throw new Error(body.error ?? 'That sign-in link is invalid or has expired.');
  }
  const result = (await res.json()) as VerifyResult;
  accessToken = result.accessToken;
  return result;
}

// Cookie-authenticated (docs/05's refresh flow) — mints a fresh access
// token from the httpOnly refresh cookie, no body. Returns null rather
// than throwing when there's no valid session (expired/revoked/never
// signed in on this device), matching PowerSyncBackendConnector's own
// "return null if not signed in" contract that connector.ts relies on.
//
// Concurrent callers within this same tab (e.g. connectSync()'s
// reconnect-on-load check racing with another consumer) used to each fire
// their own POST here. The refresh cookie rotates and is single-use
// (docs/05 D13), so the second of two simultaneous calls always reused an
// already-rotated cookie — a real device got fully signed out this way
// after a stray double-reload raced two refresh attempts. Coalescing
// concurrent calls into one in-flight request removes the race for
// same-tab callers; the server's own grace window
// (api/src/auth/routes.ts) covers the remaining cross-reload case this
// can't see (a second request from an already-torn-down previous page).
let refreshInFlight: Promise<string | null> | null = null;
export async function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const res = await apiFetch('/api/auth/refresh', { method: 'POST' });
    if (!res.ok) {
      accessToken = null;
      return null;
    }
    const body = (await res.json()) as { accessToken: string };
    accessToken = body.accessToken;
    return accessToken;
  })();
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

// A real gap found alongside the refresh-reuse race: there was no way to
// sign out at all — a device whose refresh chain got revoked server-side
// (theft-signal or otherwise) was stuck forever showing "signed in as
// ___" with no path back to a fresh sign-in. Best-effort against the
// server (already-invalid cookies are a normal case here, not an error to
// surface) — local state is cleared regardless so this always gets the
// device unstuck. Callers still need to clear the `useAuthAccount()`
// marker and disconnect PowerSync themselves (this module doesn't import
// either).
export async function signOut(): Promise<void> {
  try {
    await apiFetch('/api/auth/logout', { method: 'POST' });
  } catch {
    // Network failure signing out is still a sign-out, locally.
  }
  accessToken = null;
}

// Always tries the in-memory token first (cheap, no network) and only
// falls back to a refresh when there isn't one yet — e.g. right after a
// reload, since the token itself is never persisted.
async function ensureAccessToken(): Promise<string | null> {
  if (accessToken) return accessToken;
  return refreshAccessToken();
}

export async function fetchPowerSyncCredentials(): Promise<{ token: string } | null> {
  let token = await ensureAccessToken();
  if (!token) return null;
  let res = await apiFetch('/api/auth/powersync-token', { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    // Access token expired mid-session (15 min TTL, docs/05) — one
    // refresh retry before giving up.
    token = await refreshAccessToken();
    if (!token) return null;
    res = await apiFetch('/api/auth/powersync-token', { headers: { Authorization: `Bearer ${token}` } });
  }
  if (!res.ok) return null;
  return res.json();
}

// docs/46 D164/D167/D168 — the account's real categories/accounts, read
// directly (api/src/sync/routes.ts's new GET /api/sync/snapshot), not
// through PowerSync's local sync — see that endpoint's own comment for
// exactly why local SQLite can't answer this question on its own.
// docs/48 D177 — profiles added to the same read: the sign-in profile
// picker needs every existing profile before this device has ever
// connected/synced, same reasoning exactly.
export async function fetchServerSnapshot(): Promise<{ categories: Category[]; accounts: Account[]; profiles: Profile[] } | null> {
  let token = await ensureAccessToken();
  if (!token) return null;
  let res = await apiFetch('/api/sync/snapshot', { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    token = await refreshAccessToken();
    if (!token) return null;
    res = await apiFetch('/api/sync/snapshot', { headers: { Authorization: `Bearer ${token}` } });
  }
  if (!res.ok) return null;
  return res.json();
}

export interface SyncOp {
  table: string;
  op: 'PUT' | 'PATCH' | 'DELETE';
  id: string;
  data?: Record<string, unknown>;
}

// docs/46 D163 — the endpoint's response, mirroring api/src/sync/routes.ts's
// UploadResult exactly. `skipped` is the whole point of this change: what
// used to be a bare `{ ok: true }` (indistinguishable from "every row
// really landed") now tells the caller precisely which ops didn't apply
// and why, so connector.ts can surface it instead of silently dropping it.
export interface UploadSyncResult {
  applied: string[];
  skipped: { table: string; id: string; reason: string }[];
}

// connector.ts's uploadData — same bearer + one-retry-on-401 shape as
// fetchPowerSyncCredentials above, against our own /api/sync/upload
// (docs/03) instead of PowerSync's own token endpoint.
export async function uploadSyncOps(ops: SyncOp[]): Promise<UploadSyncResult> {
  let token = await ensureAccessToken();
  if (!token) throw new Error('Not signed in.');
  const send = () =>
    apiFetch('/api/sync/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ops }),
    });
  let res = await send();
  if (res.status === 401) {
    token = await refreshAccessToken();
    if (!token) throw new Error('Not signed in.');
    res = await send();
  }
  if (!res.ok) throw new Error(`Sync upload failed (${res.status})`);
  return res.json();
}

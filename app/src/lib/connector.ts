import { useSyncExternalStore } from 'react';
import type { CommonPowerSyncDatabase, PowerSyncBackendConnector } from '@powersync/web';
import { fetchPowerSyncCredentials, uploadSyncOps } from './auth';
import type { SyncOp } from './auth';

// docs/46 D163 — every op the server reports as `skipped` gets recorded
// here and surfaced (Settings' sync status), never silently dropped the
// way a bare `{ ok: true }` response used to leave it. Deliberately a
// separate tracker from useSyncStatus() (db.ts) rather than bolted onto
// PowerSync's own SyncStatus type, which this app doesn't own the shape
// of. Capped at 20 — this is "what recently needed attention," not a
// permanent audit log.
export interface SkippedSyncOp {
  table: string;
  id: string;
  reason: string;
  at: string;
}

let recentSkips: SkippedSyncOp[] = [];
const skipListeners = new Set<() => void>();

function recordSkips(skipped: { table: string; id: string; reason: string }[]) {
  if (skipped.length === 0) return;
  const at = new Date().toISOString();
  recentSkips = [...skipped.map((s) => ({ ...s, at })), ...recentSkips].slice(0, 20);
  for (const listener of skipListeners) listener();
}

function subscribeSkippedSyncOps(listener: () => void): () => void {
  skipListeners.add(listener);
  return () => skipListeners.delete(listener);
}

export function useSkippedSyncOps(): SkippedSyncOp[] {
  return useSyncExternalStore(subscribeSkippedSyncOps, () => recentSkips);
}

// The PowerSync Service's own public endpoint — distinct from API_BASE_URL
// (our Node API) in auth.ts, even though both eventually sit behind the
// same nginx-proxy-manager host. Not a real production value yet:
// deploy/powersync/README.md's "what's still blocking real client use" —
// no subdomain has been decided (docs/39 open question #4) and no
// production JWKS keypair is deployed, so this only resolves against a
// locally-run PowerSync Service today. VITE_POWERSYNC_URL is the override
// point for once both of those land.
const POWERSYNC_URL = import.meta.env.VITE_POWERSYNC_URL ?? 'http://localhost:8080';

// docs/02/03's write path, implemented against the real PowerSyncDatabase
// API rather than left as a stub: fetchCredentials backs onto docs/41's
// /api/auth/powersync-token, uploadData onto the new /api/sync/upload
// (docs/03, api/src/sync/routes.ts). db.ts only calls db.connect(this)
// once a signed-in account exists — this class is never even constructed
// in local-only mode.
export class PiggypalConnector implements PowerSyncBackendConnector {
  async fetchCredentials() {
    const creds = await fetchPowerSyncCredentials();
    if (!creds) return null;
    return { endpoint: POWERSYNC_URL, token: creds.token };
  }

  async uploadData(database: CommonPowerSyncDatabase) {
    // getNextCrudTransaction (not getCrudBatch) — one local transaction's
    // worth of ops per call, PowerSync's own recommended shape, so a
    // failure partway through a large offline backlog doesn't have to
    // redo everything already-uploaded before it.
    const transaction = await database.getNextCrudTransaction();
    if (!transaction) return;

    const ops: SyncOp[] = transaction.crud.map((entry) => ({
      table: entry.table,
      op: entry.op as SyncOp['op'],
      id: entry.id,
      data: entry.opData,
    }));

    // Any throw here is retried later by the SDK itself (default 5s
    // backoff, per PowerSyncBackendConnector's own doc comment) — no
    // custom retry loop needed on top of that.
    const result = await uploadSyncOps(ops);
    // A skipped op still gets transaction.complete()'d below — the
    // server already made its final decision on it (an ownership
    // mismatch, a superseded budget, a not-found target), so retrying
    // won't change the outcome. "Skipped" means "recorded, not silently
    // lost," not "failed, try again" — see docs/46 D163.
    recordSkips(result.skipped);
    await transaction.complete();
  }
}

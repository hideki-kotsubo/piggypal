import { LogLevels, PowerSyncDatabase, type SyncStatus } from '@powersync/web';
import { useEffect, useState } from 'react';
import { AppSchema } from './schema';
import { PiggypalConnector } from './connector';

// Constructed without a connector — every read/write always goes straight
// to local SQLite regardless of sync state (docs/01 D1's "UI never awaits
// network"). connectSync()/disconnectSync() below layer the "sync" half
// (docs/02) on top by calling db.connect()/disconnect(), which only
// affects background upload/download — never how the app itself reads or
// writes.
export const db = new PowerSyncDatabase({
  schema: AppSchema,
  database: {
    // Bumped from piggypal.db while chasing a seeding bug — a missing `id`
    // column on budget inserts, fixed in store.tsx/seed.ts/types.ts. Seeding
    // never actually succeeded on the old file (rolled back atomically every
    // time), so this was just a clean-slate reset, not a data-recovery fix.
    // Bumped again (v2 -> v3) for the same underlying reason, docs/50: an
    // already-created local database file never gains a table added to
    // AppSchema later (transaction_splits) — confirmed for real, not just
    // suspected, since a genuinely fresh browser profile/instance built
    // the new table correctly from the same code, only an existing v2 file
    // didn't. Restarting the tab, closing every tab (killing the
    // SharedWorker PowerSync's web SDK uses), and Settings' "Reset local
    // data" were all tried first and none of them added the missing table
    // to an already-existing file — only a new filename does.
    dbFilename: 'piggypal-v3.db',
  },
  // Temporary — investigating a real report of sync not resuming on its
  // own after a phone regained connectivity, needing a manual reload
  // (Settings kept showing "Not connected" otherwise). This surfaces the
  // SDK's own connect/retry/credential-fetch logging in the browser
  // console so the next occurrence shows exactly which step stalls,
  // instead of guessing. Revert once that's diagnosed.
  sync: { logLevel: LogLevels.debug },
});

// Called once from a signed-in account exists (Settings' sign-in flow, and
// on app load if a prior sign-in is remembered — see App.tsx). A no-op
// connector.fetchCredentials() returning null (not signed in / refresh
// cookie expired) leaves the SDK simply not connected, rather than
// throwing — matches docs/05's "non-blocking sign in to sync" reconnect
// behavior without this file needing to know why credentials failed.
let connector: PiggypalConnector | null = null;
export function connectSync(): Promise<void> {
  connector ??= new PiggypalConnector();
  return db.connect(connector);
}

export function disconnectSync(): Promise<void> {
  return db.disconnect();
}

// Settings' Sync section reads this to show connected/error state — the
// only place sync status is currently surfaced (docs/05 doesn't specify a
// dedicated banner and none was asked for here; a bare status line is the
// minimum needed so a broken sync isn't completely invisible).
export function useSyncStatus(): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>(db.currentStatus);
  useEffect(() => db.registerListener({ statusChanged: setStatus }), []);
  return status;
}

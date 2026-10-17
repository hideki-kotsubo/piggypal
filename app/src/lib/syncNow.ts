import i18n from './i18n';
import type { SyncStatus } from '@powersync/web';
import { useEffect, useState } from 'react';
import { formatDateTime, formatTime } from './format';

// docs/69 — the pieces of Settings' "Sync now" that don't need the real
// database, kept apart from db.ts so they can be unit-tested without
// loading PowerSync.

export type ForceSyncResult = 'synced' | 'still-running' | 'error';

interface StatusSource {
  registerListener(listener: { statusChanged?: (status: SyncStatus) => void }): () => void;
}

// D245: resolves 'synced' once a download checkpoint newer than `before`
// completes. The timeout is an idle one — every status change (download
// progress, uploading/downloading flags) restarts it — so a big first
// download on a new device is never cut off just for being slow. Timing
// out only stops waiting; the connection keeps syncing in the background.
export function waitForSync(source: StatusSource, before: number, idleMs: number): Promise<ForceSyncResult> {
  return new Promise((resolve) => {
    let timer = setTimeout(() => done('still-running'), idleMs);
    const off = source.registerListener({
      statusChanged: (status) => {
        if ((status.lastSyncedAt?.getTime() ?? 0) > before) return done('synced');
        if (status.dataFlowStatus.uploadError || status.dataFlowStatus.downloadError) return done('error');
        clearTimeout(timer);
        timer = setTimeout(() => done('still-running'), idleMs);
      },
    });
    function done(result: ForceSyncResult) {
      clearTimeout(timer);
      off();
      resolve(result);
    }
  });
}

// D249: absolute, not "3 hours ago" — "did my phone get yesterday's
// changes?" is answered by a clock time, not a distance.
export function formatLastSynced(at: Date | undefined, now = new Date()): string {
  if (!at) return i18n.t('date.never');
  if (now.getTime() - at.getTime() < 60_000) return i18n.t('date.justNow');
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfYesterday = new Date(startOfToday.getTime() - 86_400_000);
  const iso = at.toISOString();
  if (at >= startOfToday) return i18n.t('date.todayAt', { time: formatTime(iso) });
  if (at >= startOfYesterday) return i18n.t('date.yesterdayAt', { time: formatTime(iso) });
  return formatDateTime(iso);
}

// D248: navigator.onLine can claim "online" on a network with no real
// internet; that case still falls through to the usual "Not connected"
// status, so this only labels the obvious one.
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

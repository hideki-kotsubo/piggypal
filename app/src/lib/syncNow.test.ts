import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncStatus } from '@powersync/web';
import { formatLastSynced, waitForSync } from './syncNow';

// docs/69 D245 — a stand-in for the PowerSync database's listener API.
function fakeSource() {
  const listeners = new Set<(s: SyncStatus) => void>();
  return {
    registerListener(l: { statusChanged?: (s: SyncStatus) => void }) {
      listeners.add(l.statusChanged!);
      return () => void listeners.delete(l.statusChanged!);
    },
    emit(status: { lastSyncedAt?: Date; uploadError?: Error; downloadError?: Error }) {
      const s = {
        lastSyncedAt: status.lastSyncedAt,
        dataFlowStatus: { uploadError: status.uploadError, downloadError: status.downloadError },
      } as unknown as SyncStatus;
      for (const l of listeners) l(s);
    },
    get listenerCount() {
      return listeners.size;
    },
  };
}

describe('waitForSync', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('resolves synced on a newer lastSyncedAt and unregisters', async () => {
    const source = fakeSource();
    const result = waitForSync(source, 1000, 20_000);
    source.emit({ lastSyncedAt: new Date(500) });
    source.emit({ lastSyncedAt: new Date(2000) });
    await expect(result).resolves.toBe('synced');
    expect(source.listenerCount).toBe(0);
  });

  it('keeps waiting past idleMs while status keeps changing', async () => {
    const source = fakeSource();
    let settled = false;
    const result = waitForSync(source, 1000, 20_000).then((r) => ((settled = true), r));
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(15_000);
      source.emit({ lastSyncedAt: new Date(1000) });
    }
    expect(settled).toBe(false);
    source.emit({ lastSyncedAt: new Date(3000) });
    await expect(result).resolves.toBe('synced');
  });

  it('resolves still-running after idleMs with no status change', async () => {
    const source = fakeSource();
    const result = waitForSync(source, 1000, 20_000);
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(result).resolves.toBe('still-running');
    expect(source.listenerCount).toBe(0);
  });

  it('resolves error on an upload or download error', async () => {
    const up = fakeSource();
    const upResult = waitForSync(up, 0, 20_000);
    up.emit({ uploadError: new Error('500') });
    await expect(upResult).resolves.toBe('error');

    const down = fakeSource();
    const downResult = waitForSync(down, 0, 20_000);
    down.emit({ downloadError: new Error('offline') });
    await expect(downResult).resolves.toBe('error');
  });
});

describe('formatLastSynced', () => {
  const now = new Date(2026, 9, 13, 15, 0);

  it('says never before the first sync', () => {
    expect(formatLastSynced(undefined, now)).toBe('never');
  });

  it('says just now within a minute', () => {
    expect(formatLastSynced(new Date(2026, 9, 13, 14, 59, 30), now)).toBe('just now');
  });

  it('uses today/yesterday with a time, then a full date', () => {
    expect(formatLastSynced(new Date(2026, 9, 13, 9, 10), now)).toMatch(/^today /);
    expect(formatLastSynced(new Date(2026, 9, 12, 23, 50), now)).toMatch(/^yesterday /);
    const older = formatLastSynced(new Date(2026, 9, 3, 9, 10), now);
    expect(older).not.toMatch(/^(today|yesterday)/);
    expect(older).toMatch(/3/);
  });
});

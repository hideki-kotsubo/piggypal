import { describe, expect, it } from 'vitest';
import { chunkOps } from './syncChunks';
import type { SyncOp } from './auth';

const op = (i: number, note = ''): SyncOp => ({ table: 'transactions', op: 'PUT', id: `id-${i}`, data: { note } });

describe('chunkOps', () => {
  it('keeps a small upload in one request', () => {
    expect(chunkOps([op(1), op(2)])).toHaveLength(1);
  });
  it('splits by count and keeps every op in order', () => {
    const ops = Array.from({ length: 450 }, (_, i) => op(i));
    const chunks = chunkOps(ops);
    expect(chunks.map((c) => c.length)).toEqual([200, 200, 50]);
    expect(chunks.flat()).toEqual(ops);
  });
  it('splits by size under the api body limit', () => {
    const ops = Array.from({ length: 50 }, (_, i) => op(i, 'x'.repeat(5000)));
    const chunks = chunkOps(ops);
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) expect(JSON.stringify({ ops: c }).length).toBeLessThan(100 * 1024);
    expect(chunks.flat()).toEqual(ops);
  });
});

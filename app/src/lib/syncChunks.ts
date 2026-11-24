import type { SyncOp } from './auth';

// The api uses express.json()'s default 100 KB body limit; stay well
// under it, measured on the JSON actually sent.
const MAX_CHUNK_BYTES = 64 * 1024;
const MAX_CHUNK_OPS = 200;

export function chunkOps(ops: SyncOp[]): SyncOp[][] {
  const chunks: SyncOp[][] = [];
  let current: SyncOp[] = [];
  let bytes = 0;
  for (const op of ops) {
    const size = JSON.stringify(op).length + 1;
    if (current.length > 0 && (bytes + size > MAX_CHUNK_BYTES || current.length >= MAX_CHUNK_OPS)) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(op);
    bytes += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

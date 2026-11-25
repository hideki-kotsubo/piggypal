import type { SyncOp } from './auth';

// The api uses express.json()'s default 100 KB body limit; stay well
// under it, measured on the JSON actually sent.
const MAX_CHUNK_BYTES = 64 * 1024;
const MAX_CHUNK_OPS = 200;

// The api applies every PUT/PATCH before any DELETE so a merge can delete
// a row before repointing its references (store.tsx mergeAccountInto
// deletes the loser first) — but only within one request. Chunking split
// a 2,900-row account merge so the DELETE went out with the first chunk
// while most transactions still pointed at it: transactions_account_id_fkey.
// Same order over the whole local transaction, before chunking.
export function chunkOps(ops: SyncOp[]): SyncOp[][] {
  const ordered = [...ops.filter((op) => op.op !== 'DELETE'), ...ops.filter((op) => op.op === 'DELETE')];
  const chunks: SyncOp[][] = [];
  let current: SyncOp[] = [];
  let bytes = 0;
  for (const op of ordered) {
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

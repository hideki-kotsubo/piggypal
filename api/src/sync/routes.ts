import { Router } from 'express';
import { pool } from '../db.js';
import { requireAccessToken, type AuthedRequest } from '../auth/middleware.js';

export const syncRouter = Router();

// docs/03's write path, the counterpart to app/src/lib/connector.ts's
// uploadData. Wire shape (`{ ops: SyncOp[] }`, one entry per PowerSync
// CrudEntry) is this endpoint's own choice — docs/03 only specifies the
// route exists and what the handler must do with it, same kind of
// interpretation call docs/41 flagged for its own routes.
interface SyncOp {
  table: string;
  op: 'PUT' | 'PATCH' | 'DELETE';
  id: string;
  data?: Record<string, unknown>;
}

// Client-writable columns per table, matching db/schema.sql exactly (id
// and user_id are handled separately below — id is always the op's own
// id, user_id is always forced from the verified JWT, never trusted from
// the payload, per docs/03 point 1). category_keywords is included even
// though sync-config.yaml deliberately excludes it from the *download*
// side (docs/16 D91's still-unbuilt learning loop) — accepting uploads
// for it now means nothing needs backfilling once that loop exists.
const TABLE_COLUMNS: Record<string, readonly string[]> = {
  accounts: ['institution', 'name', 'kind', 'archived', 'owner_user_id'],
  categories: ['name', 'kind', 'parent_id', 'icon', 'sort_order', 'archived'],
  transactions: [
    'account_id',
    'category_id',
    'amount_cents',
    'currency',
    'occurred_at',
    'note',
    'merchant',
    'source',
    'ai_raw',
    'deleted_at',
    'paid_by_user_id',
    'created_by_user_id',
  ],
  budgets: ['category_id', 'month', 'currency', 'amount_cents'],
  category_keywords: ['category_id', 'keyword', 'hits'],
};

// SQLite stores booleans as 0/1 (schema.ts's own convention); Postgres
// columns are real `boolean`.
const BOOLEAN_COLUMNS = new Set(['archived']);

function coerce(column: string, value: unknown): unknown {
  if (BOOLEAN_COLUMNS.has(column)) return value === 1 || value === true;
  return value ?? null;
}

function isValidOp(op: unknown): op is SyncOp {
  if (typeof op !== 'object' || op === null) return false;
  const o = op as Record<string, unknown>;
  return (
    typeof o.table === 'string' &&
    o.table in TABLE_COLUMNS &&
    typeof o.id === 'string' &&
    o.id.length > 0 &&
    (o.op === 'PUT' || o.op === 'PATCH' || o.op === 'DELETE')
  );
}

// docs/03 handler responsibilities 1-3 (JWT → user_id, validate, apply
// with last-write-wins). Responsibility 4 (subscription gate) is
// deliberately NOT implemented here — same call docs/41 made for its own
// routes: docs/06's `subscriptions` table has nothing that ever writes to
// it yet (no Stripe integration exists), so a gate here could only ever
// reject every request, which isn't "enforcing paid tier," just breaking
// sync for everyone. Wire it in once docs/06 is real.
//
// "Last-write-wins by updated_at" (docs/02) is also a real simplification
// here, not the literal spec: the local SQLite schema (schema.ts) doesn't
// track updated_at at all, so the client has no value to compare against
// server-side. What's implemented instead is "last upload wins" —
// updated_at is stamped server-side at upload time — which approximates
// the intended policy whenever devices are online reasonably promptly,
// but doesn't hold up against a long-offline device's stale edit landing
// after a newer one. Flagged, not fixed, here.
syncRouter.post('/upload', requireAccessToken, async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  const rawOps = req.body?.ops;
  if (!Array.isArray(rawOps) || !rawOps.every(isValidOp)) {
    res.status(400).json({ error: 'Expected { ops: SyncOp[] } with a table/op/id this endpoint recognizes' });
    return;
  }
  const ops = rawOps as SyncOp[];

  const client = await pool().connect();
  try {
    await client.query('BEGIN');

    for (const op of ops) {
      const columns = TABLE_COLUMNS[op.table];

      if (op.op === 'DELETE') {
        await client.query(`DELETE FROM ${op.table} WHERE id = $1 AND user_id = $2`, [op.id, userId]);
        continue;
      }

      if (op.op === 'PUT') {
        // Full-row upsert: every configured column, defaulting to null
        // when absent — matches CrudEntry's own PUT semantics ("all
        // non-null columns are included," so a missing one means null).
        // The WHERE on the DO UPDATE branch only fires against the
        // *existing* conflicting row — it never blocks a fresh insert —
        // and stops one user's client-generated id from ever overwriting
        // a different user's row on the astronomically unlikely event of
        // a UUID collision (same trust model this codebase already
        // applies to every other client-generated id).
        const values = columns.map((c) => coerce(c, op.data?.[c]));
        const placeholders = columns.map((_, i) => `$${i + 3}`).join(', ');
        const updateSet = columns.map((c, i) => `${c} = $${i + 3}`).join(', ');
        await client.query(
          `INSERT INTO ${op.table} (id, user_id, ${columns.join(', ')})
           VALUES ($1, $2, ${placeholders})
           ON CONFLICT (id) DO UPDATE SET ${updateSet}, updated_at = now()
           WHERE ${op.table}.user_id = $2`,
          [op.id, userId, ...values],
        );
        continue;
      }

      // PATCH — only the columns actually present in opData, same
      // ownership guard as PUT via the WHERE clause.
      const presentCols = columns.filter((c) => op.data && c in op.data);
      if (presentCols.length === 0) continue;
      const setClause = presentCols.map((c, i) => `${c} = $${i + 3}`).join(', ');
      const values = presentCols.map((c) => coerce(c, op.data![c]));
      await client.query(`UPDATE ${op.table} SET ${setClause}, updated_at = now() WHERE id = $1 AND user_id = $2`, [
        op.id,
        userId,
        ...values,
      ]);
    }

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

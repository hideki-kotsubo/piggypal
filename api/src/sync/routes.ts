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
  // docs/50 — the per-account amount breakdown when a transaction is split
  // across 2+ accounts (that transaction's own account_id is then NULL).
  // Bare-id table like every other transaction-domain table here, not
  // composite — its id is a real crypto.randomUUID(), not a cross-device
  // fixed slug (see COMPOSITE_KEY_TABLES's own comment for why that
  // distinction matters).
  transaction_splits: ['transaction_id', 'account_id', 'amount_cents'],
  budgets: ['category_id', 'month', 'currency', 'amount_cents'],
  category_keywords: ['category_id', 'keyword', 'hits'],
  // docs/48 D175/D176 — profiles.id/devices.id are client-generated
  // (getLocalUserId()/getDeviceId()), same upsert-by-id shape as every
  // other table here.
  profiles: ['display_name'],
  devices: ['profile_id', 'label', 'last_seen_at'],
};

// SQLite stores booleans as 0/1 (schema.ts's own convention); Postgres
// columns are real `boolean`.
const BOOLEAN_COLUMNS = new Set(['archived']);

// docs/46 D162 — categories/category_keywords use a composite
// `(user_id, id)` primary key (db/migrations/2026-08-24-categories-
// composite-key.sql), so a different user's row is never even a conflict
// target for them — no ownership WHERE needed, and a collision there can
// only ever be this same user's own repeat upload. Every other table
// still uses the bare `id` primary key (real crypto.randomUUID()s, cross-
// user collision is astronomically unlikely but not impossible) and
// keeps the WHERE guard as defense-in-depth.
const COMPOSITE_KEY_TABLES = new Set(['categories', 'category_keywords']);

// A real bug, found testing this endpoint against a real signed-in
// device: categories.sort_order is `not null default 0` in db/schema.sql,
// but nothing in app/ ever populates it (categories don't support manual
// reordering — docs/12/13's "no manual reordering" applies here too) —
// schema.ts's own column has no local NOT NULL enforcement, so it's just
// SQLite-NULL on every real row, and explicitly writing NULL for a column
// always overrides its Postgres DEFAULT, unlike omitting the column
// entirely. Substituting the column's own intended default here (rather
// than omitting null columns generally) keeps PUT's full-row-replace
// semantics correct for every genuinely nullable column (institution,
// merchant, note, ...) — clearing one of those must still write a real
// NULL, not silently leave a stale value in place.
const COLUMN_DEFAULTS: Record<string, unknown> = { sort_order: 0 };

function coerce(column: string, value: unknown): unknown {
  if (BOOLEAN_COLUMNS.has(column)) return value === 1 || value === true;
  if (value === null || value === undefined) return COLUMN_DEFAULTS[column] ?? null;
  return value;
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

// docs/46 D163 — every op now resolves to exactly one of these two
// buckets instead of a bare `{ ok: true }`. `skipped` covers three real,
// distinct non-write outcomes: an ownership-guard WHERE that didn't match
// (an id that exists, but under a different user — see COMPOSITE_KEY_TABLES
// above for why this can now only happen on the still-bare-id tables), a
// PATCH/DELETE target that matched no row at all (not found, or not
// yours — deliberately not distinguished, same no-information-leak
// property the WHERE guard itself already had), and a budget resolved by
// docs/02's collision policy without inserting the uploaded id as a
// second row. The connector (app/src/lib/connector.ts) treats every
// `skipped` entry as something to surface, not silently drop — the
// entire point of this change is that "the server said 200" must stop
// being treated as "every row landed."
interface UploadResult {
  applied: string[];
  skipped: { table: string; id: string; reason: string }[];
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
  // A real bug, found from a real merge upload batch: a batch can contain
  // both a DELETE of a duplicate row and a PATCH elsewhere that repoints a
  // foreign key *away* from that same row (e.g. store.tsx's merge-plan
  // cascade deleting a duplicate account while repointing its transactions
  // to the surviving account id) — see docs/46 D167/D168's merge cascade.
  // PowerSync's CRUD queue preserves local write order, but the local write
  // order isn't guaranteed to detach every reference before deleting its
  // target, and Postgres checks FK constraints immediately, not at COMMIT.
  // Applying every PUT/PATCH before any DELETE (stable within each group)
  // guarantees every reference is repointed before its old target is
  // removed, regardless of the order the client queued them in. This is
  // safe because a single merge-plan application never reuses an id across
  // both a DELETE and a PUT/PATCH — "split" resolutions delete the old id
  // and reinsert under a brand-new one, "merge" resolutions delete the
  // losing id with no reinsert at all.
  const orderedOps = [...ops.filter((op) => op.op !== 'DELETE'), ...ops.filter((op) => op.op === 'DELETE')];
  const result: UploadResult = { applied: [], skipped: [] };

  const client = await pool().connect();
  try {
    await client.query('BEGIN');

    for (const op of orderedOps) {
      const columns = TABLE_COLUMNS[op.table];

      if (op.op === 'DELETE') {
        const r = await client.query(`DELETE FROM ${op.table} WHERE id = $1 AND user_id = $2`, [op.id, userId]);
        if (r.rowCount === 0) result.skipped.push({ table: op.table, id: op.id, reason: 'not-found' });
        else result.applied.push(op.id);
        continue;
      }

      if (op.op === 'PUT' && op.table === 'budgets') {
        // docs/02's budget-collision policy ("unique constraint + LWW on
        // amount"), matching the exact rule store.tsx's P2P merge
        // (applyPeerDataset) already implements locally — confirmed as a
        // real, not just theoretical, case by docs/45's real second-
        // device merge. seed.ts deliberately gives every install's seeded
        // budgets a random id (docs/24 D113) specifically so two devices'
        // budgets for the same (category, month, currency) collide on
        // that natural key, not silently overwrite by id — Postgres only
        // allows one ON CONFLICT arbiter per INSERT, so budgets can't use
        // the generic id-based upsert below without hitting the table's
        // own separate unique constraint.
        const categoryId = coerce('category_id', op.data?.category_id);
        const month = coerce('month', op.data?.month);
        const currency = coerce('currency', op.data?.currency);
        const amountCents = coerce('amount_cents', op.data?.amount_cents);
        const existing = await client.query<{ id: string; amount_cents: string }>(
          'SELECT id, amount_cents FROM budgets WHERE user_id = $1 AND category_id = $2 AND month = $3 AND currency = $4',
          [userId, categoryId, month, currency],
        );
        const collision = existing.rows[0];
        if (collision && collision.id !== op.id) {
          if (Number(amountCents) > Number(collision.amount_cents)) {
            await client.query('UPDATE budgets SET amount_cents = $1, updated_at = now() WHERE id = $2', [
              amountCents,
              collision.id,
            ]);
            result.applied.push(op.id);
          } else {
            // Lower or equal amount: the existing row already wins, and
            // op.id itself is never inserted as a second row for the same
            // slot — that's the whole point of this branch. Reported, not
            // silent — this device's own upload queue can still safely
            // consider op.id "handled" (there's nothing left to retry).
            result.skipped.push({ table: op.table, id: op.id, reason: 'lower-amount-superseded' });
          }
          continue;
        }
        // No collision (nothing here yet, or it's this exact row being
        // re-uploaded) — falls through to the generic upsert below.
      }

      if (op.op === 'PUT') {
        // Full-row upsert: every configured column, defaulting to null
        // when absent — matches CrudEntry's own PUT semantics ("all
        // non-null columns are included," so a missing one means null).
        const values = columns.map((c) => coerce(c, op.data?.[c]));
        const placeholders = columns.map((_, i) => `$${i + 3}`).join(', ');
        const updateSet = columns.map((c, i) => `${c} = $${i + 3}`).join(', ');
        const composite = COMPOSITE_KEY_TABLES.has(op.table);
        // Composite-key tables conflict only on (user_id, id) — a
        // different user's row was never a possible conflict target in
        // the first place, so there's no WHERE guard to silently fail.
        // Bare-id tables keep the WHERE guard (stops a same-id write from
        // ever touching a different user's row on the astronomically
        // unlikely event of a UUID collision) and now report it via
        // rowCount instead of staying silent.
        const query = composite
          ? `INSERT INTO ${op.table} (id, user_id, ${columns.join(', ')})
             VALUES ($1, $2, ${placeholders})
             ON CONFLICT (user_id, id) DO UPDATE SET ${updateSet}, updated_at = now()`
          : `INSERT INTO ${op.table} (id, user_id, ${columns.join(', ')})
             VALUES ($1, $2, ${placeholders})
             ON CONFLICT (id) DO UPDATE SET ${updateSet}, updated_at = now()
             WHERE ${op.table}.user_id = $2`;
        const r = await client.query(query, [op.id, userId, ...values]);
        if (r.rowCount === 0) result.skipped.push({ table: op.table, id: op.id, reason: 'owned-by-another-user' });
        else result.applied.push(op.id);
        continue;
      }

      // PATCH — only the columns actually present in opData, same
      // ownership guard as PUT via the WHERE clause.
      const presentCols = columns.filter((c) => op.data && c in op.data);
      if (presentCols.length === 0) {
        result.applied.push(op.id); // nothing to do is not a failure
        continue;
      }
      const setClause = presentCols.map((c, i) => `${c} = $${i + 3}`).join(', ');
      const values = presentCols.map((c) => coerce(c, op.data![c]));
      const r = await client.query(
        `UPDATE ${op.table} SET ${setClause}, updated_at = now() WHERE id = $1 AND user_id = $2`,
        [op.id, userId, ...values],
      );
      if (r.rowCount === 0) result.skipped.push({ table: op.table, id: op.id, reason: 'not-found' });
      else result.applied.push(op.id);
    }

    await client.query('COMMIT');
    res.json(result);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// docs/46 D164/D167/D168 — a direct read of this account's real
// categories/accounts, bypassing PowerSync's local sync entirely. This
// exists because of a real mechanic the merge redesign ran into: locally,
// PowerSync's synced tables are keyed by bare `id` (schema.ts has no
// user_id column at all — "a single device's local DB only ever holds
// one user's data," its own comment says). If this device already has a
// pending, not-yet-uploaded local category with the same id as one the
// account already has server-side (the exact "second device with its own
// pre-existing local data" case this whole redesign is about), the local
// optimistic write overlays and *hides* the real server row for that id
// — querying local SQLite after `db.waitForFirstSync()` would show this
// device's own not-yet-reconciled value, not the account's actual state,
// making it impossible to tell the two apart for D167/D168's merge
// cascade. This endpoint sidesteps that entirely by reading the true
// server state directly, the same way applyPeerDataset gets a clean
// dataset from a P2P peer instead of trying to infer it from local state.
syncRouter.get('/snapshot', requireAccessToken, async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  const client = await pool().connect();
  try {
    const categories = await client.query(
      'SELECT id, name, kind, parent_id, archived, updated_at FROM categories WHERE user_id = $1',
      [userId],
    );
    const accounts = await client.query(
      'SELECT id, institution, name, kind, archived, owner_user_id, updated_at FROM accounts WHERE user_id = $1',
      [userId],
    );
    // docs/48 D177 — the sign-in profile picker needs every existing
    // profile *before* this device has ever connected/synced, same
    // "read the true server state directly" reasoning as categories/
    // accounts above — a brand-new device has no local PowerSync data
    // to show a profile list from yet.
    const profiles = await client.query('SELECT id, display_name, updated_at FROM profiles WHERE user_id = $1', [
      userId,
    ]);
    res.json({
      categories: categories.rows.map((c) => ({
        id: c.id,
        name: c.name,
        kind: c.kind,
        parentId: c.parent_id,
        archived: c.archived,
        updatedAt: c.updated_at,
      })),
      accounts: accounts.rows.map((a) => ({
        id: a.id,
        institution: a.institution,
        name: a.name,
        kind: a.kind,
        archived: a.archived,
        ownerUserId: a.owner_user_id,
        updatedAt: a.updated_at,
      })),
      profiles: profiles.rows.map((p) => ({
        id: p.id,
        displayName: p.display_name,
        updatedAt: p.updated_at,
      })),
    });
  } finally {
    client.release();
  }
});

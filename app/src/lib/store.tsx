import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Transaction as SqliteTransaction } from '@powersync/web';
import { connectSync, db } from './db';
import { clearAuthAccount, getAuthAccount } from './auth';
import { clearDeviceRole, clearLocalUserId, getLocalUserId, setDeviceRole, setLocalUserId } from './identity';
import { clearPairedPeers } from './peers';
import { nowUtc } from './format';
import type { AccountRewrite, CategoryRewrite } from './mergeMatch';
import type { Account, AccountKind, Budget, Category, CategoryKeyword, MergeSummary, PeerDataset, Transaction } from './types';
import { AppSkeleton } from '../components/AppSkeleton';
import { seedCategories, seedCategoryKeywords } from './seed';

// Real local data layer — docs/01 D1 (on-device SQLite via wa-sqlite/
// PowerSync web SDK), running in local-only mode (no connector passed to
// PowerSyncDatabase in db.ts, so nothing here ever touches a network).
// Sync/auth are a distinct, later phase. Replaces the earlier localStorage
// scaffolding, but keeps the exact same StoreApi shape below so no
// component needed to change.

// ---- row <-> domain mapping (SQLite is snake_case, our types are camelCase) ----

// docs/46 D170 — same "column added after some rows already existed"
// situation occurred_at/owner_user_id's own fallbacks below already
// document: genuinely null for any row written before updated_at existed.
// Epoch, not "now" — an untouched old row should read as maximally stale
// in the merge-redesign's recency display, never accidentally look more
// recent than a row that's actually just been edited.
const NEVER_UPDATED = '1970-01-01T00:00:00.000Z';

interface AccountRow {
  id: string;
  institution: string | null;
  name: string;
  kind: string;
  archived: number;
  owner_user_id: string | null; // see rowToAccount's fallback note
  updated_at: string | null;
}
function rowToAccount(r: AccountRow): Account {
  return {
    id: r.id,
    institution: r.institution,
    name: r.name,
    kind: r.kind as AccountKind,
    archived: Boolean(r.archived),
    // Same "column added after some rows already existed" situation as
    // occurred_at below — genuinely null for any account written before
    // this column existed. Falls back to this device's own identity
    // rather than leaving it empty, since every pre-existing local
    // account was, definitionally, owned by whoever's device it's on.
    ownerUserId: r.owner_user_id ?? getLocalUserId(),
    updatedAt: r.updated_at ?? NEVER_UPDATED,
  };
}

interface CategoryRow {
  id: string;
  name: string;
  kind: string;
  parent_id: string | null;
  archived: number;
  updated_at: string | null;
}
function rowToCategory(r: CategoryRow): Category {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind as Category['kind'],
    parentId: r.parent_id,
    archived: Boolean(r.archived),
    updatedAt: r.updated_at ?? NEVER_UPDATED,
  };
}

interface TransactionRow {
  id: string;
  account_id: string;
  category_id: string | null;
  amount_cents: number;
  currency: string;
  // Genuinely nullable at runtime, whatever the column comment claims: a
  // row written before occurred_on was renamed to occurred_at has nothing
  // under the new name (PowerSync's schema is a view over JSON-stored
  // data — a renamed column doesn't retroactively appear in old rows, it's
  // just absent). Transaction.occurredAt itself stays a guaranteed string
  // for every other consumer — this mapping is the one place that has to
  // know the fallback exists.
  occurred_at: string | null;
  note: string | null;
  merchant: string | null;
  source: string;
  ai_raw: string | null;
  deleted_at: string | null;
  paid_by_user_id: string | null; // see rowToTransaction's fallback note
  created_by_user_id: string | null;
  updated_at: string | null;
}
function rowToTransaction(r: TransactionRow): Transaction {
  return {
    id: r.id,
    accountId: r.account_id,
    categoryId: r.category_id,
    amountCents: r.amount_cents,
    currency: r.currency,
    occurredAt: r.occurred_at ?? '1970-01-01T00:00:00',
    note: r.note,
    merchant: r.merchant,
    source: r.source as Transaction['source'],
    aiRaw: r.ai_raw,
    deletedAt: r.deleted_at,
    // Genuinely null for any row written before these columns existed —
    // same PowerSync-is-a-view-over-JSON situation occurred_at's own
    // fallback above documents. docs/24's real backfill rule (paid_by =
    // created_by = the pre-sharing owner) collapses to "this device" in
    // today's single-user-per-device world, so that's the fallback here.
    paidByUserId: r.paid_by_user_id ?? getLocalUserId(),
    createdByUserId: r.created_by_user_id ?? getLocalUserId(),
    updatedAt: r.updated_at ?? NEVER_UPDATED,
  };
}

interface BudgetRow {
  id: string;
  category_id: string;
  month: string;
  currency: string;
  amount_cents: number;
  updated_at: string | null;
}
function rowToBudget(r: BudgetRow): Budget {
  return {
    id: r.id,
    categoryId: r.category_id,
    month: r.month,
    currency: r.currency,
    amountCents: r.amount_cents,
    updatedAt: r.updated_at ?? NEVER_UPDATED,
  };
}

interface CategoryKeywordRow {
  id: string;
  category_id: string;
  keyword: string;
  hits: number;
}
function rowToCategoryKeyword(r: CategoryKeywordRow): CategoryKeyword {
  return { id: r.id, categoryId: r.category_id, keyword: r.keyword, hits: r.hits };
}

const ACCOUNT_COLUMNS: Record<keyof Account, string> = {
  id: 'id',
  institution: 'institution',
  name: 'name',
  kind: 'kind',
  archived: 'archived',
  ownerUserId: 'owner_user_id',
  updatedAt: 'updated_at',
};

const CATEGORY_COLUMNS: Record<keyof Category, string> = {
  id: 'id',
  name: 'name',
  kind: 'kind',
  parentId: 'parent_id',
  archived: 'archived',
  updatedAt: 'updated_at',
};

const BUDGET_COLUMNS: Record<keyof Budget, string> = {
  id: 'id',
  categoryId: 'category_id',
  month: 'month',
  currency: 'currency',
  amountCents: 'amount_cents',
  updatedAt: 'updated_at',
};

const TRANSACTION_COLUMNS: Record<keyof Transaction, string> = {
  id: 'id',
  accountId: 'account_id',
  categoryId: 'category_id',
  amountCents: 'amount_cents',
  currency: 'currency',
  occurredAt: 'occurred_at',
  note: 'note',
  merchant: 'merchant',
  source: 'source',
  aiRaw: 'ai_raw',
  deletedAt: 'deleted_at',
  paidByUserId: 'paid_by_user_id',
  createdByUserId: 'created_by_user_id',
  updatedAt: 'updated_at',
};

// Shared by applyPeerDataset's docs/25 D126 rewrite and adoptAccountId's
// docs/05 D14 rewrite — both are "every local row this device owns now
// belongs to a different identity," just triggered by two different flows
// (P2P own-device pairing vs. signing into an existing account). Only
// rewrites if the ids actually differ, so either caller can invoke this
// unconditionally without checking first.
async function rewriteOwnerIdentity(tx: SqliteTransaction, oldId: string, newId: string): Promise<void> {
  if (oldId === newId) return;
  const now = nowUtc();
  await tx.execute('UPDATE accounts SET owner_user_id = ?, updated_at = ? WHERE owner_user_id = ?', [newId, now, oldId]);
  await tx.execute('UPDATE transactions SET paid_by_user_id = ?, updated_at = ? WHERE paid_by_user_id = ?', [newId, now, oldId]);
  await tx.execute('UPDATE transactions SET created_by_user_id = ?, updated_at = ? WHERE created_by_user_id = ?', [newId, now, oldId]);
  setLocalUserId(newId);
}

// Shared by applySignInMergePlan's own cascade (below) and the manual
// merge-duplicates tool (mergeCategories/mergeAccounts) — both are "every
// reference to oldId now belongs to newId," just triggered by two
// different flows (sign-in reconciliation vs. an on-demand user pick).
async function cascadeCategoryReferences(tx: SqliteTransaction, oldId: string, newId: string): Promise<void> {
  await tx.execute('UPDATE categories SET parent_id = ? WHERE parent_id = ?', [newId, oldId]);
  await tx.execute('UPDATE transactions SET category_id = ? WHERE category_id = ?', [newId, oldId]);
  await tx.execute('UPDATE budgets SET category_id = ? WHERE category_id = ?', [newId, oldId]);
  await tx.execute('UPDATE category_keywords SET category_id = ? WHERE category_id = ?', [newId, oldId]);
}
async function cascadeAccountReferences(tx: SqliteTransaction, oldId: string, newId: string): Promise<void> {
  await tx.execute('UPDATE transactions SET account_id = ? WHERE account_id = ?', [newId, oldId]);
}

// Manual-merge-only entry points: unlike applySignInMergePlan's rewrites,
// there's never a "reinsert under a new id" case here — both rows already
// exist locally, this just collapses loserId into an existing survivorId.
async function mergeCategoryInto(tx: SqliteTransaction, loserId: string, survivorId: string): Promise<void> {
  await tx.execute('DELETE FROM categories WHERE id = ?', [loserId]);
  await cascadeCategoryReferences(tx, loserId, survivorId);
}
async function mergeAccountInto(tx: SqliteTransaction, loserId: string, survivorId: string): Promise<void> {
  await tx.execute('DELETE FROM accounts WHERE id = ?', [loserId]);
  await cascadeAccountReferences(tx, loserId, survivorId);
}

// Shared by seeding and addAccount — one place that knows the accounts
// INSERT shape.
async function insertAccountRow(a: Account): Promise<void> {
  await db.execute(
    `INSERT INTO accounts (id, institution, name, kind, archived, owner_user_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [a.id, a.institution, a.name, a.kind, a.archived ? 1 : 0, a.ownerUserId, a.updatedAt],
  );
}

// ---- one-time seed on an empty database ----

async function seedIfEmpty() {
  // Only categories/category_keywords are seeded here — real starter
  // defaults every install needs (the Tier 1 parser has nothing to match
  // against without the keyword vocabulary), not demo data. Accounts/
  // transactions/budgets used to be seeded too as fake UI-dev fixtures
  // (Visa/Costco/Uber/...), which meant every real new user's first
  // launch silently mixed fictional financial data into their own store.
  // Removed — a real user's Home starts genuinely empty.
  //
  // Still skipped entirely once signed in (docs/45's discardAndAdopt-
  // AccountId bug): a signed-in device belongs to a real account and
  // should get real data from sync, never seed defaults locally that
  // might collide with what's about to download. Checked before the
  // transaction, not inside it — this is a read of a completely separate
  // store (localStorage), not a race with the writeTransaction's own
  // emptiness check below.
  if (getAuthAccount()) return;
  try {
    await db.writeTransaction(async (tx) => {
      // The emptiness check must run inside the same transaction as the
      // inserts below, not before it — React StrictMode's dev-mode
      // mount→cleanup→mount double-invokes this function, and
      // writeTransaction calls are serialized (PowerSync queues them on a
      // mutex), so a check done *outside* the transaction can see "empty"
      // for both concurrent calls before either has committed. Checking
      // inside means the second call's check runs only after the first's
      // transaction has fully committed, so it correctly sees non-empty
      // and skips seeding instead of racing on the same hardcoded IDs.
      const existing = await tx.getAll<{ id: string }>('SELECT id FROM categories LIMIT 1');
      if (existing.length > 0) return;

      // One shared timestamp for the whole seed batch rather than a fresh
      // nowUtc() per row — these rows are all "created right now, as one
      // batch," so there's no real distinction between them worth a
      // separate call per insert.
      const seededAt = nowUtc();
      for (const c of seedCategories) {
        await tx.execute(
          `INSERT INTO categories (id, name, kind, parent_id, archived, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
          [c.id, c.name, c.kind, c.parentId, c.archived ? 1 : 0, seededAt],
        );
      }
      for (const k of seedCategoryKeywords) {
        await tx.execute(
          `INSERT INTO category_keywords (id, category_id, keyword, hits) VALUES (?, ?, ?, ?)`,
          [k.id, k.categoryId, k.keyword, k.hits],
        );
      }
    });
  } catch (err) {
    console.error('piggypal: seed transaction FAILED, rolled back', err);
    throw err;
  }
}

// ---- store ----

interface StoreState {
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  budgets: Budget[];
  categoryKeywords: CategoryKeyword[];
}

interface StoreApi extends StoreState {
  addTransaction: (tx: Transaction) => void;
  updateTransaction: (transactionId: string, patch: Partial<Transaction>) => void;
  deleteTransaction: (transactionId: string) => void;
  categorizeTransaction: (transactionId: string, categoryId: string) => void;
  addAccount: (account: Account) => void;
  updateAccount: (accountId: string, patch: Partial<Account>) => void;
  addCategory: (category: Category) => void;
  updateCategory: (categoryId: string, patch: Partial<Category>) => void;
  addBudget: (budget: Budget) => void;
  updateBudget: (budgetId: string, patch: Partial<Budget>) => void;
  removeBudget: (budgetId: string) => void;
  balancesFor: (accountId: string) => { currency: string; cents: number }[];
  defaultAccountId: () => string;
  defaultCurrencyFor: (accountId: string) => string;
  rankedAccounts: () => Account[];
  rankedCurrencies: (accountId: string) => string[];
  rankedCategories: () => Category[];
  rankedMerchants: (excludeTransactionId?: string) => string[];
  // Wipes every local table and reloads so seedIfEmpty repopulates fresh —
  // a dev-stage escape hatch for exactly the situation that keeps
  // recurring while the schema is still actively changing: old rows
  // missing a column that didn't exist when they were written. Not a
  // substitute for real migrations, just the honest option available
  // before this app has any (docs/01 D1 doesn't have a migration story
  // yet, and doesn't need one until there's a real user to migrate).
  resetLocalData: () => Promise<void>;
  // docs/25 D119 / docs/24: applies a peer's full dataset (received over
  // a P2P sync) using docs/24's merge rules. adoptPeerIdentity is docs/25
  // D125-D127's own-device identity unification — true only for the
  // joining device in "my own device" pairing, false for every other
  // case (someone-else pairing, or the non-joining side of an own-device
  // pairing).
  applyPeerDataset: (peer: PeerDataset, adoptPeerIdentity: boolean) => Promise<MergeSummary>;
  // docs/05 D14/D11: rewrites every local row's owner/payer/creator to
  // newId and adopts it as this device's own identity — the auth
  // equivalent of applyPeerDataset's adoptPeerIdentity rewrite, minus the
  // peer-dataset merge (there's no other device's rows to insert here,
  // just this device's own local data reconciling with the account id
  // the server just resolved). Safe to call even when there's nothing to
  // rewrite (fresh device, D14's "skip the prompt" case) — a no-op then.
  adoptAccountId: (newId: string) => Promise<void>;
  // docs/46 D164/D167/D168/D169 — replaces adoptAccountId for the "real
  // local data to reconcile" case: applies mergeMatch.ts's resolved
  // category/account rewrites (a merge/"keep theirs" deletes the local
  // row and cascades every reference to the server's id; a split/"keep
  // mine" gives the local row a fresh id and reinserts it, still
  // cascading references) and, only when `identity` is set (D165's "my
  // own device" branch — never for "someone else"), rewrites owner/payer/
  // creator via the same rewriteOwnerIdentity() applyPeerDataset already
  // uses. One atomic transaction: a partial rewrite would leave
  // references pointing at ids that no longer exist.
  applySignInMergePlan: (plan: {
    categoryRewrites: CategoryRewrite[];
    accountRewrites: AccountRewrite[];
    identity: { newId: string } | null;
  }) => Promise<void>;
  // docs/05 D14's third option, added after real use surfaced the gap:
  // "merge" and "keep separate" don't cover the common case of a
  // never-touched fresh device whose only "existing data" is
  // seedIfEmpty()'s own demo placeholders — nothing worth merging, but
  // "keep separate" means never actually signing in for real either.
  // Wipes local data (db.disconnectAndClear(), same as Settings' Reset
  // local data — clears PowerSync's pending-upload queue too, so none of
  // the discarded demo rows ever get uploaded) and adopts newId as this
  // device's identity outright, no row-rewrite needed since nothing's
  // left to rewrite.
  discardAndAdoptAccountId: (newId: string) => Promise<void>;
  // Manual, user-triggered record-level merge (backlog 2026-08-23) —
  // distinct from applySignInMergePlan above: no matching/reconciliation
  // step, the user has already picked which rows are duplicates. Folds
  // every id in loserIds into survivorId in one atomic write; the picker
  // (AccountsScreen/CategoriesScreen) is responsible for never offering an
  // illegal combination (self-merge, cross-kind, depth-cap violation via
  // manualMerge.ts) — these methods trust their input.
  mergeCategories: (survivorId: string, loserIds: string[]) => Promise<void>;
  mergeAccounts: (survivorId: string, loserIds: string[]) => Promise<void>;
}

const StoreContext = createContext<StoreApi | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<StoreState>({
    accounts: [],
    categories: [],
    transactions: [],
    budgets: [],
    categoryKeywords: [],
  });

  useEffect(() => {
    const controller = new AbortController();

    seedIfEmpty()
      .catch((err) => console.error('piggypal: seed failed', err))
      .finally(() => {
        if (controller.signal.aborted) return;

        // `ready` used to flip true as soon as these five watches were
        // registered, not once they'd actually delivered their first real
        // rows — db.watch()'s first callback (even with triggerImmediate)
        // still crosses an async round-trip to the wa-sqlite worker, so
        // real content briefly rendered with every field still at its
        // initial-state default `[]`. That's not "no data," but looked
        // exactly like RecentList's genuine empty state ("Nothing logged
        // yet"), a real bug found from a real report. `ready` now waits
        // for every table's first snapshot before showing real content —
        // AppSkeleton stays up for that whole window instead.
        const pendingFirstLoad = new Set(['accounts', 'categories', 'transactions', 'budgets', 'categoryKeywords']);
        function markFirstLoad(table: string) {
          if (pendingFirstLoad.delete(table) && pendingFirstLoad.size === 0) setReady(true);
        }

        db.watch(
          'SELECT * FROM accounts',
          [],
          {
            onResult: (r) => {
              setState((s) => ({ ...s, accounts: r.rows?._array.map(rowToAccount) ?? [] }));
              markFirstLoad('accounts');
            },
            onError: (err) => {
              console.error('piggypal: accounts watch failed', err);
              markFirstLoad('accounts');
            },
          },
          // triggerImmediate: without it, watch() only fires on a FUTURE
          // table change — it does not proactively query current state on
          // setup. Since seeding already happened by this point, omitting
          // this silently starves every watch of its initial data (no
          // error, just an empty array forever, until something else
          // happens to write to the table).
          { signal: controller.signal, triggerImmediate: true },
        );
        db.watch(
          'SELECT * FROM categories',
          [],
          {
            onResult: (r) => {
              setState((s) => ({ ...s, categories: r.rows?._array.map(rowToCategory) ?? [] }));
              markFirstLoad('categories');
            },
            onError: (err) => {
              console.error('piggypal: categories watch failed', err);
              markFirstLoad('categories');
            },
          },
          // triggerImmediate: without it, watch() only fires on a FUTURE
          // table change — it does not proactively query current state on
          // setup. Since seeding already happened by this point, omitting
          // this silently starves every watch of its initial data (no
          // error, just an empty array forever, until something else
          // happens to write to the table).
          { signal: controller.signal, triggerImmediate: true },
        );
        db.watch(
          'SELECT * FROM transactions ORDER BY occurred_at DESC',
          [],
          {
            onResult: (r) => {
              setState((s) => ({ ...s, transactions: r.rows?._array.map(rowToTransaction) ?? [] }));
              markFirstLoad('transactions');
            },
            onError: (err) => {
              console.error('piggypal: transactions watch failed', err);
              markFirstLoad('transactions');
            },
          },
          // triggerImmediate: without it, watch() only fires on a FUTURE
          // table change — it does not proactively query current state on
          // setup. Since seeding already happened by this point, omitting
          // this silently starves every watch of its initial data (no
          // error, just an empty array forever, until something else
          // happens to write to the table).
          { signal: controller.signal, triggerImmediate: true },
        );
        db.watch(
          'SELECT * FROM budgets',
          [],
          {
            onResult: (r) => {
              setState((s) => ({ ...s, budgets: r.rows?._array.map(rowToBudget) ?? [] }));
              markFirstLoad('budgets');
            },
            onError: (err) => {
              console.error('piggypal: budgets watch failed', err);
              markFirstLoad('budgets');
            },
          },
          // triggerImmediate: without it, watch() only fires on a FUTURE
          // table change — it does not proactively query current state on
          // setup. Since seeding already happened by this point, omitting
          // this silently starves every watch of its initial data (no
          // error, just an empty array forever, until something else
          // happens to write to the table).
          { signal: controller.signal, triggerImmediate: true },
        );
        db.watch(
          'SELECT * FROM category_keywords',
          [],
          {
            onResult: (r) => {
              setState((s) => ({ ...s, categoryKeywords: r.rows?._array.map(rowToCategoryKeyword) ?? [] }));
              markFirstLoad('categoryKeywords');
            },
            onError: (err) => {
              console.error('piggypal: category_keywords watch failed', err);
              markFirstLoad('categoryKeywords');
            },
          },
          { signal: controller.signal, triggerImmediate: true },
        );
      });

    return () => controller.abort();
  }, []);

  // docs/05 "Reconnect after weeks offline": the access JWT is memory-only
  // (D13) and lost on every reload, but a prior sign-in on this device is
  // still remembered (auth.ts's non-secret email/userId marker) — attempt
  // a silent reconnect via the refresh cookie once on load rather than
  // requiring a fresh sign-in every time the app is opened. connectSync's
  // fetchCredentials returning null (cookie expired/revoked) just leaves
  // the SDK disconnected; nothing here needs to distinguish why.
  useEffect(() => {
    if (getAuthAccount()) void connectSync();
  }, []);

  const api = useMemo<StoreApi>(() => {
    const activeTx = () =>
      [...state.transactions]
        .filter((t) => !t.deletedAt)
        .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));

    return {
      ...state,

      addTransaction(tx) {
        void db.execute(
          `INSERT INTO transactions (id, account_id, category_id, amount_cents, currency, occurred_at, note, merchant, source, ai_raw, deleted_at, paid_by_user_id, created_by_user_id, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [tx.id, tx.accountId, tx.categoryId, tx.amountCents, tx.currency, tx.occurredAt, tx.note, tx.merchant, tx.source, tx.aiRaw, tx.deletedAt, tx.paidByUserId, tx.createdByUserId, tx.updatedAt],
        );
      },

      // docs/46 D170 — updated_at always bumped to now, regardless of
      // what's in patch: every updateX(patch) call site would otherwise
      // need to separately remember to include it, and any real change
      // to a row is, by definition, an update "now."
      updateTransaction(transactionId, patch) {
        const entries = (Object.entries(patch) as [keyof Transaction, unknown][]).filter(([k]) => k !== 'updatedAt');
        if (entries.length === 0) return;
        const setClause = entries.map(([k]) => `${TRANSACTION_COLUMNS[k]} = ?`).join(', ');
        void db.execute(`UPDATE transactions SET ${setClause}, updated_at = ? WHERE id = ?`, [
          ...entries.map(([, v]) => v),
          nowUtc(),
          transactionId,
        ]);
      },

      // Soft delete (deleted_at), not a real DELETE — db/schema.sql's
      // design principle: a device offline during a delete converges
      // cleanly, and it's how every list already filters (activeTx()).
      deleteTransaction(transactionId) {
        const now = nowUtc();
        void db.execute('UPDATE transactions SET deleted_at = ?, updated_at = ? WHERE id = ?', [
          now,
          now,
          transactionId,
        ]);
      },

      // docs/07 D26: categorize an inbox item in place.
      categorizeTransaction(transactionId, categoryId) {
        void db.execute('UPDATE transactions SET category_id = ?, updated_at = ? WHERE id = ?', [
          categoryId,
          nowUtc(),
          transactionId,
        ]);
      },

      addAccount(account) {
        void insertAccountRow(account);
      },

      // Also how archiving works (docs/12 D56) — updateAccount(id, { archived: true }).
      updateAccount(accountId, patch) {
        const entries = (Object.entries(patch) as [keyof Account, unknown][]).filter(([k]) => k !== 'updatedAt');
        if (entries.length === 0) return;
        const setClause = entries.map(([k]) => `${ACCOUNT_COLUMNS[k]} = ?`).join(', ');
        const params = entries.map(([k, v]) => (k === 'archived' ? (v ? 1 : 0) : v));
        void db.execute(`UPDATE accounts SET ${setClause}, updated_at = ? WHERE id = ?`, [...params, nowUtc(), accountId]);
      },

      addCategory(category) {
        void db.execute(
          `INSERT INTO categories (id, name, kind, parent_id, archived, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
          [category.id, category.name, category.kind, category.parentId, category.archived ? 1 : 0, category.updatedAt],
        );
      },

      updateCategory(categoryId, patch) {
        const entries = (Object.entries(patch) as [keyof Category, unknown][]).filter(([k]) => k !== 'updatedAt');
        if (entries.length === 0) return;
        const setClause = entries.map(([k]) => `${CATEGORY_COLUMNS[k]} = ?`).join(', ');
        const params = entries.map(([k, v]) => (k === 'archived' ? (v ? 1 : 0) : v));
        void db.execute(`UPDATE categories SET ${setClause}, updated_at = ? WHERE id = ?`, [...params, nowUtc(), categoryId]);
      },

      addBudget(budget) {
        void db.execute(
          `INSERT INTO budgets (id, category_id, month, currency, amount_cents, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
          [budget.id, budget.categoryId, budget.month, budget.currency, budget.amountCents, budget.updatedAt],
        );
      },

      updateBudget(budgetId, patch) {
        const entries = (Object.entries(patch) as [keyof Budget, unknown][]).filter(([k]) => k !== 'updatedAt');
        if (entries.length === 0) return;
        const setClause = entries.map(([k]) => `${BUDGET_COLUMNS[k]} = ?`).join(', ');
        void db.execute(`UPDATE budgets SET ${setClause}, updated_at = ? WHERE id = ?`, [
          ...entries.map(([, v]) => v),
          nowUtc(),
          budgetId,
        ]);
      },

      // Budgets have no archived/deleted_at column (db/schema.sql) — unlike
      // accounts/categories/transactions, there's no reason to keep a
      // removed budget target around, so this is a real delete.
      removeBudget(budgetId) {
        void db.execute('DELETE FROM budgets WHERE id = ?', [budgetId]);
      },

      // docs/12 D58: one balance line per currency actually present, never merged.
      balancesFor(accountId) {
        const totals = new Map<string, number>();
        for (const t of activeTx()) {
          if (t.accountId !== accountId) continue;
          totals.set(t.currency, (totals.get(t.currency) ?? 0) + t.amountCents);
        }
        return [...totals.entries()].map(([currency, cents]) => ({ currency, cents }));
      },

      // D45/D46: defaults are derived from transaction history, not stored.
      defaultAccountId() {
        const recent = activeTx()[0];
        return recent?.accountId ?? state.accounts[0]?.id ?? '';
      },

      // Accounts don't have a currency of their own (see Account) — the
      // default shown for a new entry is this account's own last-used
      // currency if it has history, else the most recent transaction on
      // any account, else a hardcoded fallback.
      defaultCurrencyFor(accountId) {
        const recentOnAccount = activeTx().find((t) => t.accountId === accountId);
        if (recentOnAccount) return recentOnAccount.currency;
        return activeTx()[0]?.currency ?? 'CAD';
      },

      rankedAccounts() {
        const counts = new Map<string, number>();
        for (const t of activeTx()) counts.set(t.accountId, (counts.get(t.accountId) ?? 0) + 1);
        return [...state.accounts]
          .filter((a) => !a.archived)
          .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0));
      },

      // Ranked by this account's own transaction-currency history first
      // (accounts don't carry a currency of their own to seed with), then
      // every currency in use on any account, then sensible defaults — so
      // an account whose history is (or starts) single-currency is still
      // switchable to any currency in use elsewhere.
      rankedCurrencies(accountId) {
        const counts = new Map<string, number>();
        for (const t of activeTx()) if (t.accountId === accountId) {
          counts.set(t.currency, (counts.get(t.currency) ?? 0) + 1);
        }
        const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
        const seen = new Set<string>(ranked);
        for (const t of activeTx()) seen.add(t.currency);
        for (const c of ['CAD', 'BRL', 'USD']) seen.add(c);
        return [...seen];
      },

      rankedCategories() {
        const counts = new Map<string, number>();
        for (const t of activeTx()) {
          if (t.categoryId) counts.set(t.categoryId, (counts.get(t.categoryId) ?? 0) + 1);
        }
        return [...state.categories]
          .filter((c) => !c.archived && c.kind === 'expense')
          .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0));
      },

      // docs/15 D79: recency-ranked, not frequency — same signal as the
      // account/currency defaults (D45/D46). activeTx() is already sorted
      // occurredAt DESC, so a Set's insertion order (first-seen-wins) gives
      // exactly "most recently used first" for free.
      //
      // excludeTransactionId matters because the edit form autosaves the
      // Location field per keystroke (same pattern as Note): without
      // excluding the row being edited, its own in-progress text round-
      // trips through the DB and reappears here as a "suggestion" of
      // itself mid-typing.
      rankedMerchants(excludeTransactionId) {
        const seen = new Set<string>();
        for (const t of activeTx()) {
          if (t.merchant && t.id !== excludeTransactionId) seen.add(t.merchant);
        }
        return [...seen];
      },

      async adoptAccountId(newId) {
        await db.writeTransaction(async (tx) => {
          await rewriteOwnerIdentity(tx, getLocalUserId(), newId);
        });
      },

      async applySignInMergePlan(plan) {
        await db.writeTransaction(async (tx) => {
          for (const r of plan.categoryRewrites) {
            // DELETE + INSERT, not an UPDATE of the id column itself —
            // PowerSync's CRUD tracking (and the server's PATCH handler,
            // which never touches id) has no concept of "rename this row's
            // id," only insert/update/delete of a row at a given id. A
            // merge's `reinsert: null` means exactly that: delete the
            // local duplicate, nothing to re-add since the server already
            // has it at newId.
            await tx.execute('DELETE FROM categories WHERE id = ?', [r.oldId]);
            if (r.reinsert) {
              await tx.execute(
                `INSERT INTO categories (id, name, kind, parent_id, archived, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
                [r.newId, r.reinsert.name, r.reinsert.kind, r.reinsert.parentId, r.reinsert.archived ? 1 : 0, r.reinsert.updatedAt],
              );
            }
            // Cascade every reference — a child's parent_id, and every
            // table that points at a category by id. Categories are only
            // 2 levels deep (docs/14 D70) and mergeMatch.ts resolves
            // parents before children, so by the time a child's own
            // rewrite (if any) runs here, this has already moved it onto
            // the parent's real final id. Shared with the manual
            // merge-duplicates tool below (mergeCategories).
            await cascadeCategoryReferences(tx, r.oldId, r.newId);
          }

          for (const r of plan.accountRewrites) {
            await tx.execute('DELETE FROM accounts WHERE id = ?', [r.oldId]);
            if (r.reinsert) {
              await tx.execute(
                `INSERT INTO accounts (id, institution, name, kind, archived, owner_user_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [r.newId, r.reinsert.institution, r.reinsert.name, r.reinsert.kind, r.reinsert.archived ? 1 : 0, r.reinsert.ownerUserId, r.reinsert.updatedAt],
              );
            }
            await cascadeAccountReferences(tx, r.oldId, r.newId);
          }

          // D165: identity is only ever rewritten for "my own device" —
          // never for "someone else," where this device's own local
          // identity staying distinct is the entire point.
          if (plan.identity) {
            await rewriteOwnerIdentity(tx, getLocalUserId(), plan.identity.newId);
          }
        });
      },

      async mergeCategories(survivorId, loserIds) {
        await db.writeTransaction(async (tx) => {
          for (const loserId of loserIds) {
            if (loserId === survivorId) continue;
            await mergeCategoryInto(tx, loserId, survivorId);
          }
        });
      },

      async mergeAccounts(survivorId, loserIds) {
        await db.writeTransaction(async (tx) => {
          for (const loserId of loserIds) {
            if (loserId === survivorId) continue;
            await mergeAccountInto(tx, loserId, survivorId);
          }
        });
      },

      async discardAndAdoptAccountId(newId) {
        await db.disconnectAndClear();
        setLocalUserId(newId);
        // docs/46 D165/D166: discarding directly unifies this device's
        // identity with the account (setLocalUserId above) regardless of
        // who's physically using it — there's no pre-existing personal
        // data left to misattribute. That's "own device" semantics, so a
        // repeat sign-in on this same device shouldn't re-ask the fork.
        setDeviceRole('own');
      },

      async resetLocalData() {
        // db.disconnectAndClear() — PowerSync's own "use this when logging
        // out" API — not a hand-rolled DELETE FROM loop (what this used to
        // be). A real bug, found testing a real signed-in device: manual
        // DELETEs only clear the app's own visible table rows, not
        // PowerSync's separate internal pending-upload queue/oplog — a
        // failed upload (docs/45's categories/accounts uuid mismatches)
        // stayed queued forever, surviving every reset, permanently
        // blocking every upload attempted after it since the SDK always
        // retries the oldest pending operation first. disconnectAndClear
        // clears both together, and disconnects the sync stream too.
        await db.disconnectAndClear();
        // The wipe above doesn't touch peers.ts' localStorage list —
        // left alone, Settings would still show paired devices pointing at
        // data that no longer exists, and a "repeat sync" (docs/25 D138)
        // would skip straight past the merge prompt for a peer this device
        // no longer actually shares any history with.
        clearPairedPeers();
        // Same reasoning, found testing this for real (docs/45-adjacent):
        // leaving auth.ts's "signed in as ___" marker behind made a reset
        // device look still signed in, so it auto-attempted a reconnect
        // using a refresh cookie reset can't touch (server-side, httpOnly)
        // — a confusing 401 for what's actually a correct "fresh device"
        // state. A reset device is signed out, full stop; signing back in
        // mints a real new session same as any other fresh device would.
        clearAuthAccount();
        // docs/46 D165/D166 — same reasoning as the two clears above: a
        // reset device has no memory of anything, including which role
        // (own device / someone else) it last answered at sign-in.
        clearDeviceRole();
        // docs/46 — a real bug found testing this for real: a device that
        // had ever adopted a real account's id (any earlier "Merge into my
        // account") kept that id across every subsequent reset, so its
        // next sign-in saw "already the same identity" and skipped straight
        // past the household fork *and* the whole merge cascade, even
        // though the fresh post-reset local data was never reconciled with
        // anything. See identity.ts's clearLocalUserId() for the full
        // trace — this is what makes "reset" actually mean reset.
        clearLocalUserId();
        window.location.reload();
      },

      // docs/24's merge algorithm, implemented against local SQLite
      // directly rather than a household_id-partitioned bucket — there's
      // no household_id column locally (schema.ts's own principle: no
      // sync-partition columns until there's something to partition), so
      // "merge" here just means "apply the same per-table rules docs/24
      // specifies, against the one local dataset this device has."
      async applyPeerDataset(peer, adoptPeerIdentity) {
        const summary: MergeSummary = {
          categoriesAdded: 0,
          accountsAdded: 0,
          transactionsAdded: 0,
          budgetsAdded: 0,
          budgetsUpdated: 0,
        };

        await db.writeTransaction(async (tx) => {
          // docs/25 D126: rewrite this device's own existing rows to the
          // peer's identity BEFORE inserting the peer's rows — the peer's
          // own rows already carry that same id by construction (it's
          // their getLocalUserId()), so once this rewrite lands, every
          // row this device ends up with (old-and-relabeled, plus
          // newly-merged-in) agrees on one identity. Only rewrites if the
          // ids actually differ, so calling this twice (or against a peer
          // that's already the same person) is a safe no-op.
          if (adoptPeerIdentity) {
            await rewriteOwnerIdentity(tx, getLocalUserId(), peer.localUserId);
          }

          // Categories — merge by id (docs/24): seed categories share
          // deterministic ids across installs, so an id that already
          // exists locally is the same category, not a new one.
          for (const c of peer.categories) {
            const existing = await tx.getAll<{ id: string }>('SELECT id FROM categories WHERE id = ?', [c.id]);
            if (existing.length > 0) continue;
            await tx.execute(
              `INSERT INTO categories (id, name, kind, parent_id, archived, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
              [c.id, c.name, c.kind, c.parentId, c.archived ? 1 : 0, c.updatedAt],
            );
            summary.categoriesAdded += 1;
          }

          // Accounts — never merged, always moved (docs/24 D112): each is
          // a real, distinct payment instrument. The existence check is
          // defensive only (D113 already makes id collisions practically
          // impossible), not a merge rule.
          for (const a of peer.accounts) {
            const existing = await tx.getAll<{ id: string }>('SELECT id FROM accounts WHERE id = ?', [a.id]);
            if (existing.length > 0) continue;
            await tx.execute(
              `INSERT INTO accounts (id, institution, name, kind, archived, owner_user_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [a.id, a.institution, a.name, a.kind, a.archived ? 1 : 0, a.ownerUserId, a.updatedAt],
            );
            summary.accountsAdded += 1;
          }

          // Transactions — always inserted as distinct events, same
          // defensive-only existence check as accounts.
          for (const t of peer.transactions) {
            const existing = await tx.getAll<{ id: string }>('SELECT id FROM transactions WHERE id = ?', [t.id]);
            if (existing.length > 0) continue;
            await tx.execute(
              `INSERT INTO transactions (id, account_id, category_id, amount_cents, currency, occurred_at, note, merchant, source, ai_raw, deleted_at, paid_by_user_id, created_by_user_id, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                t.id,
                t.accountId,
                t.categoryId,
                t.amountCents,
                t.currency,
                t.occurredAt,
                t.note,
                t.merchant,
                t.source,
                t.aiRaw,
                t.deletedAt,
                t.paidByUserId,
                t.createdByUserId,
                t.updatedAt,
              ],
            );
            summary.transactionsAdded += 1;
          }

          // Budgets — docs/24's one real collision case: two pre-existing
          // budgets for the same (category, month, currency) resolve to
          // the greater amount, not a duplicate row.
          for (const b of peer.budgets) {
            const existing = await tx.getAll<{ id: string; amount_cents: number }>(
              'SELECT id, amount_cents FROM budgets WHERE category_id = ? AND month = ? AND currency = ?',
              [b.categoryId, b.month, b.currency],
            );
            if (existing.length === 0) {
              await tx.execute(
                `INSERT INTO budgets (id, category_id, month, currency, amount_cents, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
                [b.id, b.categoryId, b.month, b.currency, b.amountCents, b.updatedAt],
              );
              summary.budgetsAdded += 1;
            } else if (b.amountCents > existing[0].amount_cents) {
              await tx.execute('UPDATE budgets SET amount_cents = ?, updated_at = ? WHERE id = ?', [
                b.amountCents,
                b.updatedAt,
                existing[0].id,
              ]);
              summary.budgetsUpdated += 1;
            }
          }
        });

        return summary;
      },
    };
  }, [state]);

  if (!ready) return <AppSkeleton />;

  return <StoreContext.Provider value={api}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreApi {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}

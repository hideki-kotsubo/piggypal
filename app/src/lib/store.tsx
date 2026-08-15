import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { db } from './db';
import { getLocalUserId, setLocalUserId } from './identity';
import type { Account, AccountKind, Budget, Category, CategoryKeyword, MergeSummary, PeerDataset, Transaction } from './types';
import { seedAccounts, seedBudgets, seedCategories, seedCategoryKeywords, seedTransactions } from './seed';

// Real local data layer — docs/01 D1 (on-device SQLite via wa-sqlite/
// PowerSync web SDK), running in local-only mode (no connector passed to
// PowerSyncDatabase in db.ts, so nothing here ever touches a network).
// Sync/auth are a distinct, later phase. Replaces the earlier localStorage
// scaffolding, but keeps the exact same StoreApi shape below so no
// component needed to change.

// ---- row <-> domain mapping (SQLite is snake_case, our types are camelCase) ----

interface AccountRow {
  id: string;
  institution: string | null;
  name: string;
  kind: string;
  archived: number;
  owner_user_id: string | null; // see rowToAccount's fallback note
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
  };
}

interface CategoryRow {
  id: string;
  name: string;
  kind: string;
  parent_id: string | null;
  archived: number;
}
function rowToCategory(r: CategoryRow): Category {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind as Category['kind'],
    parentId: r.parent_id,
    archived: Boolean(r.archived),
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
  };
}

interface BudgetRow {
  id: string;
  category_id: string;
  month: string;
  currency: string;
  amount_cents: number;
}
function rowToBudget(r: BudgetRow): Budget {
  return { id: r.id, categoryId: r.category_id, month: r.month, currency: r.currency, amountCents: r.amount_cents };
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
};

const CATEGORY_COLUMNS: Record<keyof Category, string> = {
  id: 'id',
  name: 'name',
  kind: 'kind',
  parentId: 'parent_id',
  archived: 'archived',
};

const BUDGET_COLUMNS: Record<keyof Budget, string> = {
  id: 'id',
  categoryId: 'category_id',
  month: 'month',
  currency: 'currency',
  amountCents: 'amount_cents',
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
};

// Shared by seeding and addAccount — one place that knows the accounts
// INSERT shape.
async function insertAccountRow(a: Account): Promise<void> {
  await db.execute(
    `INSERT INTO accounts (id, institution, name, kind, archived, owner_user_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [a.id, a.institution, a.name, a.kind, a.archived ? 1 : 0, a.ownerUserId],
  );
}

// ---- one-time seed on an empty database ----

async function seedIfEmpty() {
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
      const existing = await tx.getAll<{ id: string }>('SELECT id FROM accounts LIMIT 1');
      if (existing.length > 0) return;

      for (const a of seedAccounts) {
        await tx.execute(
          `INSERT INTO accounts (id, institution, name, kind, archived, owner_user_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [a.id, a.institution, a.name, a.kind, a.archived ? 1 : 0, a.ownerUserId],
        );
      }
      for (const c of seedCategories) {
        await tx.execute(
          `INSERT INTO categories (id, name, kind, parent_id, archived) VALUES (?, ?, ?, ?, ?)`,
          [c.id, c.name, c.kind, c.parentId, c.archived ? 1 : 0],
        );
      }
      for (const t of seedTransactions) {
        await tx.execute(
          `INSERT INTO transactions (id, account_id, category_id, amount_cents, currency, occurred_at, note, merchant, source, ai_raw, deleted_at, paid_by_user_id, created_by_user_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [t.id, t.accountId, t.categoryId, t.amountCents, t.currency, t.occurredAt, t.note, t.merchant, t.source, t.aiRaw, t.deletedAt, t.paidByUserId, t.createdByUserId],
        );
      }
      for (const b of seedBudgets) {
        await tx.execute(
          `INSERT INTO budgets (id, category_id, month, currency, amount_cents) VALUES (?, ?, ?, ?, ?)`,
          [b.id, b.categoryId, b.month, b.currency, b.amountCents],
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

        db.watch(
          'SELECT * FROM accounts',
          [],
          {
            onResult: (r) =>
              setState((s) => ({ ...s, accounts: r.rows?._array.map(rowToAccount) ?? [] })),
            onError: (err) => console.error('piggypal: accounts watch failed', err),
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
            onResult: (r) =>
              setState((s) => ({ ...s, categories: r.rows?._array.map(rowToCategory) ?? [] })),
            onError: (err) => console.error('piggypal: categories watch failed', err),
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
            onResult: (r) =>
              setState((s) => ({ ...s, transactions: r.rows?._array.map(rowToTransaction) ?? [] })),
            onError: (err) => console.error('piggypal: transactions watch failed', err),
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
            onResult: (r) =>
              setState((s) => ({ ...s, budgets: r.rows?._array.map(rowToBudget) ?? [] })),
            onError: (err) => console.error('piggypal: budgets watch failed', err),
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
            onResult: (r) =>
              setState((s) => ({ ...s, categoryKeywords: r.rows?._array.map(rowToCategoryKeyword) ?? [] })),
            onError: (err) => console.error('piggypal: category_keywords watch failed', err),
          },
          { signal: controller.signal, triggerImmediate: true },
        );

        setReady(true);
      });

    return () => controller.abort();
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
          `INSERT INTO transactions (id, account_id, category_id, amount_cents, currency, occurred_at, note, merchant, source, ai_raw, deleted_at, paid_by_user_id, created_by_user_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [tx.id, tx.accountId, tx.categoryId, tx.amountCents, tx.currency, tx.occurredAt, tx.note, tx.merchant, tx.source, tx.aiRaw, tx.deletedAt, tx.paidByUserId, tx.createdByUserId],
        );
      },

      updateTransaction(transactionId, patch) {
        const entries = Object.entries(patch) as [keyof Transaction, unknown][];
        if (entries.length === 0) return;
        const setClause = entries.map(([k]) => `${TRANSACTION_COLUMNS[k]} = ?`).join(', ');
        void db.execute(`UPDATE transactions SET ${setClause} WHERE id = ?`, [...entries.map(([, v]) => v), transactionId]);
      },

      // Soft delete (deleted_at), not a real DELETE — db/schema.sql's
      // design principle: a device offline during a delete converges
      // cleanly, and it's how every list already filters (activeTx()).
      deleteTransaction(transactionId) {
        void db.execute('UPDATE transactions SET deleted_at = ? WHERE id = ?', [
          new Date().toISOString(),
          transactionId,
        ]);
      },

      // docs/07 D26: categorize an inbox item in place.
      categorizeTransaction(transactionId, categoryId) {
        void db.execute('UPDATE transactions SET category_id = ? WHERE id = ?', [categoryId, transactionId]);
      },

      addAccount(account) {
        void insertAccountRow(account);
      },

      // Also how archiving works (docs/12 D56) — updateAccount(id, { archived: true }).
      updateAccount(accountId, patch) {
        const entries = Object.entries(patch) as [keyof Account, unknown][];
        if (entries.length === 0) return;
        const setClause = entries.map(([k]) => `${ACCOUNT_COLUMNS[k]} = ?`).join(', ');
        const params = entries.map(([k, v]) => (k === 'archived' ? (v ? 1 : 0) : v));
        void db.execute(`UPDATE accounts SET ${setClause} WHERE id = ?`, [...params, accountId]);
      },

      addCategory(category) {
        void db.execute(
          `INSERT INTO categories (id, name, kind, parent_id, archived) VALUES (?, ?, ?, ?, ?)`,
          [category.id, category.name, category.kind, category.parentId, category.archived ? 1 : 0],
        );
      },

      updateCategory(categoryId, patch) {
        const entries = Object.entries(patch) as [keyof Category, unknown][];
        if (entries.length === 0) return;
        const setClause = entries.map(([k]) => `${CATEGORY_COLUMNS[k]} = ?`).join(', ');
        const params = entries.map(([k, v]) => (k === 'archived' ? (v ? 1 : 0) : v));
        void db.execute(`UPDATE categories SET ${setClause} WHERE id = ?`, [...params, categoryId]);
      },

      addBudget(budget) {
        void db.execute(
          `INSERT INTO budgets (id, category_id, month, currency, amount_cents) VALUES (?, ?, ?, ?, ?)`,
          [budget.id, budget.categoryId, budget.month, budget.currency, budget.amountCents],
        );
      },

      updateBudget(budgetId, patch) {
        const entries = Object.entries(patch) as [keyof Budget, unknown][];
        if (entries.length === 0) return;
        const setClause = entries.map(([k]) => `${BUDGET_COLUMNS[k]} = ?`).join(', ');
        void db.execute(`UPDATE budgets SET ${setClause} WHERE id = ?`, [...entries.map(([, v]) => v), budgetId]);
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

      async resetLocalData() {
        await db.writeTransaction(async (tx) => {
          await tx.execute('DELETE FROM transactions');
          await tx.execute('DELETE FROM budgets');
          await tx.execute('DELETE FROM category_keywords');
          await tx.execute('DELETE FROM categories');
          await tx.execute('DELETE FROM accounts');
        });
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
            const oldId = getLocalUserId();
            const newId = peer.localUserId;
            if (oldId !== newId) {
              await tx.execute('UPDATE accounts SET owner_user_id = ? WHERE owner_user_id = ?', [newId, oldId]);
              await tx.execute('UPDATE transactions SET paid_by_user_id = ? WHERE paid_by_user_id = ?', [newId, oldId]);
              await tx.execute('UPDATE transactions SET created_by_user_id = ? WHERE created_by_user_id = ?', [
                newId,
                oldId,
              ]);
              setLocalUserId(newId);
            }
          }

          // Categories — merge by id (docs/24): seed categories share
          // deterministic ids across installs, so an id that already
          // exists locally is the same category, not a new one.
          for (const c of peer.categories) {
            const existing = await tx.getAll<{ id: string }>('SELECT id FROM categories WHERE id = ?', [c.id]);
            if (existing.length > 0) continue;
            await tx.execute(`INSERT INTO categories (id, name, kind, parent_id, archived) VALUES (?, ?, ?, ?, ?)`, [
              c.id,
              c.name,
              c.kind,
              c.parentId,
              c.archived ? 1 : 0,
            ]);
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
              `INSERT INTO accounts (id, institution, name, kind, archived, owner_user_id) VALUES (?, ?, ?, ?, ?, ?)`,
              [a.id, a.institution, a.name, a.kind, a.archived ? 1 : 0, a.ownerUserId],
            );
            summary.accountsAdded += 1;
          }

          // Transactions — always inserted as distinct events, same
          // defensive-only existence check as accounts.
          for (const t of peer.transactions) {
            const existing = await tx.getAll<{ id: string }>('SELECT id FROM transactions WHERE id = ?', [t.id]);
            if (existing.length > 0) continue;
            await tx.execute(
              `INSERT INTO transactions (id, account_id, category_id, amount_cents, currency, occurred_at, note, merchant, source, ai_raw, deleted_at, paid_by_user_id, created_by_user_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
              await tx.execute(`INSERT INTO budgets (id, category_id, month, currency, amount_cents) VALUES (?, ?, ?, ?, ?)`, [
                b.id,
                b.categoryId,
                b.month,
                b.currency,
                b.amountCents,
              ]);
              summary.budgetsAdded += 1;
            } else if (b.amountCents > existing[0].amount_cents) {
              await tx.execute('UPDATE budgets SET amount_cents = ? WHERE id = ?', [b.amountCents, existing[0].id]);
              summary.budgetsUpdated += 1;
            }
          }
        });

        return summary;
      },
    };
  }, [state]);

  if (!ready) return null;

  return <StoreContext.Provider value={api}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreApi {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}

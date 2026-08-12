import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { db } from './db';
import type { Account, AccountKind, Budget, Category, Transaction } from './types';
import { seedAccounts, seedBudgets, seedCategories, seedTransactions } from './seed';

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
}
function rowToAccount(r: AccountRow): Account {
  return {
    id: r.id,
    institution: r.institution,
    name: r.name,
    kind: r.kind as AccountKind,
    archived: Boolean(r.archived),
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
  source: string;
  ai_raw: string | null;
  deleted_at: string | null;
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
    source: r.source as Transaction['source'],
    aiRaw: r.ai_raw,
    deletedAt: r.deleted_at,
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

const ACCOUNT_COLUMNS: Record<keyof Account, string> = {
  id: 'id',
  institution: 'institution',
  name: 'name',
  kind: 'kind',
  archived: 'archived',
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
  source: 'source',
  aiRaw: 'ai_raw',
  deletedAt: 'deleted_at',
};

// Shared by seeding and addAccount — one place that knows the accounts
// INSERT shape.
async function insertAccountRow(a: Account): Promise<void> {
  await db.execute(
    `INSERT INTO accounts (id, institution, name, kind, archived)
     VALUES (?, ?, ?, ?, ?)`,
    [a.id, a.institution, a.name, a.kind, a.archived ? 1 : 0],
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
          `INSERT INTO accounts (id, institution, name, kind, archived)
           VALUES (?, ?, ?, ?, ?)`,
          [a.id, a.institution, a.name, a.kind, a.archived ? 1 : 0],
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
          `INSERT INTO transactions (id, account_id, category_id, amount_cents, currency, occurred_at, note, source, ai_raw, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [t.id, t.accountId, t.categoryId, t.amountCents, t.currency, t.occurredAt, t.note, t.source, t.aiRaw, t.deletedAt],
        );
      }
      for (const b of seedBudgets) {
        await tx.execute(
          `INSERT INTO budgets (id, category_id, month, currency, amount_cents) VALUES (?, ?, ?, ?, ?)`,
          [b.id, b.categoryId, b.month, b.currency, b.amountCents],
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
  // Wipes every local table and reloads so seedIfEmpty repopulates fresh —
  // a dev-stage escape hatch for exactly the situation that keeps
  // recurring while the schema is still actively changing: old rows
  // missing a column that didn't exist when they were written. Not a
  // substitute for real migrations, just the honest option available
  // before this app has any (docs/01 D1 doesn't have a migration story
  // yet, and doesn't need one until there's a real user to migrate).
  resetLocalData: () => Promise<void>;
}

const StoreContext = createContext<StoreApi | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<StoreState>({
    accounts: [],
    categories: [],
    transactions: [],
    budgets: [],
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
          `INSERT INTO transactions (id, account_id, category_id, amount_cents, currency, occurred_at, note, source, ai_raw, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [tx.id, tx.accountId, tx.categoryId, tx.amountCents, tx.currency, tx.occurredAt, tx.note, tx.source, tx.aiRaw, tx.deletedAt],
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

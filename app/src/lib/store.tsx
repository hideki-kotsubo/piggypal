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
  currency: string;
  goal_amount_cents: number | null;
  goal_target_date: string | null;
  archived: number;
}
function rowToAccount(r: AccountRow): Account {
  return {
    id: r.id,
    institution: r.institution,
    name: r.name,
    kind: r.kind as AccountKind,
    currency: r.currency,
    goalAmountCents: r.goal_amount_cents,
    goalTargetDate: r.goal_target_date,
    archived: Boolean(r.archived),
  };
}

interface CategoryRow {
  id: string;
  name: string;
  kind: string;
  archived: number;
}
function rowToCategory(r: CategoryRow): Category {
  return { id: r.id, name: r.name, kind: r.kind as Category['kind'], archived: Boolean(r.archived) };
}

interface TransactionRow {
  id: string;
  account_id: string;
  category_id: string | null;
  amount_cents: number;
  currency: string;
  occurred_on: string;
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
    occurredOn: r.occurred_on,
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
  currency: 'currency',
  goalAmountCents: 'goal_amount_cents',
  goalTargetDate: 'goal_target_date',
  archived: 'archived',
};

// ---- one-time seed on an empty database ----

async function seedIfEmpty() {
  const existing = await db.getAll<{ id: string }>('SELECT id FROM accounts LIMIT 1');
  if (existing.length > 0) return;

  try {
    await db.writeTransaction(async (tx) => {
      for (const a of seedAccounts) {
        await tx.execute(
          `INSERT INTO accounts (id, institution, name, kind, currency, goal_amount_cents, goal_target_date, archived)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [a.id, a.institution, a.name, a.kind, a.currency, a.goalAmountCents, a.goalTargetDate, a.archived ? 1 : 0],
        );
      }
      for (const c of seedCategories) {
        await tx.execute(
          `INSERT INTO categories (id, name, kind, archived) VALUES (?, ?, ?, ?)`,
          [c.id, c.name, c.kind, c.archived ? 1 : 0],
        );
      }
      for (const t of seedTransactions) {
        await tx.execute(
          `INSERT INTO transactions (id, account_id, category_id, amount_cents, currency, occurred_on, note, source, ai_raw, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [t.id, t.accountId, t.categoryId, t.amountCents, t.currency, t.occurredOn, t.note, t.source, t.aiRaw, t.deletedAt],
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
  categorizeTransaction: (transactionId: string, categoryId: string) => void;
  addAccount: (account: Account) => void;
  updateAccount: (accountId: string, patch: Partial<Account>) => void;
  balancesFor: (accountId: string) => { currency: string; cents: number }[];
  defaultAccountId: () => string;
  defaultCurrencyFor: (accountId: string) => string;
  rankedAccounts: () => Account[];
  rankedCurrencies: (accountId: string) => string[];
  rankedCategories: () => Category[];
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
          'SELECT * FROM transactions ORDER BY occurred_on DESC',
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
        .sort((a, b) => (a.occurredOn < b.occurredOn ? 1 : -1));

    return {
      ...state,

      addTransaction(tx) {
        void db.execute(
          `INSERT INTO transactions (id, account_id, category_id, amount_cents, currency, occurred_on, note, source, ai_raw, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [tx.id, tx.accountId, tx.categoryId, tx.amountCents, tx.currency, tx.occurredOn, tx.note, tx.source, tx.aiRaw, tx.deletedAt],
        );
      },

      // docs/07 D26: categorize an inbox item in place.
      categorizeTransaction(transactionId, categoryId) {
        void db.execute('UPDATE transactions SET category_id = ? WHERE id = ?', [categoryId, transactionId]);
      },

      addAccount(account) {
        void db.execute(
          `INSERT INTO accounts (id, institution, name, kind, currency, goal_amount_cents, goal_target_date, archived)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            account.id,
            account.institution,
            account.name,
            account.kind,
            account.currency,
            account.goalAmountCents,
            account.goalTargetDate,
            account.archived ? 1 : 0,
          ],
        );
      },

      // Also how archiving works (docs/12 D56) — updateAccount(id, { archived: true }).
      updateAccount(accountId, patch) {
        const entries = Object.entries(patch) as [keyof Account, unknown][];
        if (entries.length === 0) return;
        const setClause = entries.map(([k]) => `${ACCOUNT_COLUMNS[k]} = ?`).join(', ');
        const params = entries.map(([k, v]) => (k === 'archived' ? (v ? 1 : 0) : v));
        void db.execute(`UPDATE accounts SET ${setClause} WHERE id = ?`, [...params, accountId]);
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

      defaultCurrencyFor(accountId) {
        const recentOnAccount = activeTx().find((t) => t.accountId === accountId);
        if (recentOnAccount) return recentOnAccount.currency;
        return state.accounts.find((a) => a.id === accountId)?.currency ?? 'CAD';
      },

      rankedAccounts() {
        const counts = new Map<string, number>();
        for (const t of activeTx()) counts.set(t.accountId, (counts.get(t.accountId) ?? 0) + 1);
        return [...state.accounts]
          .filter((a) => !a.archived)
          .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0));
      },

      rankedCurrencies(accountId) {
        const account = state.accounts.find((a) => a.id === accountId);
        const counts = new Map<string, number>();
        for (const t of activeTx()) if (t.accountId === accountId) {
          counts.set(t.currency, (counts.get(t.currency) ?? 0) + 1);
        }
        const seen = new Set<string>(account ? [account.currency] : []);
        const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
        for (const c of ranked) seen.add(c);
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

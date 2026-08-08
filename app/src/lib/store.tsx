import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Account, Budget, Category, Transaction } from './types';
import { seedAccounts, seedBudgets, seedCategories, seedTransactions } from './seed';

// TEMPORARY data layer. docs/01's locked architecture (D1) is on-device
// SQLite via wa-sqlite/PowerSync — this localStorage store is scaffolding
// to validate the entry-zone UX (docs/07) before that infra lands. Swap
// target for a follow-up pass, not a silent replacement of the decision.

const STORAGE_KEY = 'piggypal-dev-store-v1';

interface StoreState {
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  budgets: Budget[];
}

function loadInitial(): StoreState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as StoreState;
  } catch {
    // fall through to seed
  }
  return {
    accounts: seedAccounts,
    categories: seedCategories,
    transactions: seedTransactions,
    budgets: seedBudgets,
  };
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
  const [state, setState] = useState<StoreState>(loadInitial);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const api = useMemo<StoreApi>(() => {
    const activeTx = () =>
      [...state.transactions]
        .filter((t) => !t.deletedAt)
        .sort((a, b) => (a.occurredOn < b.occurredOn ? 1 : -1));

    return {
      ...state,

      addTransaction(tx) {
        setState((s) => ({ ...s, transactions: [tx, ...s.transactions] }));
      },

      // docs/07 D26: categorize an inbox item in place.
      categorizeTransaction(transactionId, categoryId) {
        setState((s) => ({
          ...s,
          transactions: s.transactions.map((t) =>
            t.id === transactionId ? { ...t, categoryId } : t,
          ),
        }));
      },

      addAccount(account) {
        setState((s) => ({ ...s, accounts: [...s.accounts, account] }));
      },

      // Also how archiving works (docs/12 D56) — updateAccount(id, { archived: true }).
      updateAccount(accountId, patch) {
        setState((s) => ({
          ...s,
          accounts: s.accounts.map((a) => (a.id === accountId ? { ...a, ...patch } : a)),
        }));
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

  return <StoreContext.Provider value={api}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreApi {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}

import type { Account, Budget, Category, Transaction } from './types';

// Placeholder seed data so the Home screen has something real to render
// against during UI development — not representative of any real user.

export const seedAccounts: Account[] = [
  {
    id: 'acc-visa',
    institution: 'TD',
    name: 'Visa',
    kind: 'credit',
    currency: 'CAD',
    goalAmountCents: null,
    goalTargetDate: null,
    archived: false,
  },
  {
    id: 'acc-wise',
    institution: 'Wise',
    name: 'BRL',
    kind: 'checking',
    currency: 'BRL',
    goalAmountCents: null,
    goalTargetDate: null,
    archived: false,
  },
  {
    id: 'acc-cash',
    institution: null,
    name: 'Cash',
    kind: 'cash',
    currency: 'CAD',
    goalAmountCents: null,
    goalTargetDate: null,
    archived: false,
  },
];

export const seedCategories: Category[] = [
  { id: 'cat-mercado', name: 'Mercado', kind: 'expense', archived: false },
  { id: 'cat-transporte', name: 'Transporte', kind: 'expense', archived: false },
  { id: 'cat-cafe', name: 'Café', kind: 'expense', archived: false },
  { id: 'cat-salario', name: 'Salário', kind: 'income', archived: false },
];

const today = new Date();
const isoDaysAgo = (days: number) => {
  const d = new Date(today);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
};

export const seedTransactions: Transaction[] = [
  {
    id: 'tx-1',
    accountId: 'acc-visa',
    categoryId: 'cat-mercado',
    amountCents: -4500,
    currency: 'CAD',
    occurredOn: isoDaysAgo(1),
    note: 'Mercado',
    source: 'ai',
    aiRaw: '45 mercado ontem',
    deletedAt: null,
  },
  {
    id: 'tx-2',
    accountId: 'acc-wise',
    categoryId: 'cat-salario',
    amountCents: 320000,
    currency: 'BRL',
    occurredOn: isoDaysAgo(2),
    note: 'Salário',
    source: 'manual',
    aiRaw: null,
    deletedAt: null,
  },
  {
    id: 'tx-3',
    accountId: 'acc-visa',
    categoryId: 'cat-transporte',
    amountCents: -1840,
    currency: 'CAD',
    occurredOn: isoDaysAgo(2),
    note: 'Uber',
    source: 'ai',
    aiRaw: 'uber 18.40',
    deletedAt: null,
  },
  {
    // Uncategorized — Tier 1/2 parsing landed the amount but the parser
    // wasn't confident on category, so it degraded to the inbox (doc 04,
    // doc 07 "The inbox") instead of guessing or erroring. Test data for
    // the Inbox screen: nothing else in the app currently produces one.
    id: 'tx-4',
    accountId: 'acc-visa',
    categoryId: null,
    amountCents: -3200,
    currency: 'CAD',
    occurredOn: isoDaysAgo(0),
    note: null,
    source: 'ai',
    aiRaw: 'sushi jantar uns 32',
    deletedAt: null,
  },
];

const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
  .toISOString()
  .slice(0, 10);

export const seedBudgets: Budget[] = [
  { categoryId: 'cat-mercado', month: monthStart, currency: 'CAD', amountCents: 60000 },
  { categoryId: 'cat-transporte', month: monthStart, currency: 'CAD', amountCents: 18000 },
];

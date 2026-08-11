import type { Account, Budget, Category, Transaction } from './types';

// Placeholder seed data so the Home screen has something real to render
// against during UI development — not representative of any real user.

export const seedAccounts: Account[] = [
  {
    id: 'acc-visa',
    institution: 'TD',
    name: 'Visa',
    kind: 'credit',
    archived: false,
  },
  {
    id: 'acc-wise',
    institution: 'Wise',
    name: 'BRL',
    kind: 'checking',
    archived: false,
  },
  {
    id: 'acc-cash',
    institution: null,
    name: 'Cash',
    kind: 'cash',
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
const pad = (n: number) => String(n).padStart(2, '0');
// Local date construction, not toISOString() — that's UTC and can land on
// the wrong calendar day in the evening for Vancouver's negative offset.
const isoDaysAgo = (days: number, time = '12:00:00') => {
  const d = new Date(today);
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${time}`;
};

export const seedTransactions: Transaction[] = [
  {
    id: 'tx-1',
    accountId: 'acc-visa',
    categoryId: 'cat-mercado',
    amountCents: -4500,
    currency: 'CAD',
    occurredAt: isoDaysAgo(1, '18:42:00'),
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
    occurredAt: isoDaysAgo(2, '09:00:00'),
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
    occurredAt: isoDaysAgo(2, '20:15:00'),
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
    occurredAt: isoDaysAgo(0, '12:30:00'),
    note: null,
    source: 'ai',
    aiRaw: 'sushi jantar uns 32',
    deletedAt: null,
  },
];

const monthStart = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-01`;

export const seedBudgets: Budget[] = [
  { id: 'budget-mercado', categoryId: 'cat-mercado', month: monthStart, currency: 'CAD', amountCents: 60000 },
  { id: 'budget-transporte', categoryId: 'cat-transporte', month: monthStart, currency: 'CAD', amountCents: 18000 },
];

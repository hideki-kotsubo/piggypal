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

// docs/14: a full starter taxonomy — 7 expense groups with 4-9 children
// each, English (2026-08-12 decision — the app's bilingual promise, docs/09,
// covers the UI chrome and AI parsing, not seed category names specifically).
// Housing and Utilities are merged into one group per that same decision.
export const seedCategories: Category[] = [
  { id: 'cat-food', name: 'Food & Groceries', kind: 'expense', parentId: null, archived: false },
  { id: 'cat-food-groceries', name: 'Groceries', kind: 'expense', parentId: 'cat-food', archived: false },
  { id: 'cat-food-dining', name: 'Dining Out', kind: 'expense', parentId: 'cat-food', archived: false },
  { id: 'cat-food-coffee', name: 'Coffee', kind: 'expense', parentId: 'cat-food', archived: false },
  { id: 'cat-food-snacks', name: 'Snacks', kind: 'expense', parentId: 'cat-food', archived: false },
  { id: 'cat-food-alcohol', name: 'Alcohol & Bars', kind: 'expense', parentId: 'cat-food', archived: false },

  { id: 'cat-housing', name: 'Housing & Utilities', kind: 'expense', parentId: null, archived: false },
  { id: 'cat-housing-rent', name: 'Rent/Mortgage', kind: 'expense', parentId: 'cat-housing', archived: false },
  { id: 'cat-housing-proptax', name: 'Property Tax', kind: 'expense', parentId: 'cat-housing', archived: false },
  { id: 'cat-housing-insurance', name: 'Home Insurance', kind: 'expense', parentId: 'cat-housing', archived: false },
  { id: 'cat-housing-maintenance', name: 'Maintenance & Repairs', kind: 'expense', parentId: 'cat-housing', archived: false },
  { id: 'cat-housing-electricity', name: 'Electricity', kind: 'expense', parentId: 'cat-housing', archived: false },
  { id: 'cat-housing-water', name: 'Water', kind: 'expense', parentId: 'cat-housing', archived: false },
  { id: 'cat-housing-heat', name: 'Heating/Gas', kind: 'expense', parentId: 'cat-housing', archived: false },
  { id: 'cat-housing-internet', name: 'Internet', kind: 'expense', parentId: 'cat-housing', archived: false },
  { id: 'cat-housing-phone', name: 'Phone', kind: 'expense', parentId: 'cat-housing', archived: false },

  { id: 'cat-health', name: 'Health & Personal Care', kind: 'expense', parentId: null, archived: false },
  { id: 'cat-health-medical', name: 'Medical', kind: 'expense', parentId: 'cat-health', archived: false },
  { id: 'cat-health-dental', name: 'Dental', kind: 'expense', parentId: 'cat-health', archived: false },
  { id: 'cat-health-pharmacy', name: 'Pharmacy', kind: 'expense', parentId: 'cat-health', archived: false },
  { id: 'cat-health-vision', name: 'Vision', kind: 'expense', parentId: 'cat-health', archived: false },
  { id: 'cat-health-fitness', name: 'Fitness/Gym', kind: 'expense', parentId: 'cat-health', archived: false },

  { id: 'cat-transport', name: 'Transportation', kind: 'expense', parentId: null, archived: false },
  { id: 'cat-transport-car', name: 'Car Costs', kind: 'expense', parentId: 'cat-transport', archived: false },
  { id: 'cat-transport-fuel', name: 'Fuel', kind: 'expense', parentId: 'cat-transport', archived: false },
  { id: 'cat-transport-parking', name: 'Parking', kind: 'expense', parentId: 'cat-transport', archived: false },
  { id: 'cat-transport-transit', name: 'Transit', kind: 'expense', parentId: 'cat-transport', archived: false },
  { id: 'cat-transport-rideshare', name: 'Rideshare', kind: 'expense', parentId: 'cat-transport', archived: false },

  { id: 'cat-recreation', name: 'Recreation & Entertainment', kind: 'expense', parentId: null, archived: false },
  { id: 'cat-recreation-movies', name: 'Movies & Streaming', kind: 'expense', parentId: 'cat-recreation', archived: false },
  { id: 'cat-recreation-hobbies', name: 'Hobbies', kind: 'expense', parentId: 'cat-recreation', archived: false },
  { id: 'cat-recreation-travel', name: 'Travel', kind: 'expense', parentId: 'cat-recreation', archived: false },
  { id: 'cat-recreation-kids', name: 'Kids Activities', kind: 'expense', parentId: 'cat-recreation', archived: false },
  // Spectator/admission spend — ballgames, pool/museum/concert tickets —
  // distinct from screen entertainment (Movies & Streaming) and hands-on
  // participation (Hobbies).
  { id: 'cat-recreation-events', name: 'Events & Tickets', kind: 'expense', parentId: 'cat-recreation', archived: false },

  { id: 'cat-shopping', name: 'Shopping', kind: 'expense', parentId: null, archived: false },
  { id: 'cat-shopping-clothing', name: 'Clothing', kind: 'expense', parentId: 'cat-shopping', archived: false },
  { id: 'cat-shopping-electronics', name: 'Electronics', kind: 'expense', parentId: 'cat-shopping', archived: false },
  { id: 'cat-shopping-household', name: 'Household Items', kind: 'expense', parentId: 'cat-shopping', archived: false },

  { id: 'cat-personal', name: 'Personal & Family', kind: 'expense', parentId: null, archived: false },
  { id: 'cat-personal-subscriptions', name: 'Subscriptions', kind: 'expense', parentId: 'cat-personal', archived: false },
  { id: 'cat-personal-gifts', name: 'Gifts & Donations', kind: 'expense', parentId: 'cat-personal', archived: false },
  { id: 'cat-personal-education', name: 'Education', kind: 'expense', parentId: 'cat-personal', archived: false },
  { id: 'cat-personal-childcare', name: 'Childcare', kind: 'expense', parentId: 'cat-personal', archived: false },

  { id: 'cat-salary', name: 'Salary', kind: 'income', parentId: null, archived: false },
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
    // aiRaw stays Portuguese deliberately — demo data for the bilingual
    // pt-BR parsing story (docs/04/09), independent of the seed
    // categories now being English (2026-08-12).
    id: 'tx-1',
    accountId: 'acc-visa',
    categoryId: 'cat-food-groceries',
    amountCents: -4500,
    currency: 'CAD',
    occurredAt: isoDaysAgo(1, '18:42:00'),
    note: 'Groceries',
    source: 'ai',
    aiRaw: '45 mercado ontem',
    deletedAt: null,
  },
  {
    id: 'tx-2',
    accountId: 'acc-wise',
    categoryId: 'cat-salary',
    amountCents: 320000,
    currency: 'BRL',
    occurredAt: isoDaysAgo(2, '09:00:00'),
    note: 'Salary',
    source: 'manual',
    aiRaw: null,
    deletedAt: null,
  },
  {
    id: 'tx-3',
    accountId: 'acc-visa',
    categoryId: 'cat-transport-rideshare',
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

// Budgeted on leaves, not the Food/Transportation groups — D74: a group's
// budget bar would show $0 spent (nothing logs directly to a group once
// it has children) and look phantom/broken.
export const seedBudgets: Budget[] = [
  { id: 'budget-groceries', categoryId: 'cat-food-groceries', month: monthStart, currency: 'CAD', amountCents: 60000 },
  { id: 'budget-rideshare', categoryId: 'cat-transport-rideshare', month: monthStart, currency: 'CAD', amountCents: 18000 },
];

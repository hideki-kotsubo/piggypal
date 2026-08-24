import { getLocalUserId } from './identity';
import type { Account, Budget, Category, CategoryKeyword, Transaction } from './types';

// Placeholder seed data so the Home screen has something real to render
// against during UI development — not representative of any real user.

// docs/24 D113: account (and transaction/budget, below) ids must be
// generated, not fixed slugs like categories deliberately use — two fresh
// installs merging into a shared household (docs/24) need each other's
// seeded accounts/transactions/budgets to land as distinct rows, not
// silently collide/overwrite on a shared literal id. Named consts (rather
// than inline crypto.randomUUID() calls) because seedTransactions below
// needs to reference the same account ids seedAccounts just generated.
const accVisaId = crypto.randomUUID();
const accMastercardId = crypto.randomUUID();
const accCheckingId = crypto.randomUUID();
const accWiseId = crypto.randomUUID();
const accCashId = crypto.randomUUID();

// docs/24 D110: seed data is this device's own demo data, so its
// owner/payer/creator is this device's own local identity — same value
// getLocalUserId() would produce anywhere else in the app.
const localUserId = getLocalUserId();

// docs/46 D170 — `updatedAt` deliberately excluded from every seed array's
// element type: these literals only ever feed store.tsx's seedIfEmpty(),
// which stamps a real insert-time timestamp itself (see nowUtc() calls
// there) rather than reading one off this static data.
export const seedAccounts: Omit<Account, 'updatedAt'>[] = [
  {
    id: accVisaId,
    institution: 'Your Bank',
    name: 'Visa',
    kind: 'credit',
    archived: false,
    ownerUserId: localUserId,
  },
  {
    id: accMastercardId,
    institution: 'Your Bank',
    name: 'Mastercard',
    kind: 'credit',
    archived: false,
    ownerUserId: localUserId,
  },
  {
    id: accCheckingId,
    institution: 'Your Bank',
    name: 'Checking',
    kind: 'checking',
    archived: false,
    ownerUserId: localUserId,
  },
  {
    id: accWiseId,
    institution: 'Wise',
    name: 'Checking',
    kind: 'checking',
    archived: false,
    ownerUserId: localUserId,
  },
  {
    id: accCashId,
    institution: null,
    name: 'Cash',
    kind: 'cash',
    archived: false,
    ownerUserId: localUserId,
  },
];

// docs/14: a full starter taxonomy — 7 expense groups with 4-9 children
// each, English (2026-08-12 decision — the app's bilingual promise, docs/09,
// covers the UI chrome and AI parsing, not seed category names specifically).
// Housing and Utilities are merged into one group per that same decision.
// Unlike accounts/transactions/budgets below, these ids stay fixed slugs
// deliberately (docs/24 D112) — household merge relies on two installs'
// identical starter taxonomy sharing the same id so it collapses into one
// row instead of duplicating. Don't "fix" these to generated ids too.
export const seedCategories: Omit<Category, 'updatedAt'>[] = [
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

export const seedTransactions: Omit<Transaction, 'updatedAt'>[] = [
  {
    // aiRaw stays Portuguese deliberately — demo data for the bilingual
    // pt-BR parsing story (docs/04/09), independent of the seed
    // categories now being English (2026-08-12).
    id: crypto.randomUUID(),
    accountId: accVisaId,
    categoryId: 'cat-food-groceries',
    amountCents: -4500,
    currency: 'CAD',
    occurredAt: isoDaysAgo(1, '18:42:00'),
    note: 'Groceries',
    merchant: 'Costco',
    source: 'ai',
    aiRaw: '45 groceries yesterday',
    deletedAt: null,
    paidByUserId: localUserId,
    createdByUserId: localUserId,
  },
  {
    id: crypto.randomUUID(),
    accountId: accWiseId,
    categoryId: 'cat-salary',
    amountCents: 320000,
    currency: 'BRL',
    occurredAt: isoDaysAgo(2, '09:00:00'),
    note: 'Salary',
    merchant: null,
    source: 'manual',
    aiRaw: null,
    deletedAt: null,
    paidByUserId: localUserId,
    createdByUserId: localUserId,
  },
  {
    id: crypto.randomUUID(),
    accountId: accVisaId,
    categoryId: 'cat-transport-rideshare',
    amountCents: -1840,
    currency: 'CAD',
    occurredAt: isoDaysAgo(2, '20:15:00'),
    note: 'Uber',
    merchant: 'Uber',
    source: 'ai',
    aiRaw: 'uber 18.40',
    deletedAt: null,
    paidByUserId: localUserId,
    createdByUserId: localUserId,
  },
  {
    // Uncategorized — Tier 1/2 parsing landed the amount but the parser
    // wasn't confident on category, so it degraded to the inbox (doc 04,
    // doc 07 "The inbox") instead of guessing or erroring. Test data for
    // the Inbox screen: nothing else in the app currently produces one.
    id: crypto.randomUUID(),
    accountId: accVisaId,
    categoryId: null,
    amountCents: -3200,
    currency: 'CAD',
    occurredAt: isoDaysAgo(0, '12:30:00'),
    note: null,
    merchant: null,
    source: 'ai',
    aiRaw: 'sushi Dinner 32',
    deletedAt: null,
    paidByUserId: localUserId,
    createdByUserId: localUserId,
  },
  {
    // Second Costco visit, older — gives rankedMerchants() (docs/15 D79)
    // a real recency-vs-frequency case to sort: this is Costco's oldest
    // occurrence, tx-1 is its most recent, so "Costco" should surface
    // ranked by tx-1's date, not this one's.
    id: crypto.randomUUID(),
    accountId: accVisaId,
    categoryId: 'cat-shopping-household',
    amountCents: -8420,
    currency: 'CAD',
    occurredAt: isoDaysAgo(14, '16:05:00'),
    note: 'Household',
    merchant: 'Costco',
    source: 'manual',
    aiRaw: null,
    deletedAt: null,
    paidByUserId: localUserId,
    createdByUserId: localUserId,
  },
];

const monthStart = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-01`;

// Budgeted on leaves, not the Food/Transportation groups — D74: a group's
// budget bar would show $0 spent (nothing logs directly to a group once
// it has children) and look phantom/broken.
// Generated ids (docs/24 D113 fix, extended): a budget's own id must NOT be
// a fixed slug shared across installs. Household merge is supposed to
// resolve two conflicting seeded budgets (same category/month/currency,
// different amount if one side edited theirs) to the higher amount — but
// that logic keys off the (household_id, category_id, month, currency)
// collision, not the row id. A shared fixed id would let plain
// last-write-wins silently pick whichever side synced more recently
// instead, defeating the intended merge rule.
export const seedBudgets: Omit<Budget, 'updatedAt'>[] = [
  { id: crypto.randomUUID(), categoryId: 'cat-food-groceries', month: monthStart, currency: 'CAD', amountCents: 60000 },
  { id: crypto.randomUUID(), categoryId: 'cat-transport-rideshare', month: monthStart, currency: 'CAD', amountCents: 18000 },
];

// docs/16: a small bilingual starter vocabulary for the Tier 1 rule-based
// parser to match against, on top of each category's own bare name —
// without this the parser has nothing to work with on a fresh account.
// Not exhaustive (same "starter, not full taxonomy" spirit as
// seedCategories) — real vocabulary is meant to grow from the docs/04
// learning loop, which this pass doesn't implement yet.
let kwId = 0;
function kw(categoryId: string, keyword: string): CategoryKeyword {
  kwId += 1;
  return { id: `ckw-${kwId}`, categoryId, keyword, hits: 1 };
}
export const seedCategoryKeywords: CategoryKeyword[] = [
  ...['mercado', 'grocery', 'groceries', 'supermercado', 'supermarket'].map((k) => kw('cat-food-groceries', k)),
  ...['restaurante', 'restaurant', 'jantar', 'almoço', 'lunch', 'dinner'].map((k) => kw('cat-food-dining', k)),
  ...['café', 'cafe', 'coffee', 'cafezinho'].map((k) => kw('cat-food-coffee', k)),
  ...['uber', 'corrida', 'taxi', '99'].map((k) => kw('cat-transport-rideshare', k)),
  ...['gasolina', 'gas', 'combustível', 'combustivel'].map((k) => kw('cat-transport-fuel', k)),
  ...['salário', 'salario', 'salary', 'recebi', 'pagamento', 'paycheck'].map((k) => kw('cat-salary', k)),
];

import { describe, expect, it } from 'vitest';
import type { ImportLine } from './importFormerApp';
import { buildImportBatch, categoryPaths, guessAccountKind, planImport, suggestMapping, type ImportMapping } from './importPlan';
import type { Category, Transaction, TransactionSplit } from './types';

let n = 0;
function line(over: Partial<ImportLine> = {}): ImportLine {
  n += 1;
  return {
    index: n,
    sourceId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    kind: 'expense',
    occurredAt: '2026-11-07T16:00:00',
    amountCents: -1000,
    currency: 'CAD',
    note: null,
    merchant: 'Shop',
    categoryName: 'Groceries',
    legs: [{ accountName: 'Card A', amountCents: -1000 }],
    issues: [],
    ...over,
  };
}

function tx(over: Partial<Transaction> = {}): Transaction {
  return {
    id: crypto.randomUUID(),
    accountId: 'acc-a',
    categoryId: null,
    amountCents: -1000,
    currency: 'CAD',
    occurredAt: '2026-11-07T10:00:00',
    note: null,
    merchant: null,
    source: 'manual',
    aiRaw: null,
    deletedAt: null,
    paidByUserId: 'me',
    createdByUserId: 'me',
    scheduleId: null,
    occurrenceDate: null,
    privateToProfileId: null,
    updatedAt: '2026-11-07T10:00:00Z',
    ...over,
  };
}

const accountIdFor = (name: string) => ({ 'Card A': 'acc-a', 'Card B': 'acc-b' })[name] ?? null;

describe('guessAccountKind', () => {
  it('guesses from the name', () => {
    expect(guessAccountKind('Neo - Mastercard')).toBe('credit');
    expect(guessAccountKind('Itaucard Master Black')).toBe('credit');
    expect(guessAccountKind('Bank - Savings')).toBe('savings');
    expect(guessAccountKind('Bank - Checking')).toBe('checking');
  });
});

describe('suggestMapping', () => {
  const accounts = [{ id: 'acc-a', labels: ['Card A'] }, { id: 'old', labels: ['Old'], archived: true }];
  const categories = [
    { id: 'groceries', labels: ['Groceries', 'Mercado'], parentId: null },
    { id: 'bakery', labels: ['Bakery'], parentId: 'groceries' },
  ];

  it('matches by name, case-insensitively, else creates', () => {
    const m = suggestMapping([line({ legs: [{ accountName: 'card a', amountCents: -1000 }] }), line({ legs: [{ accountName: 'Card Z', amountCents: -1000 }] })], accounts, categories);
    expect(m.accounts['card a']).toEqual({ type: 'existing', accountId: 'acc-a' });
    expect(m.accounts['Card Z']).toEqual({ type: 'create', name: 'Card Z', kind: 'credit' });
  });

  it('matches translated starter labels and subcategory paths', () => {
    const m = suggestMapping([line({ categoryName: 'mercado' }), line({ categoryName: 'Groceries › Bakery' }), line({ categoryName: 'Pets' })], accounts, categories);
    expect(m.categories['mercado']).toEqual({ type: 'existing', categoryId: 'groceries' });
    expect(m.categories['Groceries › Bakery']).toEqual({ type: 'existing', categoryId: 'bakery' });
    expect(m.categories['Pets']).toEqual({ type: 'create' });
  });

  it('never suggests an archived account, and uses a still-valid remembered choice', () => {
    const m = suggestMapping([line({ legs: [{ accountName: 'Old', amountCents: -1000 }] }), line({ legs: [{ accountName: 'Adriana', amountCents: -1000 }] })], accounts, categories, {
      accounts: { Adriana: { type: 'existing', accountId: 'acc-a' } },
    });
    expect(m.accounts['Old'].type).toBe('create');
    expect(m.accounts['Adriana']).toEqual({ type: 'existing', accountId: 'acc-a' });
  });

  it('categoryPaths picks income for names used by income', () => {
    expect(categoryPaths([line({ kind: 'income', amountCents: 500, categoryName: 'Salary' }), line({ kind: 'transfer', categoryName: null })])).toEqual([
      { path: 'Salary', kind: 'income', count: 1 },
    ]);
  });
});

describe('planImport', () => {
  it('finds rows from an earlier import by id, deleted ones included', () => {
    const l = line();
    const prior = tx({ id: l.sourceId!, deletedAt: '2026-11-07T12:00:00Z' });
    const [p] = planImport([l], [prior], [], accountIdFor);
    expect(p.status).toBe('alreadyImported');
    expect(p.matchId).toBe(prior.id);
  });

  it('matches a hand-logged twin within a few days, closest date first, once', () => {
    const near = tx({ occurredAt: '2026-11-06T09:00:00' });
    const far = tx({ occurredAt: '2026-11-04T09:00:00' });
    const plan = planImport([line(), line()], [far, near], [], accountIdFor);
    expect(plan.map((p) => p.matchId)).toEqual([near.id, far.id]);
    expect(plan.every((p) => p.status === 'matched')).toBe(true);
  });

  it('does not match a different account, currency, or a date too far away', () => {
    const plan = planImport(
      [line()],
      [tx({ accountId: 'acc-b' }), tx({ currency: 'BRL' }), tx({ occurredAt: '2026-11-01T09:00:00' })],
      [],
      accountIdFor,
    );
    expect(plan[0].status).toBe('new');
  });

  it('matches a split line against a split transaction touching the same accounts', () => {
    const t = tx({ accountId: null });
    const splits: TransactionSplit[] = [
      { id: 's1', transactionId: t.id, accountId: 'acc-a', amountCents: -500, updatedAt: '' },
      { id: 's2', transactionId: t.id, accountId: 'acc-b', amountCents: -500, updatedAt: '' },
    ];
    const l = line({ legs: [{ accountName: 'Card A', amountCents: -500 }, { accountName: 'Card B', amountCents: -500 }] });
    expect(planImport([l], [t], splits, accountIdFor)[0].status).toBe('matched');
  });

  it('skips transfers and never writes problem lines', () => {
    const plan = planImport([line({ kind: 'transfer' }), line({ issues: ['legsDontSum'] })], [], [], accountIdFor);
    expect(plan.map((p) => p.status)).toEqual(['transfer', 'problem']);
  });

  it('flags the same charge twice a minute apart', () => {
    const a = line({ occurredAt: '2026-11-02T10:42:31', amountCents: -2730, legs: [{ accountName: 'Card A', amountCents: -2730 }] });
    const b = line({ occurredAt: '2026-11-02T10:43:31', amountCents: -2730, legs: [{ accountName: 'Card A', amountCents: -2730 }] });
    const c = line({ occurredAt: '2026-11-03T10:43:31', amountCents: -2730, legs: [{ accountName: 'Card A', amountCents: -2730 }] });
    const plan = planImport([a, b, c], [], [], accountIdFor);
    expect(plan.map((p) => p.flags)).toEqual([['possibleDuplicate'], ['possibleDuplicate'], []]);
  });

  it('flags a currency the wallet almost never uses', () => {
    const lines = Array.from({ length: 30 }, (_, i) => line({ occurredAt: `2026-10-${String(i + 1).padStart(2, '0')}T10:00:00`, merchant: `M${i}` }));
    lines.push(line({ currency: 'BRL', merchant: 'Odd' }));
    const plan = planImport(lines, [], [], accountIdFor);
    expect(plan.at(-1)!.flags).toEqual(['unusualCurrency']);
    expect(plan[0].flags).toEqual([]);
  });
});

describe('buildImportBatch', () => {
  const groceries: Category = { id: 'groceries', name: 'Groceries', kind: 'expense', parentId: null, archived: false, updatedAt: '' };
  let id = 0;
  const ctx = {
    existingCategories: [groceries],
    localUserId: 'me',
    payerFor: (accountId: string) => (accountId === 'acc-her' ? 'her' : 'me'),
    newId: () => `id-${++id}`,
    now: '2026-11-07T00:00:00Z',
  };

  it('builds transactions, splits, and only the accounts/categories actually used', () => {
    const mapping: ImportMapping = {
      accounts: {
        'Card A': { type: 'existing', accountId: 'acc-a' },
        Adriana: { type: 'existing', accountId: 'acc-her' },
        'New Card': { type: 'create', name: 'New Card', kind: 'credit' },
        Unused: { type: 'create', name: 'Unused', kind: 'checking' },
      },
      categories: {
        Groceries: { type: 'existing', categoryId: 'groceries' },
        'Pets › Toys': { type: 'create' },
        Skip: { type: 'none' },
      },
    };
    const plain = line();
    const hers = line({ legs: [{ accountName: 'Adriana', amountCents: -1000 }] });
    const split = line({ categoryName: 'Pets › Toys', legs: [{ accountName: 'Card A', amountCents: -400 }, { accountName: 'New Card', amountCents: -600 }] });
    const inbox = line({ categoryName: 'Skip' });
    const transfer = line({ kind: 'transfer' });
    const batch = buildImportBatch([plain, hers, split, inbox, transfer], mapping, ctx);

    expect(batch.accounts.map((a) => a.name)).toEqual(['New Card']);
    expect(batch.categories.map((c) => [c.name, c.parentId === null])).toEqual([['Pets', true], ['Toys', false]]);
    expect(batch.transactions).toHaveLength(4);
    const [t1, t2, t3, t4] = batch.transactions;
    expect(t1).toMatchObject({ id: plain.sourceId, accountId: 'acc-a', categoryId: 'groceries', source: 'import', paidByUserId: 'me' });
    expect(t2.paidByUserId).toBe('her');
    expect(t3.accountId).toBeNull();
    expect(t3.categoryId).toBe(batch.categories[1].id);
    expect(t4.categoryId).toBeNull();
    expect(batch.splits.map((s) => [s.transactionId, s.amountCents])).toEqual([[t3.id, -400], [t3.id, -600]]);
  });

  it('reuses a category created earlier in the same batch', () => {
    const mapping: ImportMapping = { accounts: { 'Card A': { type: 'existing', accountId: 'acc-a' } }, categories: { Pets: { type: 'create' }, 'pets': { type: 'create' } } };
    const batch = buildImportBatch([line({ categoryName: 'Pets' }), line({ categoryName: 'pets' })], mapping, ctx);
    expect(batch.categories).toHaveLength(1);
    expect(batch.transactions[0].categoryId).toBe(batch.transactions[1].categoryId);
  });
});

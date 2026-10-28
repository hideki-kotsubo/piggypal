import { describe, expect, it } from 'vitest';
import { accountMonthFlow, categoryMonthTotals, currentMonthKey } from './activity';
import type { Transaction, TransactionSplit } from './types';

function tx(overrides: Partial<Transaction>): Transaction {
  return {
    id: 't-1',
    accountId: 'a-1',
    categoryId: null,
    amountCents: -1000,
    currency: 'CAD',
    occurredAt: '2026-10-15T12:00:00',
    note: null,
    merchant: null,
    source: 'manual',
    aiRaw: null,
    deletedAt: null,
    paidByUserId: 'u-1',
    createdByUserId: 'u-1',
    privateToProfileId: null,
    scheduleId: null,
    occurrenceDate: null,
    updatedAt: '2026-10-15T12:00:00',
    ...overrides,
  };
}

function split(overrides: Partial<TransactionSplit>): TransactionSplit {
  return {
    id: 's-1',
    transactionId: 't-1',
    accountId: 'a-1',
    amountCents: -500,
    updatedAt: '2026-10-15T12:00:00',
    ...overrides,
  };
}

describe('currentMonthKey', () => {
  it('uses local year and zero-padded month', () => {
    expect(currentMonthKey(new Date(2026, 0, 31, 23, 59))).toBe('2026-01');
    expect(currentMonthKey(new Date(2026, 9, 1))).toBe('2026-10');
  });
});

describe('accountMonthFlow', () => {
  it('splits in and out per currency, never blended', () => {
    const flows = accountMonthFlow(
      [
        tx({ id: 'a', amountCents: 320000 }),
        tx({ id: 'b', amountCents: -8412 }),
        tx({ id: 'c', amountCents: -2000, currency: 'BRL' }),
      ],
      [],
      'a-1',
      '2026-10',
    );
    expect(flows).toEqual([
      { currency: 'CAD', inCents: 320000, outCents: 8412 },
      { currency: 'BRL', inCents: 0, outCents: 2000 },
    ]);
  });

  it('skips other months and other accounts', () => {
    const flows = accountMonthFlow(
      [tx({ id: 'a', occurredAt: '2026-09-30T23:00:00' }), tx({ id: 'b', accountId: 'a-2' })],
      [],
      'a-1',
      '2026-10',
    );
    expect(flows).toEqual([]);
  });

  it('counts a split purchase through its legs, in the parent currency', () => {
    const flows = accountMonthFlow(
      [tx({ id: 'p', accountId: null, amountCents: -3000, currency: 'USD' })],
      [split({ transactionId: 'p', accountId: 'a-1', amountCents: -1000 }), split({ id: 's-2', transactionId: 'p', accountId: 'a-2', amountCents: -2000 })],
      'a-1',
      '2026-10',
    );
    expect(flows).toEqual([{ currency: 'USD', inCents: 0, outCents: 1000 }]);
  });

  it('ignores a leg whose parent is in another month', () => {
    const flows = accountMonthFlow(
      [tx({ id: 'p', accountId: null, occurredAt: '2026-09-02T10:00:00' })],
      [split({ transactionId: 'p' })],
      'a-1',
      '2026-10',
    );
    expect(flows).toEqual([]);
  });
});

describe('categoryMonthTotals', () => {
  const kinds: Record<string, 'expense' | 'income'> = { groceries: 'expense', salary: 'income' };
  const kindOf = (id: string) => kinds[id];

  it('sums spending for expense categories and income for income ones', () => {
    const totals = categoryMonthTotals(
      [
        tx({ id: 'a', categoryId: 'groceries', amountCents: -4000 }),
        tx({ id: 'b', categoryId: 'groceries', amountCents: -1000 }),
        tx({ id: 'c', categoryId: 'groceries', amountCents: -500, currency: 'BRL' }),
        tx({ id: 'd', categoryId: 'salary', amountCents: 320000 }),
      ],
      kindOf,
      '2026-10',
    );
    expect(totals.get('groceries')).toEqual({ totals: new Map([['CAD', 5000], ['BRL', 500]]), count: 3 });
    expect(totals.get('salary')).toEqual({ totals: new Map([['CAD', 320000]]), count: 1 });
  });

  it('ignores the opposite sign, other months, uncategorized and unknown categories', () => {
    const totals = categoryMonthTotals(
      [
        tx({ id: 'a', categoryId: 'groceries', amountCents: 700 }),
        tx({ id: 'b', categoryId: 'groceries', occurredAt: '2026-11-01T00:00:00' }),
        tx({ id: 'c', categoryId: null }),
        tx({ id: 'd', categoryId: 'gone' }),
      ],
      kindOf,
      '2026-10',
    );
    expect(totals.size).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import { computeBalances } from './balances';
import type { Transaction, TransactionSplit } from './types';

function tx(overrides: Partial<Transaction>): Transaction {
  return {
    id: 't-1',
    accountId: 'a-1',
    categoryId: null,
    amountCents: -1000,
    currency: 'CAD',
    occurredAt: '2026-08-30T12:00:00',
    note: null,
    merchant: null,
    source: 'manual',
    aiRaw: null,
    deletedAt: null,
    paidByUserId: 'u-1',
    createdByUserId: 'u-1',
    updatedAt: '2026-08-30T12:00:00',
    ...overrides,
  };
}

function split(overrides: Partial<TransactionSplit>): TransactionSplit {
  return {
    id: 's-1',
    transactionId: 't-1',
    accountId: 'a-1',
    amountCents: -500,
    updatedAt: '2026-08-30T12:00:00',
    ...overrides,
  };
}

describe('computeBalances', () => {
  it('sums an ordinary transaction via its own row', () => {
    const t = tx({ accountId: 'a-1', amountCents: -1000, currency: 'CAD' });
    expect(computeBalances([t], [], 'a-1')).toEqual([{ currency: 'CAD', cents: -1000 }]);
  });

  it('ignores a split transaction parent row (null accountId never matches)', () => {
    const parent = tx({ id: 't-1', accountId: null, amountCents: -1000, currency: 'CAD' });
    expect(computeBalances([parent], [], 'a-1')).toEqual([]);
  });

  it('sums a split transaction via its legs, keyed to the parent currency', () => {
    const parent = tx({ id: 't-1', accountId: null, amountCents: -1000, currency: 'BRL' });
    const legA = split({ id: 's-1', transactionId: 't-1', accountId: 'a-1', amountCents: -400 });
    const legB = split({ id: 's-2', transactionId: 't-1', accountId: 'a-2', amountCents: -600 });
    expect(computeBalances([parent], [legA, legB], 'a-1')).toEqual([{ currency: 'BRL', cents: -400 }]);
    expect(computeBalances([parent], [legA, legB], 'a-2')).toEqual([{ currency: 'BRL', cents: -600 }]);
  });

  it('combines an ordinary transaction and a split leg on the same account/currency', () => {
    const ordinary = tx({ id: 't-1', accountId: 'a-1', amountCents: -1000, currency: 'CAD' });
    const parent = tx({ id: 't-2', accountId: null, amountCents: -500, currency: 'CAD' });
    const leg = split({ id: 's-1', transactionId: 't-2', accountId: 'a-1', amountCents: -500 });
    expect(computeBalances([ordinary, parent], [leg], 'a-1')).toEqual([{ currency: 'CAD', cents: -1500 }]);
  });

  it('excludes a leg whose parent is not in the active transactions list (e.g. soft-deleted, filtered by caller)', () => {
    const leg = split({ id: 's-1', transactionId: 'missing-parent', accountId: 'a-1', amountCents: -500 });
    expect(computeBalances([], [leg], 'a-1')).toEqual([]);
  });

  it('gives a nonzero balance to an account that only ever appears as a split leg', () => {
    const parent = tx({ id: 't-1', accountId: null, amountCents: -100, currency: 'CAD' });
    const leg = split({ id: 's-1', transactionId: 't-1', accountId: 'a-only-split', amountCents: -100 });
    expect(computeBalances([parent], [leg], 'a-only-split')).toEqual([{ currency: 'CAD', cents: -100 }]);
  });

  it('never blends multiple currencies into one total', () => {
    const cadTx = tx({ id: 't-1', accountId: 'a-1', amountCents: -1000, currency: 'CAD' });
    const brlParent = tx({ id: 't-2', accountId: null, amountCents: -2000, currency: 'BRL' });
    const brlLeg = split({ id: 's-1', transactionId: 't-2', accountId: 'a-1', amountCents: -2000 });
    const result = computeBalances([cadTx, brlParent], [brlLeg], 'a-1');
    expect(result).toHaveLength(2);
    expect(result).toEqual(
      expect.arrayContaining([
        { currency: 'CAD', cents: -1000 },
        { currency: 'BRL', cents: -2000 },
      ]),
    );
  });
});

import { describe, expect, it } from 'vitest';
import { accountShares, EMPTY_FILTERS, filterTransactions, totalsByCurrency } from './filterTransactions';
import type { Transaction, TransactionSplit } from './types';

function tx(overrides: Partial<Transaction>): Transaction {
  return {
    id: 't-1',
    accountId: 'visa',
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
    transactionId: 'groceries',
    accountId: 'visa',
    amountCents: -6000,
    updatedAt: '2026-10-15T12:00:00',
    ...overrides,
  };
}

// $100 of groceries: $60 on the Visa, $40 on Wise (docs/50).
const groceries = tx({ id: 'groceries', accountId: null, amountCents: -10000 });
const splits = [split({}), split({ id: 's-2', accountId: 'wise', amountCents: -4000 })];
const coffee = tx({ id: 'coffee', accountId: 'visa', amountCents: -525 });
const rent = tx({ id: 'rent', accountId: 'chequing', amountCents: -185000 });

describe('accountShares', () => {
  it("maps each split purchase to this account's legs", () => {
    expect(accountShares(splits, 'visa')).toEqual(new Map([['groceries', -6000]]));
    expect(accountShares(splits, 'wise')).toEqual(new Map([['groceries', -4000]]));
    expect(accountShares(splits, 'chequing').size).toBe(0);
  });

  it('adds up two legs on the same account', () => {
    const twice = [split({}), split({ id: 's-3', amountCents: -1000 })];
    expect(accountShares(twice, 'visa').get('groceries')).toBe(-7000);
  });
});

describe('filterTransactions by account', () => {
  it('includes a split purchase through its leg on that account', () => {
    const visa = filterTransactions([groceries, coffee, rent], { ...EMPTY_FILTERS, accountId: 'visa' }, splits);
    expect(visa.map((t) => t.id)).toEqual(['groceries', 'coffee']);
  });

  it('leaves a split purchase out for an account it has no leg on', () => {
    const chequing = filterTransactions([groceries, coffee, rent], { ...EMPTY_FILTERS, accountId: 'chequing' }, splits);
    expect(chequing.map((t) => t.id)).toEqual(['rent']);
  });

  it('keeps every transaction when no account is picked', () => {
    expect(filterTransactions([groceries, coffee, rent], EMPTY_FILTERS, splits)).toHaveLength(3);
  });
});

describe('totalsByCurrency', () => {
  it('counts only the account share when given one', () => {
    const shares = accountShares(splits, 'visa');
    const totals = totalsByCurrency([groceries, coffee], (t) => shares.get(t.id) ?? t.amountCents);
    expect(totals).toEqual([{ currency: 'CAD', cents: -6525 }]);
  });

  it('counts full amounts by default', () => {
    expect(totalsByCurrency([groceries, coffee])).toEqual([{ currency: 'CAD', cents: -10525 }]);
  });
});

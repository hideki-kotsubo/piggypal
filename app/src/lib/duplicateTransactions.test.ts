import { describe, expect, it } from 'vitest';
import { findDuplicateGroups } from './duplicateTransactions';
import type { Transaction } from './types';

function tx(overrides: Partial<Transaction>): Transaction {
  return {
    id: 't-1',
    accountId: 'a-1',
    categoryId: 'c-1',
    amountCents: -5000,
    currency: 'CAD',
    occurredAt: '2026-08-20T12:00:00',
    note: null,
    merchant: null,
    source: 'manual',
    aiRaw: null,
    deletedAt: null,
    paidByUserId: 'u-1',
    createdByUserId: 'u-1',
    updatedAt: '2026-08-20T12:00:00',
    ...overrides,
  };
}

describe('findDuplicateGroups', () => {
  it('returns no groups for distinct amount/day/category/account combos', () => {
    const a = tx({ id: 't-1', amountCents: -1000 });
    const b = tx({ id: 't-2', amountCents: -2000 });
    expect(findDuplicateGroups([a, b])).toEqual([]);
  });

  it('groups two transactions sharing the full signature — high confidence', () => {
    const a = tx({ id: 't-1', occurredAt: '2026-08-20T09:00:00' });
    const b = tx({ id: 't-2', occurredAt: '2026-08-20T21:00:00' });
    const groups = findDuplicateGroups([a, b]);
    expect(groups).toHaveLength(1);
    expect(groups[0].confidence).toBe('high');
    expect(groups[0].transactions.map((t) => t.id)).toEqual(['t-1', 't-2']);
  });

  it('groups three sharing the signature as one N-way group, not split into pairs', () => {
    const a = tx({ id: 't-1' });
    const b = tx({ id: 't-2' });
    const c = tx({ id: 't-3' });
    const groups = findDuplicateGroups([a, b, c]);
    expect(groups).toHaveLength(1);
    expect(groups[0].transactions).toHaveLength(3);
  });

  it('marks a same-signature-different-account pair as secondary confidence', () => {
    const a = tx({ id: 't-1', accountId: 'a-1' });
    const b = tx({ id: 't-2', accountId: 'a-2' });
    const groups = findDuplicateGroups([a, b]);
    expect(groups).toHaveLength(1);
    expect(groups[0].confidence).toBe('secondary');
  });

  it('keeps a mixed bucket (2 same-account + 1 different-account) as one secondary group, not split', () => {
    const a = tx({ id: 't-1', accountId: 'a-1' });
    const b = tx({ id: 't-2', accountId: 'a-1' });
    const c = tx({ id: 't-3', accountId: 'a-2' });
    const groups = findDuplicateGroups([a, b, c]);
    expect(groups).toHaveLength(1);
    expect(groups[0].confidence).toBe('secondary');
    expect(groups[0].transactions).toHaveLength(3);
  });

  it('excludes soft-deleted transactions, dropping a pair below 2 members', () => {
    const a = tx({ id: 't-1' });
    const b = tx({ id: 't-2', deletedAt: '2026-08-21T00:00:00' });
    expect(findDuplicateGroups([a, b])).toEqual([]);
  });

  it('still groups two categoryId: null transactions together', () => {
    const a = tx({ id: 't-1', categoryId: null });
    const b = tx({ id: 't-2', categoryId: null });
    expect(findDuplicateGroups([a, b])).toHaveLength(1);
  });

  it('does not group when amountCents differs by 1 cent', () => {
    const a = tx({ id: 't-1', amountCents: -5000 });
    const b = tx({ id: 't-2', amountCents: -5001 });
    expect(findDuplicateGroups([a, b])).toEqual([]);
  });

  it('groups same calendar day regardless of time of day', () => {
    const a = tx({ id: 't-1', occurredAt: '2026-08-20T00:00:01' });
    const b = tx({ id: 't-2', occurredAt: '2026-08-20T23:59:59' });
    expect(findDuplicateGroups([a, b])).toHaveLength(1);
  });

  it('does not group same amount with different currencies', () => {
    const a = tx({ id: 't-1', currency: 'CAD' });
    const b = tx({ id: 't-2', currency: 'BRL' });
    expect(findDuplicateGroups([a, b])).toEqual([]);
  });

  it('sorts high-confidence groups before secondary regardless of recency', () => {
    const secondaryNewer = [
      tx({ id: 's-1', accountId: 'a-1', categoryId: 'c-2', occurredAt: '2026-08-25T00:00:00' }),
      tx({ id: 's-2', accountId: 'a-2', categoryId: 'c-2', occurredAt: '2026-08-25T00:00:00' }),
    ];
    const highOlder = [
      tx({ id: 'h-1', accountId: 'a-1', categoryId: 'c-3', occurredAt: '2026-08-10T00:00:00' }),
      tx({ id: 'h-2', accountId: 'a-1', categoryId: 'c-3', occurredAt: '2026-08-10T00:00:00' }),
    ];
    const groups = findDuplicateGroups([...secondaryNewer, ...highOlder]);
    expect(groups).toHaveLength(2);
    expect(groups[0].confidence).toBe('high');
    expect(groups[1].confidence).toBe('secondary');
  });

  it('sorts groups within the same tier most-recent-day first', () => {
    const older = [
      tx({ id: 'o-1', categoryId: 'c-a', occurredAt: '2026-08-01T00:00:00' }),
      tx({ id: 'o-2', categoryId: 'c-a', occurredAt: '2026-08-01T00:00:00' }),
    ];
    const newer = [
      tx({ id: 'n-1', categoryId: 'c-b', occurredAt: '2026-08-15T00:00:00' }),
      tx({ id: 'n-2', categoryId: 'c-b', occurredAt: '2026-08-15T00:00:00' }),
    ];
    const groups = findDuplicateGroups([...older, ...newer]);
    expect(groups[0].transactions[0].occurredAt.slice(0, 10)).toBe('2026-08-15');
    expect(groups[1].transactions[0].occurredAt.slice(0, 10)).toBe('2026-08-01');
  });

  it('sorts members within a group by occurredAt ascending', () => {
    const a = tx({ id: 't-2', occurredAt: '2026-08-20T18:00:00' });
    const b = tx({ id: 't-1', occurredAt: '2026-08-20T06:00:00' });
    const groups = findDuplicateGroups([a, b]);
    expect(groups[0].transactions.map((t) => t.id)).toEqual(['t-1', 't-2']);
  });
});

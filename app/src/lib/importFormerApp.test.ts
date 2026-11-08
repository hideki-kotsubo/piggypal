import { describe, expect, it } from 'vitest';
import { decimalToCents, ImportFileError, parseFormerAppJson, parseFormerAppRecord, utcToLocal } from './importFormerApp';

const TZ = 'America/Sao_Paulo'; // UTC-3 all year

function rec(over: Record<string, unknown> = {}) {
  return {
    id: 'B1632CB2-0808-4CDA-A217-3C8813A4CDBD',
    dateCreated: '2026-11-08T00:22:47.7233333Z',
    what: 'Bread, milk',
    when: '2026-11-08T00:21:29Z',
    where: 'Corner Market',
    currency: 'CAD',
    amount: -44.61,
    category: 'Groceries',
    subCategory: '',
    amounts: [],
    payments: [{ wallet: 'Card A', amount: '-44.61' }],
    type: 1,
    ...over,
  };
}

describe('decimalToCents', () => {
  it('parses the string forms seen in real files', () => {
    expect(decimalToCents('-44.61')).toBe(-4461);
    expect(decimalToCents('100.00')).toBe(10000);
    expect(decimalToCents('100')).toBe(10000);
    expect(decimalToCents('-27.3')).toBe(-2730);
    expect(decimalToCents('1234')).toBe(123400);
  });
  it('rejects anything else', () => {
    expect(decimalToCents('')).toBeNull();
    expect(decimalToCents('1.234')).toBeNull();
    expect(decimalToCents('abc')).toBeNull();
  });
});

describe('utcToLocal', () => {
  it('moves an evening back to its own day', () => {
    expect(utcToLocal('2026-11-08T00:21:29Z', TZ)).toBe('2026-11-07T21:21:29');
  });
  it('follows DST', () => {
    expect(utcToLocal('2026-07-01T02:00:00Z', 'America/Los_Angeles')).toBe('2026-06-30T19:00:00');
    expect(utcToLocal('2026-12-01T02:00:00Z', 'America/Los_Angeles')).toBe('2026-11-30T18:00:00');
  });
  it('rejects a bad date', () => {
    expect(utcToLocal('nope', TZ)).toBeNull();
  });
});

describe('parseFormerAppRecord', () => {
  it('maps an expense', () => {
    const line = parseFormerAppRecord(rec(), 0, TZ);
    expect(line).toEqual({
      index: 0,
      sourceId: 'b1632cb2-0808-4cda-a217-3c8813a4cdbd',
      kind: 'expense',
      occurredAt: '2026-11-07T21:21:29',
      amountCents: -4461,
      currency: 'CAD',
      note: 'Bread, milk',
      merchant: 'Corner Market',
      categoryName: 'Groceries',
      legs: [{ accountName: 'Card A', amountCents: -4461 }],
      issues: [],
    });
  });

  it('maps an expense paid with two accounts', () => {
    const line = parseFormerAppRecord(
      rec({ amount: -100, payments: [{ wallet: 'Card A', amount: '-50' }, { wallet: 'Card B', amount: '-50' }] }),
      0,
      TZ,
    );
    expect(line.issues).toEqual([]);
    expect(line.legs).toHaveLength(2);
  });

  it('maps income', () => {
    const line = parseFormerAppRecord(
      rec({ type: 2, amount: 1234, currency: 'BRL', category: 'Salário/Retirada', payments: [{ wallet: 'Bank C', amount: '1234' }] }),
      0,
      TZ,
    );
    expect(line.kind).toBe('income');
    expect(line.amountCents).toBe(123400);
    expect(line.categoryName).toBe('Salário/Retirada');
    expect(line.issues).toEqual([]);
  });

  it('maps a transfer', () => {
    const line = parseFormerAppRecord(
      rec({
        type: 3,
        amount: 100,
        category: '',
        where: '',
        payments: [{ wallet: 'Savings', amount: '-100' }, { wallet: 'Checking', amount: '100.00' }],
      }),
      0,
      TZ,
    );
    expect(line.kind).toBe('transfer');
    expect(line.categoryName).toBeNull();
    expect(line.merchant).toBeNull();
    expect(line.issues).toEqual([]);
  });

  it('joins subCategory into a path', () => {
    expect(parseFormerAppRecord(rec({ subCategory: 'Bakery' }), 0, TZ).categoryName).toBe('Groceries › Bakery');
  });

  it('empty category stays uncategorized', () => {
    expect(parseFormerAppRecord(rec({ category: '' }), 0, TZ).categoryName).toBeNull();
  });

  it('flags payments that do not add up', () => {
    const line = parseFormerAppRecord(rec({ amount: -100, payments: [{ wallet: 'Card A', amount: '-60' }] }), 0, TZ);
    expect(line.issues).toContain('legsDontSum');
  });

  it('flags a sign that does not fit the type', () => {
    expect(parseFormerAppRecord(rec({ amount: 44.61, payments: [{ wallet: 'Card A', amount: '44.61' }] }), 0, TZ).issues).toContain(
      'signMismatch',
    );
  });

  it('flags a malformed transfer', () => {
    const line = parseFormerAppRecord(rec({ type: 3, amount: 100, payments: [{ wallet: 'Savings', amount: '-100' }] }), 0, TZ);
    expect(line.issues).toContain('transferShape');
  });

  it('flags data in the unknown amounts field instead of dropping it', () => {
    expect(parseFormerAppRecord(rec({ amounts: [{ x: 1 }] }), 0, TZ).issues).toContain('amountsNotEmpty');
  });

  it('flags unknown types and bad dates', () => {
    expect(parseFormerAppRecord(rec({ type: 9 }), 0, TZ).issues).toContain('unknownType');
    expect(parseFormerAppRecord(rec({ when: 'x' }), 0, TZ).issues).toContain('badDate');
  });

  it('a non-uuid id gets no sourceId', () => {
    expect(parseFormerAppRecord(rec({ id: '42' }), 0, TZ).sourceId).toBeNull();
  });
});

describe('parseFormerAppJson', () => {
  it('parses an array, BOM tolerated', () => {
    expect(parseFormerAppJson('﻿' + JSON.stringify([rec(), rec({ id: 'x' })]), TZ)).toHaveLength(2);
  });
  it('refuses files that are not this format', () => {
    expect(() => parseFormerAppJson('not json')).toThrow(ImportFileError);
    expect(() => parseFormerAppJson('{"a":1}')).toThrow(ImportFileError);
    expect(() => parseFormerAppJson('[{"a":1}]')).toThrow(ImportFileError);
  });
});

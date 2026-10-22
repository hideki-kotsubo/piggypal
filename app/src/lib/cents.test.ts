import { describe, expect, it } from 'vitest';
import { appendDigit, centsFromRow, centsPerUnit, dropDigit } from './cents';
import { formatAmount } from './format';
import { installmentAmount } from './schedules';

describe('centsFromRow', () => {
  it('passes numbers through unchanged', () => {
    expect(centsFromRow(-425)).toBe(-425);
    expect(centsFromRow(0)).toBe(0);
  });

  it('turns a bigint into a number', () => {
    const cents = centsFromRow(-425n);
    expect(typeof cents).toBe('number');
    expect(cents).toBe(-425);
  });

  it('makes the reported failure safe: summing with a number accumulator', () => {
    // BudgetBars.tsx: (spendByKey.get(key) ?? 0) + -t.amountCents
    const fromDriver = 980000n as number | bigint;
    expect(() => 0 + -(fromDriver as unknown as number)).toThrow(TypeError);
    expect(0 + -centsFromRow(fromDriver)).toBe(-980000);
  });
});

// Real report, 2026-10-22: typing 1 5 0 0 in yen gave ￥15.
describe('keypad entry per currency', () => {
  it('knows which currencies have no minor unit', () => {
    expect(centsPerUnit('CAD')).toBe(1);
    expect(centsPerUnit('BRL')).toBe(1);
    expect(centsPerUnit('JPY')).toBe(100);
    expect(centsPerUnit('KRW')).toBe(100);
    expect(centsPerUnit('KWD')).toBe(1);
    expect(centsPerUnit('XXQ')).toBe(1);
  });

  it('types whole yen and won', () => {
    let cents = 0;
    for (const d of '1500') cents = appendDigit(cents, d, 'JPY');
    expect(cents).toBe(150000);
    expect(formatAmount(cents, 'JPY')).toBe('¥1,500');
    expect(dropDigit(cents, 'JPY')).toBe(15000);
    let won = 0;
    for (const d of '5000') won = appendDigit(won, d, 'KRW');
    expect(won).toBe(500000);
  });

  it('still types cents for currencies that have them', () => {
    let cents = 0;
    for (const d of '1500') cents = appendDigit(cents, d, 'CAD');
    expect(cents).toBe(1500);
    expect(dropDigit(cents, 'CAD')).toBe(150);
    expect(dropDigit(5, 'CAD')).toBe(0);
  });

  it('works on a negative (expense) amount, returning the absolute value', () => {
    expect(appendDigit(-150000, '0', 'JPY')).toBe(1500000);
  });
});

describe('installments in whole units', () => {
  it('splits yen in whole yen', () => {
    expect([1, 2, 3].map((n) => installmentAmount(100000, 3, n, centsPerUnit('JPY')))).toEqual([33400, 33300, 33300]);
    expect([1, 2, 3].map((n) => installmentAmount(-100000, 3, n, 100)).reduce((a, b) => a + b)).toBe(-100000);
  });

  it('keeps cent splitting for other currencies', () => {
    expect([1, 2, 3].map((n) => installmentAmount(100000, 3, n))).toEqual([33334, 33333, 33333]);
  });
});

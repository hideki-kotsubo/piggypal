import { describe, expect, it } from 'vitest';
import { centsFromRow } from './cents';

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

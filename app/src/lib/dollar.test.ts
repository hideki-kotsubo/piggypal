import { describe, expect, it } from 'vitest';
import { resolveDollar } from './dollar';

// docs/73 D272
describe('resolveDollar', () => {
  it("uses the account's own currency when it's already a dollar", () => {
    expect(resolveDollar('USD', ['CAD'], 'CAD')).toBe('USD');
    expect(resolveDollar('CAD', [], 'USD')).toBe('CAD');
  });

  it('otherwise the most recent dollar currency used anywhere', () => {
    expect(resolveDollar('BRL', ['BRL', 'USD', 'CAD'], 'CAD')).toBe('USD');
  });

  it('otherwise the "Dollars ($) mean" setting', () => {
    expect(resolveDollar('BRL', ['BRL', 'EUR'], 'CAD')).toBe('CAD');
    expect(resolveDollar('BRL', [], 'USD')).toBe('USD');
  });
});

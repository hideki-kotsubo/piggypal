import { describe, expect, it } from 'vitest';
import { locationSuggestions } from './locationSuggestions';
import type { Transaction } from './types';

let n = 0;
function tx(merchant: string | null, occurredAt: string, id = `t-${++n}`): Transaction {
  return {
    id,
    accountId: 'a-1',
    categoryId: null,
    amountCents: -1000,
    currency: 'CAD',
    occurredAt,
    merchant,
  } as Transaction;
}

describe('locationSuggestions', () => {
  it('ranks by how often a location is used, the most recent first on a tie', () => {
    const list = [
      tx('Costco', '2026-10-01T10:00:00'),
      tx('Costco', '2026-10-02T10:00:00'),
      tx('Save on Foods', '2026-10-20T10:00:00'),
      tx('Price smart', '2026-10-25T10:00:00'),
      tx(null, '2026-10-26T10:00:00'),
    ];
    expect(locationSuggestions(list, '')).toEqual(['Costco', 'Price smart', 'Save on Foods']);
  });

  it('shows at most six', () => {
    const list = Array.from({ length: 20 }, (_, i) => tx(`Shop ${i}`, `2026-10-${String(i + 1).padStart(2, '0')}T10:00:00`));
    expect(locationSuggestions(list, '')).toHaveLength(6);
    expect(locationSuggestions(list, '')[0]).toBe('Shop 19');
  });

  it('searches every location while typing, starts-with first', () => {
    const list = [
      tx('Tacos Comida', '2026-10-01T10:00:00'),
      tx('Tacos Comida', '2026-10-02T10:00:00'),
      tx('Costco', '2026-10-03T10:00:00'),
      ...Array.from({ length: 10 }, (_, i) => tx(`Shop ${i}`, '2026-10-20T10:00:00')),
    ];
    expect(locationSuggestions(list, 'co')).toEqual(['Costco', 'Tacos Comida']);
    expect(locationSuggestions(list, ' CO ')).toEqual(['Costco', 'Tacos Comida']);
  });

  it("leaves out the record's own location use", () => {
    const list = [tx('Costco', '2026-10-01T10:00:00', 'self'), tx('Price smart', '2026-10-02T10:00:00')];
    expect(locationSuggestions(list, '', { excludeId: 'self' })).toEqual(['Price smart']);
  });
});

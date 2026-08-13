import type { Transaction } from './types';

// docs/18 — pure filtering/aggregation, no React/store imports, so it's
// easy to reason about (and test later) independent of the UI that drives
// it. TransactionList owns turning URL search params into this shape.

export interface TransactionFilters {
  q: string;
  categoryId: string | null;
  accountId: string | null;
  merchant: string | null;
  dateFrom: string | null; // YYYY-MM-DD, inclusive
  dateTo: string | null; // YYYY-MM-DD, inclusive
}

export const EMPTY_FILTERS: TransactionFilters = {
  q: '',
  categoryId: null,
  accountId: null,
  merchant: null,
  dateFrom: null,
  dateTo: null,
};

export function hasActiveFilters(f: TransactionFilters): boolean {
  return f.q !== '' || f.categoryId !== null || f.accountId !== null || f.merchant !== null || f.dateFrom !== null || f.dateTo !== null;
}

export function filterTransactions(all: Transaction[], f: TransactionFilters): Transaction[] {
  const q = f.q.trim().toLowerCase();
  return all.filter((t) => {
    if (q) {
      const haystack = `${t.note ?? ''} ${t.merchant ?? ''}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    if (f.categoryId && t.categoryId !== f.categoryId) return false;
    if (f.accountId && t.accountId !== f.accountId) return false;
    if (f.merchant && t.merchant !== f.merchant) return false;
    const day = t.occurredAt.slice(0, 10);
    if (f.dateFrom && day < f.dateFrom) return false;
    if (f.dateTo && day > f.dateTo) return false;
    return true;
  });
}

// docs/10: currencies are tracked side by side, never summed/converted —
// same convention store.balancesFor already uses for account balances.
// One line per currency actually present in the filtered set, not one
// blended number.
export function totalsByCurrency(filtered: Transaction[]): { currency: string; cents: number }[] {
  const totals = new Map<string, number>();
  for (const t of filtered) {
    totals.set(t.currency, (totals.get(t.currency) ?? 0) + t.amountCents);
  }
  return [...totals.entries()].map(([currency, cents]) => ({ currency, cents }));
}

export type DatePreset = 'week' | 'month' | 'lastMonth';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
// Local date construction, not toISOString() — same reasoning as
// seed.ts's isoDaysAgo: toISOString() is UTC and can land on the wrong
// calendar day in the evening for a negative-offset timezone.
function localISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function presetRange(preset: DatePreset, today: Date = new Date()): { from: string; to: string } {
  if (preset === 'week') {
    const from = new Date(today);
    from.setDate(from.getDate() - 6);
    return { from: localISODate(from), to: localISODate(today) };
  }
  if (preset === 'month') {
    return { from: localISODate(new Date(today.getFullYear(), today.getMonth(), 1)), to: localISODate(today) };
  }
  // lastMonth
  const from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const to = new Date(today.getFullYear(), today.getMonth(), 0);
  return { from: localISODate(from), to: localISODate(to) };
}

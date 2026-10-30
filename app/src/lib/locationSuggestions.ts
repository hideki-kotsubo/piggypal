import type { Transaction } from './types';

// The Location field's suggestion chips (docs/15), on the transaction and
// scheduled-payment forms. Capped so a long history doesn't turn the chip
// row into a wall; typing searches every location, still capped. Ranked by
// how often a location is used, the most recent first on a tie. The store's
// rankedMerchants stays recency-only (D79) for its other callers. Pure, so
// it's unit-testable; callers pass active (non-deleted) transactions.

export const LOCATION_SUGGESTION_LIMIT = 6;

export function locationSuggestions(
  transactions: Transaction[],
  query: string,
  { excludeId, limit = LOCATION_SUGGESTION_LIMIT }: { excludeId?: string; limit?: number } = {},
): string[] {
  const uses = new Map<string, { count: number; last: string }>();
  for (const t of transactions) {
    if (!t.merchant || t.id === excludeId) continue;
    const u = uses.get(t.merchant);
    if (!u) uses.set(t.merchant, { count: 1, last: t.occurredAt });
    else {
      u.count++;
      if (t.occurredAt > u.last) u.last = t.occurredAt;
    }
  }

  const q = query.trim().toLowerCase();
  const matches = [...uses.keys()].filter((m) => m.toLowerCase().includes(q));
  // Starts-with beats contains while typing ("co" → Costco before Tacos
  // Comida); with no query every location starts with "".
  const starts = (m: string) => (m.toLowerCase().startsWith(q) ? 0 : 1);
  return matches
    .sort((a, b) => {
      const ua = uses.get(a)!;
      const ub = uses.get(b)!;
      return starts(a) - starts(b) || ub.count - ua.count || (ua.last < ub.last ? 1 : ua.last > ub.last ? -1 : 0);
    })
    .slice(0, limit);
}

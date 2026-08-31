import type { Transaction, TransactionSplit } from './types';

// docs/50 — pure so it's directly unit-testable, unlike the rest of
// store.tsx (which has no test coverage today). A split transaction's own
// row contributes nothing here (its accountId is null); its legs
// contribute instead, keyed to the *parent* transaction's currency — a
// split purchase is always one currency, by construction (no per-leg
// currency, out of scope, see docs/50).
//
// `transactions`/`splits` should already be filtered to active (non-
// deleted) transactions by the caller — this function doesn't re-check
// `deletedAt` itself, since a soft-deleted parent's legs are meant to be
// excluded the same way any other soft-deleted transaction's amount is,
// and the caller (store.tsx's `activeTx()`) already owns that filter.
export function computeBalances(
  transactions: Transaction[],
  splits: TransactionSplit[],
  accountId: string,
): { currency: string; cents: number }[] {
  const totals = new Map<string, number>();
  const byId = new Map(transactions.map((t) => [t.id, t]));

  for (const t of transactions) {
    if (t.accountId !== accountId) continue;
    totals.set(t.currency, (totals.get(t.currency) ?? 0) + t.amountCents);
  }

  for (const s of splits) {
    if (s.accountId !== accountId) continue;
    const parent = byId.get(s.transactionId);
    if (!parent) continue; // defensive; the real FK guarantees this shouldn't happen
    totals.set(parent.currency, (totals.get(parent.currency) ?? 0) + s.amountCents);
  }

  return [...totals.entries()].map(([currency, cents]) => ({ currency, cents }));
}

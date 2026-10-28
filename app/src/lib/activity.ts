import type { Transaction, TransactionSplit } from './types';

// docs/79 — "this month" figures for the account page (D309) and the
// Categories tree (C1). Pure, so they're unit-testable like balances.ts.
// Callers pass active (non-deleted) transactions; never blended across
// currencies (docs/10).

export interface Flow {
  currency: string;
  inCents: number; // positive
  outCents: number; // positive
}

// "YYYY-MM" for local "now", matching occurredAt's local-time prefix.
export function currentMonthKey(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// Money in and out of one account in a month. A split purchase counts
// through its legs, in the parent's currency (same rule as balances.ts).
export function accountMonthFlow(
  transactions: Transaction[],
  splits: TransactionSplit[],
  accountId: string,
  monthKey: string,
): Flow[] {
  const flows = new Map<string, Flow>();
  const add = (currency: string, cents: number) => {
    const f = flows.get(currency) ?? { currency, inCents: 0, outCents: 0 };
    if (cents >= 0) f.inCents += cents;
    else f.outCents -= cents;
    flows.set(currency, f);
  };
  const inMonth = new Map<string, Transaction>();
  for (const t of transactions) {
    if (!t.occurredAt.startsWith(monthKey)) continue;
    inMonth.set(t.id, t);
    if (t.accountId === accountId) add(t.currency, t.amountCents);
  }
  for (const s of splits) {
    if (s.accountId !== accountId) continue;
    const parent = inMonth.get(s.transactionId);
    if (parent) add(parent.currency, s.amountCents);
  }
  return [...flows.values()];
}

export interface CategoryMonth {
  // Spent (expense) or received (income), positive, per currency.
  totals: Map<string, number>;
  count: number;
}

// Per category: what was spent (negative amounts) or received (positive
// amounts) in a month, by currency, plus how many entries. Which side
// counts follows the category's kind.
export function categoryMonthTotals(
  transactions: Transaction[],
  kindOf: (categoryId: string) => 'expense' | 'income' | undefined,
  monthKey: string,
): Map<string, CategoryMonth> {
  const out = new Map<string, CategoryMonth>();
  for (const t of transactions) {
    if (!t.categoryId || !t.occurredAt.startsWith(monthKey)) continue;
    const kind = kindOf(t.categoryId);
    if (!kind) continue;
    const cents = kind === 'expense' ? -t.amountCents : t.amountCents;
    if (cents <= 0) continue;
    const entry = out.get(t.categoryId) ?? { totals: new Map<string, number>(), count: 0 };
    entry.totals.set(t.currency, (entry.totals.get(t.currency) ?? 0) + cents);
    entry.count += 1;
    out.set(t.categoryId, entry);
  }
  return out;
}

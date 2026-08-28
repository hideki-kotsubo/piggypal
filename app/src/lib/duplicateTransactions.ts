import type { Transaction } from './types';

// Backlog 2026-08-27 — the "find duplicate transactions" tool
// (TransactionList.tsx's entry point, DuplicateTransactionsScreen). Pure
// detection only, same shape as manualMerge.ts: no store/db imports, so
// it's trivially testable and the screen just renders its output.

export type DuplicateConfidence = 'high' | 'secondary';

export interface DuplicateGroup {
  key: string;
  confidence: DuplicateConfidence;
  transactions: Transaction[]; // 2+, occurredAt ascending then id ascending
}

// account is deliberately excluded from the key — that's what separates
// 'high' (every member also shares one account) from 'secondary' (the
// same expense logged under two different accounts by mistake). currency
// IS part of the key: a same-amount-different-currency pair is
// essentially never an accidental duplicate of the same real purchase,
// so it's excluded from matching entirely rather than flagged.
function bucketKey(t: Transaction): string {
  return `${t.categoryId ?? 'uncategorized'}|${t.occurredAt.slice(0, 10)}|${t.amountCents}|${t.currency}`;
}

export function findDuplicateGroups(transactions: Transaction[]): DuplicateGroup[] {
  const buckets = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (t.deletedAt) continue; // store.transactions is the full live list — filter here, same as every other consumer
    const key = bucketKey(t);
    const arr = buckets.get(key) ?? [];
    arr.push(t);
    buckets.set(key, arr);
  }

  const groups: DuplicateGroup[] = [];
  for (const [key, members] of buckets) {
    if (members.length < 2) continue;
    const sorted = [...members].sort(
      (a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id),
    );
    const allSameAccount = sorted.every((t) => t.accountId === sorted[0].accountId);
    groups.push({ key, confidence: allSameAccount ? 'high' : 'secondary', transactions: sorted });
  }

  // High-confidence first; within a tier, most-recent day first; stable
  // tiebreak on key so re-render order never jitters as groups resolve.
  return groups.sort((a, b) => {
    if (a.confidence !== b.confidence) return a.confidence === 'high' ? -1 : 1;
    const dayA = a.transactions[0].occurredAt.slice(0, 10);
    const dayB = b.transactions[0].occurredAt.slice(0, 10);
    if (dayA !== dayB) return dayB.localeCompare(dayA);
    return a.key.localeCompare(b.key);
  });
}

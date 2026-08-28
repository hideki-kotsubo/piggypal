import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../lib/store';
import { findDuplicateGroups, type DuplicateGroup } from '../lib/duplicateTransactions';
import { accountLabel, formatAmount, formatDateTime, formatRelativeDate, transactionTitle } from '../lib/format';

// Backlog 2026-08-27 — scans every active transaction for likely
// duplicates (same account+category+day+amount+currency, or a weaker
// cross-account tier) and lets the user resolve each group explicitly.
// No separate "evaluate" step needed: findDuplicateGroups is a pure,
// instant in-memory computation over store.transactions (already a live
// PowerSync watch query) — navigating here via TransactionList's new
// button *is* the evaluate action. Once a group's losers are
// soft-deleted, this useMemo reruns and the group naturally drops out.
export function DuplicateTransactionsScreen() {
  const store = useStore();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  // No default keeper heuristic — docs/04's original dedupe guard was
  // explicitly "never silently drop" a candidate; each group requires an
  // explicit tap before it can be confirmed.
  const [keepers, setKeepers] = useState<Record<string, string | null>>({});

  const groups = useMemo(
    () => findDuplicateGroups(store.transactions).filter((g) => !dismissed.has(g.key)),
    [store.transactions, dismissed],
  );

  function selectKeeper(groupKey: string, transactionId: string) {
    setKeepers((k) => ({ ...k, [groupKey]: transactionId }));
  }

  function dismissGroup(groupKey: string) {
    // Session-local only — no schema field exists to persist this, and
    // the tight signature should keep false positives rare (accepted v1
    // gap, not a design flaw).
    setDismissed((d) => new Set(d).add(groupKey));
  }

  async function confirmGroup(group: DuplicateGroup) {
    const keeperId = keepers[group.key];
    if (!keeperId) return;
    const loserIds = group.transactions.filter((t) => t.id !== keeperId).map((t) => t.id);
    await store.deleteTransactions(loserIds);
  }

  return (
    <main className="home">
      <div className="app-bar">
        <Link to="/transactions" className="back-link">← Back</Link>
        <span className="wordmark">Find duplicates</span>
        <span style={{ width: '3rem' }} />
      </div>

      {groups.length === 0 ? (
        <p className="empty-note">No likely duplicates found.</p>
      ) : (
        <div className="merge-review">
          <div className="merge-conflicts">
            {groups.map((group) => {
              const keeperId = keepers[group.key] ?? null;
              const first = group.transactions[0];
              return (
                <div className="merge-conflict" key={group.key} data-testid="duplicate-group">
                  <p className="merge-conflict-title dup-group-title">
                    <span>
                      {group.transactions.length} transactions · {formatAmount(first.amountCents, first.currency)} ·{' '}
                      {formatRelativeDate(first.occurredAt)}
                    </span>
                    <span
                      className={`dup-tier-badge tier-${group.confidence}`}
                      data-testid="duplicate-tier-badge"
                    >
                      {group.confidence === 'high' ? 'Likely duplicate' : 'Possible duplicate'}
                    </span>
                  </p>
                  <div>
                    {group.transactions.map((t) => {
                      const category = store.categories.find((c) => c.id === t.categoryId);
                      const account = store.accounts.find((a) => a.id === t.accountId);
                      const isKeeper = keeperId === t.id;
                      const cls = isKeeper ? 'picked-survivor' : keeperId ? 'picked-duplicate' : '';
                      return (
                        <button
                          key={t.id}
                          className={`tx-row tx-row-tappable ${cls}`}
                          data-testid="duplicate-row"
                          data-keeper={isKeeper}
                          onClick={() => selectKeeper(group.key, t.id)}
                        >
                          <div className="tx-left">
                            <div className="tx-main">
                              <span className="tx-note">
                                {isKeeper && <span className="merge-badge">Keeper</span>}
                                {!isKeeper && keeperId !== null && <span className="merge-check">○</span>}
                                {transactionTitle(t, category)}
                              </span>
                              <span className="tx-meta">
                                {category?.name ?? 'Uncategorized'} · {formatDateTime(t.occurredAt)} ·{' '}
                                {account ? accountLabel(account) : '—'}
                              </span>
                            </div>
                          </div>
                          <span className={`tx-amt ${t.amountCents < 0 ? 'out' : 'in'}`}>
                            {formatAmount(t.amountCents, t.currency)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="chip-row">
                    <button className="chip ghost" data-testid="dismiss-group" onClick={() => dismissGroup(group.key)}>
                      Not a duplicate
                    </button>
                    <button
                      className="save-btn"
                      data-testid="confirm-group"
                      disabled={!keeperId}
                      onClick={() => void confirmGroup(group)}
                    >
                      Keep 1, delete {group.transactions.length - 1}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </main>
  );
}

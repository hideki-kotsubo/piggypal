import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../lib/store';
import { formatAmount, formatRelativeDate } from '../lib/format';
import type { Transaction } from '../lib/types';

// docs/07 "The inbox" + D26: raw utterance stays visible until categorized;
// tapping a chip categorizes in place, no return to a list.
export function InboxScreen() {
  const store = useStore();
  const chipCategories = store.rankedCategories();

  // Snapshot which transactions were uncategorized when this screen opened.
  // The store filters categoryId === null, so once categorizeTransaction()
  // fires the item would otherwise vanish from a live-filtered list on the
  // next render — the opposite of D26's "in place, no disappearing." Keeping
  // this screen's own id list stable lets an item stay put and switch to a
  // dim/done state instead.
  const [ids] = useState<string[]>(() =>
    store.transactions.filter((t) => !t.deletedAt && !t.categoryId).map((t) => t.id),
  );

  const items = ids
    .map((id) => store.transactions.find((t) => t.id === id))
    .filter((t): t is Transaction => t !== undefined && !t.deletedAt);

  return (
    <main className="home">
      <div className="app-bar">
        <Link to="/" className="back-link">← Back</Link>
        <span className="wordmark">Inbox</span>
        <span style={{ width: '3rem' }} />
      </div>

      {items.length === 0 ? (
        <p className="empty-note">Nothing needs a category.</p>
      ) : (
        <div className="inbox-list">
          {items.map((t) => {
            const done = Boolean(t.categoryId);
            const doneCategory = done ? store.categories.find((c) => c.id === t.categoryId) : null;
            return (
              <div className={`inbox-item${done ? ' done' : ''}`} key={t.id}>
                <div className="tx-row">
                  <div className="tx-main">
                    <span className="tx-note">{t.aiRaw ?? t.note ?? 'Uncategorized'}</span>
                    <span className="tx-meta">
                      {formatRelativeDate(t.occurredAt)} · {t.source}
                    </span>
                  </div>
                  <span className={`tx-amt ${t.amountCents < 0 ? 'out' : 'in'}`}>
                    {formatAmount(t.amountCents, t.currency)}
                  </span>
                </div>

                {done ? (
                  <p className="inbox-done-note">✓ Categorized as {doneCategory?.name ?? '…'}</p>
                ) : (
                  <div className="chip-row">
                    {chipCategories.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className="chip"
                        onClick={() => store.categorizeTransaction(t.id, c.id)}
                      >
                        {c.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}

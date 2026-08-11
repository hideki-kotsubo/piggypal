import { Link } from 'react-router-dom';
import { useState } from 'react';
import { useStore } from '../lib/store';
import { accountLabel, formatAmount, formatRelativeDate, formatTime } from '../lib/format';
import { TransactionEditForm } from './TransactionEditForm';

export function TransactionList() {
  const store = useStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const all = [...store.transactions]
    .filter((t) => !t.deletedAt)
    .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));

  return (
    <main className="home">
      <div className="app-bar">
        <Link to="/" className="back-link">← Back</Link>
        <span className="wordmark">Transactions</span>
        <span style={{ width: '3rem' }} />
      </div>

      {all.length === 0 ? (
        <p className="empty-note">Nothing logged yet.</p>
      ) : (
        <div className="recent" style={{ marginTop: '0.5rem' }}>
          {all.map((t) => {
            const category = store.categories.find((c) => c.id === t.categoryId);
            const account = store.accounts.find((a) => a.id === t.accountId);
            const isEditing = editingId === t.id;
            return (
              <div className="account-block" key={t.id}>
                <button
                  className="tx-row tx-row-tappable"
                  onClick={() => setEditingId(isEditing ? null : t.id)}
                >
                  <div className="tx-main">
                    <span className="tx-note">{t.note ?? 'Uncategorized'}</span>
                    <span className="tx-meta">
                      {category?.name ?? 'Uncategorized'} · {formatRelativeDate(t.occurredAt)}, {formatTime(t.occurredAt)} · {account ? accountLabel(account) : '—'}
                    </span>
                  </div>
                  <span className={`tx-amt ${t.amountCents < 0 ? 'out' : 'in'}`}>
                    {formatAmount(t.amountCents, t.currency)}
                  </span>
                </button>
                {isEditing && (
                  <div className="account-edit">
                    <TransactionEditForm transaction={t} onDone={() => setEditingId(null)} />
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

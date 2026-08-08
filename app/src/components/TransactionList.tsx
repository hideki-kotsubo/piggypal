import { Link } from 'react-router-dom';
import { useStore } from '../lib/store';
import { formatAmount, formatRelativeDate } from '../lib/format';

export function TransactionList() {
  const store = useStore();
  const all = [...store.transactions]
    .filter((t) => !t.deletedAt)
    .sort((a, b) => (a.occurredOn < b.occurredOn ? 1 : -1));

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
            return (
              <div className="tx-row" key={t.id}>
                <div className="tx-main">
                  <span className="tx-note">{t.note ?? 'Uncategorized'}</span>
                  <span className="tx-meta">
                    {category?.name ?? 'Uncategorized'} · {formatRelativeDate(t.occurredOn)} · {t.source}
                  </span>
                </div>
                <span className={`tx-amt ${t.amountCents < 0 ? 'out' : 'in'}`}>
                  {formatAmount(t.amountCents, t.currency)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}

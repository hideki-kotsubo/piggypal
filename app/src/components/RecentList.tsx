import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../lib/store';
import { accountLabel, formatAmount, formatRelativeDate } from '../lib/format';
import { TransactionEditForm } from './TransactionEditForm';

const PREVIEW_COUNT = 5;

export function RecentList() {
  const store = useStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const active = [...store.transactions]
    .filter((t) => !t.deletedAt)
    .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));
  const recent = active.slice(0, PREVIEW_COUNT);

  if (recent.length === 0) {
    return (
      <section>
        <div className="section-label">Recent</div>
        <p className="empty-note">Nothing logged yet — try the entry box above.</p>
      </section>
    );
  }

  return (
    <section>
      <div className="section-label">Recent</div>
      <div className="recent">
        {recent.map((t) => {
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
                    {formatRelativeDate(t.occurredAt)} · {account ? accountLabel(account) : '—'}
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
      {active.length > PREVIEW_COUNT && (
        <Link to="/transactions" className="see-all">see all →</Link>
      )}
    </section>
  );
}

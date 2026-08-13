import { Link } from 'react-router-dom';
import { useStore } from '../lib/store';
import { accountLabel, formatAmount, formatRelativeDate } from '../lib/format';

const PREVIEW_COUNT = 5;

export function RecentList() {
  const store = useStore();
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
          return (
            <Link key={t.id} to={`/transactions/${t.id}`} className="tx-row tx-row-tappable">
              <div className="tx-main">
                <span className="tx-note">{t.note ?? 'Uncategorized'}</span>
                <span className="tx-meta">
                  {formatRelativeDate(t.occurredAt)} · {account ? accountLabel(account) : '—'}
                </span>
              </div>
              <span className={`tx-amt ${t.amountCents < 0 ? 'out' : 'in'}`}>
                {formatAmount(t.amountCents, t.currency)}
              </span>
            </Link>
          );
        })}
      </div>
      {active.length > PREVIEW_COUNT && (
        <Link to="/transactions" className="see-all">see all →</Link>
      )}
    </section>
  );
}

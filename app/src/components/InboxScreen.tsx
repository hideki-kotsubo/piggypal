import { Link, NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useStore } from '../lib/store';
import { accountLabel, formatAmount, formatRelativeDate, formatTime } from '../lib/format';

// docs/20: rows are the same tappable-list style as TransactionList/
// RecentList/Search (docs/17/18) — tap through to the transaction's full
// edit screen to pick a category (or fill in anything else) there,
// instead of each row carrying its own always-expanded CategoryPicker
// inline. Supersedes docs/07 D26's "stays put, dims to done" mechanic:
// that existed only because a live categoryId===null filter would make a
// row vanish out from under an inline picker the instant you tapped a
// chip. Navigating to a separate screen and back naturally remounts this
// one, so a live filter is simply correct now — no snapshot-on-mount/
// done-state bookkeeping needed, same as the list this now matches.
export function InboxScreen() {
  const store = useStore();
  const { t } = useTranslation();
  const items = store.transactions.filter((t) => !t.deletedAt && !t.categoryId);

  return (
    <main className="home">
      <div className="app-bar">
        <Link to="/" className="back-link">← {t('common.back')}</Link>
        <span className="wordmark">{t('nav.inbox')}</span>
        <span style={{ width: '3rem' }} />
      </div>

      {items.length === 0 ? (
        <p className="empty-note">{t('inbox.empty')}</p>
      ) : (
        <div className="recent" style={{ marginTop: '0.5rem' }}>
          {items.map((tx) => {
            const account = store.accounts.find((a) => a.id === tx.accountId);
            return (
              // docs/80 — /inbox/:id, so on a wide window the Inbox stays beside it.
              <NavLink key={tx.id} to={`/inbox/${tx.id}`} className="tx-row tx-row-tappable">
                <div className="tx-main">
                  <span className="tx-note">{tx.aiRaw ?? tx.note ?? t('common.noNote')}</span>
                  <span className="tx-meta">
                    {formatRelativeDate(tx.occurredAt)}, {formatTime(tx.occurredAt)} · {account ? accountLabel(account) : '—'}
                  </span>
                </div>
                <span className={`tx-amt ${tx.amountCents < 0 ? 'out' : 'in'}`}>
                  {formatAmount(tx.amountCents, tx.currency)}
                </span>
              </NavLink>
            );
          })}
        </div>
      )}
    </main>
  );
}

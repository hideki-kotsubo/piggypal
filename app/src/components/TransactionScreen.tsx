import { useEffect, useRef } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { isFreshBlank } from '../lib/freshBlankTransactions';
import { useStore } from '../lib/store';
import { TransactionEditForm } from './TransactionEditForm';
import { usePane } from '../lib/pane';

// How many detail panes currently show each transaction. React StrictMode
// mounts, unmounts and remounts every effect in development, so "the pane
// let go of this id" is decided after the current task, by the count.
const shownInPane = new Map<string, number>();

// docs/17: a dedicated screen for a single transaction, replacing the old
// inline expand-in-place edit (TransactionList/RecentList used to toggle a
// local editingId and render TransactionEditForm inline). Reachable from
// three places (Transactions list, Home's Recent list, and EntryZone's
// post-tap-entry auto-navigate), so back navigation goes to whatever the
// browser history actually has (navigate(-1)) rather than a fixed route —
// unlike every other screen's hardcoded back-link, a single target would be
// wrong when arriving from Home.
export function TransactionScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const store = useStore();
  const pane = usePane();
  const location = useLocation();
  const transaction = store.transactions.find((tx) => tx.id === id && !tx.deletedAt);
  const storeRef = useRef(store);
  storeRef.current = store;

  // Quick-add (docs/19) inserts a blank $0 row immediately so this screen has
  // something to edit. Every other entry path requires a nonzero amount
  // before it ever inserts, so a $0 amount here used to be treated as "the
  // user opened the blank row and left without setting one" — back out
  // drops it instead of leaving a stray "0.00, Uncategorized" transaction
  // behind. That amount-only check isn't enough on its own: a real user
  // hit this after their phone went offline, filled in amount/category/
  // note (confirmed correct locally), then reconnected — the sync
  // connection never resumed on its own (a separate bug), and after they
  // reloaded to force it, this row's amount read back as 0 again before
  // the edits had ever synced, and this exact guard deleted their real
  // entry. `isFreshBlank` (freshBlankTransactions.ts, memory-only, doesn't
  // survive a reload) narrows this to "still the same blank row from the
  // quick-add that created it, in this same session" — never a
  // preexisting row a reload brought back looking blank.
  function finish() {
    if (transaction && transaction.amountCents === 0 && isFreshBlank(transaction.id)) {
      store.deleteTransaction(transaction.id);
    }
    // docs/80 — in a detail pane, closing goes back to the list beside it
    // (keeping its filters), not to whatever the history had before.
    if (pane?.pane === 'detail') navigate({ pathname: pane.base, search: location.search });
    else navigate(-1);
  }

  // docs/80 — in a pane you can click another row without pressing Done,
  // which skips finish(). Run the same fresh-blank cleanup when the pane
  // stops showing this transaction for any reason.
  const inPane = pane?.pane === 'detail';
  useEffect(() => {
    if (!inPane || !id) return;
    shownInPane.set(id, (shownInPane.get(id) ?? 0) + 1);
    return () => {
      shownInPane.set(id, (shownInPane.get(id) ?? 1) - 1);
      setTimeout(() => {
        if ((shownInPane.get(id) ?? 0) > 0) return;
        shownInPane.delete(id);
        const current = storeRef.current.transactions.find((tx) => tx.id === id && !tx.deletedAt);
        if (current && current.amountCents === 0 && isFreshBlank(id)) storeRef.current.deleteTransaction(id);
      }, 0);
    };
  }, [inPane, id]);

  return (
    <main className="home">
      <div className="app-bar">
        <button className="back-link" onClick={finish}>← {t('common.back')}</button>
        <span className="wordmark">{t('transaction.title')}</span>
        <span style={{ width: '3rem' }} />
      </div>

      {transaction ? (
        <div className="transaction-screen-content">
          {/* docs/50 — a split purchase's account breakdown now renders
              directly inside TransactionEditForm, not as a separate
              read-only note here. */}
          <TransactionEditForm transaction={transaction} onDone={finish} />
        </div>
      ) : (
        <p className="empty-note">{t('transaction.missing')}</p>
      )}
    </main>
  );
}

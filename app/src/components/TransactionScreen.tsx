import { useNavigate, useParams } from 'react-router-dom';
import { isFreshBlank } from '../lib/freshBlankTransactions';
import { useStore } from '../lib/store';
import { TransactionEditForm } from './TransactionEditForm';

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
  const store = useStore();
  const transaction = store.transactions.find((t) => t.id === id && !t.deletedAt);

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
    navigate(-1);
  }

  return (
    <main className="home">
      <div className="app-bar">
        <button className="back-link" onClick={finish}>← Back</button>
        <span className="wordmark">Transaction</span>
        <span style={{ width: '3rem' }} />
      </div>

      {transaction ? (
        <div className="transaction-screen-content">
          <TransactionEditForm transaction={transaction} onDone={finish} />
        </div>
      ) : (
        <p className="empty-note">This transaction was deleted or doesn't exist.</p>
      )}
    </main>
  );
}

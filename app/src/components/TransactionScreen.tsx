import { useNavigate, useParams } from 'react-router-dom';
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
  // before it ever inserts, so a $0 amount here only ever means the user
  // opened the blank row and left without setting one — back out drops it
  // instead of leaving a stray "0.00, Uncategorized" transaction behind.
  function finish() {
    if (transaction && transaction.amountCents === 0) {
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

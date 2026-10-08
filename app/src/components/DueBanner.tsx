import { Link } from 'react-router-dom';
import { useStore } from '../lib/store';
import { dueOccurrences, postedKeys, todayLocal } from '../lib/schedules';

// docs/57 D212/D214 — the in-app stand-in for a push reminder: shown only
// while some scheduled payment is due and unposted, same count-gated
// banner pattern as InboxBanner (docs/07 D25). auto_post rules never
// linger here — the store posts those as soon as they're due.
export function DueBanner() {
  const store = useStore();
  const count = dueOccurrences(store.scheduledPayments, postedKeys(store.transactions), todayLocal()).length;
  if (count === 0) return null;

  return (
    <Link to="/schedules" className="inbox-banner">
      <div className="inbox-badge">{count}</div>
      <p>{count === 1 ? 'A scheduled payment is' : `${count} scheduled payments are`} due</p>
      <span className="inbox-chevron">›</span>
    </Link>
  );
}

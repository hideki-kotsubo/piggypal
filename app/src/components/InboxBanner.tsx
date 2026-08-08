import { Link } from 'react-router-dom';
import { useStore } from '../lib/store';

// docs/07 D25: banner only, count-gated — never a permanent tab.
export function InboxBanner() {
  const store = useStore();
  const count = store.transactions.filter((t) => !t.deletedAt && !t.categoryId).length;
  if (count === 0) return null;

  return (
    <Link to="/inbox" className="inbox-banner">
      <div className="inbox-badge">{count}</div>
      <p>{count} {count === 1 ? 'entry needs' : 'entries need'} a category</p>
      <span className="inbox-chevron">›</span>
    </Link>
  );
}

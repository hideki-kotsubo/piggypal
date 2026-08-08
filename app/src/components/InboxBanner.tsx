import { useStore } from '../lib/store';

// docs/07 D25: banner only, count-gated — never a permanent tab.
export function InboxBanner() {
  const store = useStore();
  const count = store.transactions.filter((t) => !t.deletedAt && !t.categoryId).length;
  if (count === 0) return null;

  return (
    <div className="inbox-banner">
      <div className="inbox-badge">{count}</div>
      <p>{count} {count === 1 ? 'entry needs' : 'entries need'} a category</p>
    </div>
  );
}

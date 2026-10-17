import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useStore } from '../lib/store';

// docs/07 D25: banner only, count-gated — never a permanent tab.
export function InboxBanner() {
  const store = useStore();
  const { t } = useTranslation();
  const count = store.transactions.filter((t) => !t.deletedAt && !t.categoryId).length;
  if (count === 0) return null;

  return (
    <Link to="/inbox" className="inbox-banner">
      <div className="inbox-badge">{count}</div>
      <p>{t('banner.inbox', { count })}</p>
      <span className="inbox-chevron">›</span>
    </Link>
  );
}

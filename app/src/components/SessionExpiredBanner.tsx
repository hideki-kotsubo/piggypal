import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useDeletedNotice, useSessionExpired } from '../lib/auth';

// docs/68: sync can't resume until this device signs in again, and
// nothing else on Home would show it — new entries just quietly stay
// local. Same banner style as the inbox's.
export function SessionExpiredBanner() {
  const { t } = useTranslation();
  const expired = useSessionExpired();
  const deletedNotice = useDeletedNotice();
  // docs/72 D260 — the account was deleted from another device.
  if (deletedNotice !== null) {
    return (
      <Link to="/settings" className="inbox-banner">
        <div className="inbox-badge">!</div>
        <p>{t('banner.accountDeleted')}</p>
        <span className="inbox-chevron">›</span>
      </Link>
    );
  }
  if (!expired) return null;

  return (
    <Link to="/settings" className="inbox-banner">
      <div className="inbox-badge">!</div>
      <p>{t('banner.sessionExpired')}</p>
      <span className="inbox-chevron">›</span>
    </Link>
  );
}

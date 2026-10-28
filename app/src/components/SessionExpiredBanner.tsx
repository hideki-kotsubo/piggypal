import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useDeletedNotice, usePinNeeded, useSessionExpired, useVerifiedProfileId } from '../lib/auth';
import { getLocalUserId } from '../lib/identity';
import { useStore } from '../lib/store';
import { usePinResetNoticeText } from './PinScreen';

// docs/68: sync can't resume until this device signs in again, and
// nothing else on Home would show it — new entries just quietly stay
// local. Same banner style as the inbox's.
export function SessionExpiredBanner() {
  const { t } = useTranslation();
  const expired = useSessionExpired();
  const deletedNotice = useDeletedNotice();
  const pinNeeded = usePinNeeded();
  const store = useStore();
  const verified = useVerifiedProfileId() === getLocalUserId();
  const resetNotice = usePinResetNoticeText(store.profiles.find((p) => p.id === getLocalUserId()));
  // docs/72 D260 — the account was deleted from another device.
  if (deletedNotice !== null) {
    return (
      <Link to="/settings/sync" className="inbox-banner">
        <div className="inbox-badge">!</div>
        <p>{t('banner.accountDeleted')}</p>
        <span className="inbox-chevron">›</span>
      </Link>
    );
  }
  // docs/77 D304 — this person's PIN was reset from somewhere else. Shown
  // on every one of their devices until dismissed on Household (or, not
  // yet verified, it leads to the PIN prompt, which shows it too).
  if (resetNotice) {
    return (
      <Link to={verified ? '/settings/household' : '/settings/household/pin?mode=verify'} className="inbox-banner">
        <div className="inbox-badge">!</div>
        <p>{resetNotice}</p>
        <span className="inbox-chevron">›</span>
      </Link>
    );
  }
  // docs/77 D299 — this device's person has a PIN it hasn't entered yet,
  // so their "Only me" records aren't syncing to it.
  if (!expired && pinNeeded) {
    return (
      <Link to="/settings/household/pin?mode=verify" className="inbox-banner">
        <div className="inbox-badge">!</div>
        <p>{t('banner.pinNeeded')}</p>
        <span className="inbox-chevron">›</span>
      </Link>
    );
  }
  if (!expired) return null;

  return (
    <Link to="/settings/sync" className="inbox-banner">
      <div className="inbox-badge">!</div>
      <p>{t('banner.sessionExpired')}</p>
      <span className="inbox-chevron">›</span>
    </Link>
  );
}

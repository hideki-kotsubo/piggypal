import { Link } from 'react-router-dom';
import { useDeletedNotice, useSessionExpired } from '../lib/auth';

// docs/68: sync can't resume until this device signs in again, and
// nothing else on Home would show it — new entries just quietly stay
// local. Same banner style as the inbox's.
export function SessionExpiredBanner() {
  const expired = useSessionExpired();
  const deletedNotice = useDeletedNotice();
  // docs/72 D260 — the account was deleted from another device.
  if (deletedNotice !== null) {
    return (
      <Link to="/settings" className="inbox-banner">
        <div className="inbox-badge">!</div>
        <p>Your account was deleted — this device now works without sync</p>
        <span className="inbox-chevron">›</span>
      </Link>
    );
  }
  if (!expired) return null;

  return (
    <Link to="/settings" className="inbox-banner">
      <div className="inbox-badge">!</div>
      <p>Sync paused — sign in again to sync your entries</p>
      <span className="inbox-chevron">›</span>
    </Link>
  );
}

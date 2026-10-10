import { Link } from 'react-router-dom';
import { useSessionExpired } from '../lib/auth';

// docs/68: sync can't resume until this device signs in again, and
// nothing else on Home would show it — new entries just quietly stay
// local. Same banner style as the inbox's.
export function SessionExpiredBanner() {
  const expired = useSessionExpired();
  if (!expired) return null;

  return (
    <Link to="/settings" className="inbox-banner">
      <div className="inbox-badge">!</div>
      <p>Sync paused — sign in again to sync your entries</p>
      <span className="inbox-chevron">›</span>
    </Link>
  );
}

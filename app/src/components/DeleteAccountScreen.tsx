import { useState } from 'react';
import { Link } from 'react-router-dom';
import { deleteAccount, useAuthAccount } from '../lib/auth';
import { connectSync, disconnectSync } from '../lib/db';
import { getDeviceId, getLocalUserId } from '../lib/identity';
import { useOnline } from '../lib/syncNow';
import { useStore } from '../lib/store';

const CONFIRM_WORD = 'DELETE';

// docs/72 D257 — App Review 5.1.1(v): delete the account from inside the
// app. One account is the whole household (docs/48), so this removes the
// synced data for everyone in it, and only the owner (the profile whose id
// is the account's own id) can do it. This device keeps its data and
// carries on without an account, like signing out.
export function DeleteAccountScreen() {
  const store = useStore();
  const [authAccount, setAuthAccount] = useAuthAccount();
  const online = useOnline();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const isOwner = authAccount !== null && getLocalUserId() === authAccount.userId;
  const ownerName = store.profiles.find((p) => p.id === authAccount?.userId)?.displayName;
  const others = store.profiles.filter((p) => !p.deletedAt && p.id !== authAccount?.userId).map((p) => p.displayName);
  const otherDevices = store.devices.filter((d) => d.id !== getDeviceId()).length;

  // Sync goes off first: the server's deletions would otherwise stream
  // down and empty this device too. If the delete fails, it comes back on.
  async function handleDelete() {
    setBusy(true);
    setError(null);
    await disconnectSync();
    try {
      await deleteAccount();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't delete the account.");
      setBusy(false);
      void connectSync();
      return;
    }
    setAuthAccount(null);
    setDone(true);
  }

  return (
    <main className="home">
      <div className="app-bar">
        <Link to="/settings" className="back-link">← Back</Link>
        <span className="wordmark">Delete account</span>
        <span style={{ width: '3rem' }} />
      </div>

      {done ? (
        <div className="settings-field">
          <p className="delete-account-text">
            Your account and its synced data are deleted from our servers. Your budget is still on this device, and
            Flowtab keeps working here without an account.
          </p>
          <Link to="/settings" className="save-btn delete-account-done">
            Back to Settings
          </Link>
        </div>
      ) : !authAccount ? (
        <p className="empty-note">You're not signed in, so there's no account to delete.</p>
      ) : !isOwner ? (
        <div className="settings-field">
          <p className="delete-account-text">
            Only {ownerName ?? 'the person who created this account'} can delete it, because it deletes the data for
            everyone in the household. Ask them, or sign out to stop syncing on this device.
          </p>
        </div>
      ) : (
        <div className="settings-field">
          <p className="delete-account-text">
            This permanently deletes the account <strong>{authAccount.email}</strong> and everything synced to it
            from our servers. It can't be undone.
          </p>
          <ul className="delete-account-list">
            {others.length > 0 && (
              <li>
                It's a shared household: the data is deleted for <strong>{others.join(', ')}</strong> too.
              </li>
            )}
            {otherDevices > 0 && (
              <li>
                {otherDevices === 1 ? 'Your other device is' : `All ${otherDevices} other devices are`} signed out. A
                device that's online right now may also lose its copy.
              </li>
            )}
            <li>This device keeps its data and keeps working without an account.</li>
          </ul>
          <label className="field-label">
            Type {CONFIRM_WORD} to confirm
            <input
              className="text-input"
              autoCapitalize="characters"
              autoComplete="off"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
          </label>
          <button
            className="save-btn delete-account-btn"
            disabled={typed.trim().toUpperCase() !== CONFIRM_WORD || busy || !online}
            onClick={() => void handleDelete()}
          >
            {busy ? 'Deleting…' : 'Delete account'}
          </button>
          {!online && <p className="qr-caption">You're offline. Deleting the account needs a connection.</p>}
          {error && <p className="household-error delete-account-error">{error}</p>}
        </div>
      )}
    </main>
  );
}

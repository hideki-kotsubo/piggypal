import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { deleteAccount, useAuthAccount } from '../lib/auth';
import { connectSync, disconnectSync } from '../lib/db';
import { getDeviceId, getLocalUserId } from '../lib/identity';
import { useOnline } from '../lib/syncNow';
import { useStore } from '../lib/store';

// The English word always works too, so nobody gets stuck on a
// translation they can't type.
const CONFIRM_WORD_EN = 'DELETE';

// docs/72 D257 — App Review 5.1.1(v): delete the account from inside the
// app. One account is the whole household (docs/48), so this removes the
// synced data for everyone in it, and only the owner (the profile whose id
// is the account's own id) can do it. This device keeps its data and
// carries on without an account, like signing out.
export function DeleteAccountScreen() {
  const store = useStore();
  const { t } = useTranslation();
  const confirmWord = t('deleteAccount.confirmWord');
  const [authAccount, setAuthAccount] = useAuthAccount();
  const online = useOnline();
  const [typed, setTyped] = useState('');
  const typedWord = typed.trim().toUpperCase();
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
      setError(err instanceof Error ? err.message : t('deleteAccount.failed'));
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
        <Link to="/settings" className="back-link">← {t('common.back')}</Link>
        <span className="wordmark">{t('deleteAccount.title')}</span>
        <span style={{ width: '3rem' }} />
      </div>

      {done ? (
        <div className="settings-field">
          <p className="delete-account-text">{t('deleteAccount.doneText')}</p>
          <Link to="/settings" className="save-btn delete-account-done">
            {t('deleteAccount.backToSettings')}
          </Link>
        </div>
      ) : !authAccount ? (
        <p className="empty-note">{t('deleteAccount.notSignedIn')}</p>
      ) : !isOwner ? (
        <div className="settings-field">
          <p className="delete-account-text">
            {t('deleteAccount.notOwner', { owner: ownerName ?? t('deleteAccount.ownerFallback') })}
          </p>
        </div>
      ) : (
        <div className="settings-field">
          <p className="delete-account-text">
            <Trans i18nKey="deleteAccount.warning" values={{ email: authAccount.email }} components={{ strong: <strong /> }} />
          </p>
          <ul className="delete-account-list">
            {others.length > 0 && (
              <li>
                <Trans i18nKey="deleteAccount.sharedHousehold" values={{ names: others.join(', ') }} components={{ strong: <strong /> }} />
              </li>
            )}
            {otherDevices > 0 && (
              <li>{t('deleteAccount.otherDevices', { count: otherDevices })}</li>
            )}
            <li>{t('deleteAccount.thisDeviceKeeps')}</li>
          </ul>
          <label className="field-label">
            {t('deleteAccount.typeToConfirm', { word: confirmWord })}
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
            disabled={(typedWord !== confirmWord && typedWord !== CONFIRM_WORD_EN) || busy || !online}
            onClick={() => void handleDelete()}
          >
            {busy ? t('deleteAccount.deleting') : t('deleteAccount.title')}
          </button>
          {!online && <p className="qr-caption">{t('deleteAccount.offline')}</p>}
          {error && <p className="household-error delete-account-error">{error}</p>}
        </div>
      )}
    </main>
  );
}

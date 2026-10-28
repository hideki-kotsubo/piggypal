import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../lib/store';
import { Trans, useTranslation } from 'react-i18next';
import { guessDeviceLabel, useDeviceLabel } from '../lib/settings';
import { usePairedPeers } from '../lib/peers';
import { hasHousehold, householdMembers, useHouseholdPeers } from '../lib/household';
import { PayerBadge } from './PayerBadge';
import { formatTimeAgo } from '../lib/format';
import {
  clearPendingEmail,
  fetchPowerSyncCredentials,
  getRecentPendingEmail,
  requestMagicLink,
  setDeletedNotice,
  setKeptData,
  signOut,
  useAuthAccount,
  useDeletedNotice,
  useKeptData,
  useSessionExpired,
} from '../lib/auth';
import { disconnectSync, forceSync, usePendingUploadCount, useSyncStatus } from '../lib/db';
import { connectionLabel, formatLastSynced, useOnline, type ForceSyncResult } from '../lib/syncNow';
import { useSkippedSyncOps } from '../lib/connector';

export function SyncSettingsScreen() {
  const store = useStore();
  const { t } = useTranslation();
  const [deviceLabel, setDeviceLabel] = useDeviceLabel();
  const [peers] = usePairedPeers();
  const householdPeers = useHouseholdPeers();
  const [authAccount, setAuthAccount] = useAuthAccount();
  const syncStatus = useSyncStatus();
  const sessionExpired = useSessionExpired();
  const deletedNotice = useDeletedNotice();
  const keptData = useKeptData();
  const [signOutOpen, setSignOutOpen] = useState(false);
  const skippedSyncOps = useSkippedSyncOps();
  const navigate = useNavigate();
  // docs/56 D204: a link sent in the last 15 minutes resumes straight into
  // the code field — an iOS home-screen PWA often reloads from scratch
  // after the user switches to Mail and back.
  const [emailInput, setEmailInput] = useState(() => getRecentPendingEmail() ?? '');
  const [linkState, setLinkState] = useState<'idle' | 'sending' | 'sent' | 'error'>(() =>
    getRecentPendingEmail() ? 'sent' : 'idle',
  );
  const [linkError, setLinkError] = useState('');
  const [codeInput, setCodeInput] = useState('');
  const codeDigits = codeInput.replace(/\D/g, '');
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<ForceSyncResult | null>(null);
  const online = useOnline();
  const pendingUploads = usePendingUploadCount();
  // Re-render twice a minute so "Last synced just now" doesn't outlive
  // the minute it's true for.
  const [, setClockTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setClockTick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  // A real gap found from a real stuck device: its refresh chain had been
  // revoked server-side (see auth.ts's signOut comment), and there was no
  // way to sign out or force a fresh connection attempt — Settings just
  // showed "signed in as ___" next to a permanently "Not connected" cloud
  // sync with no recourse but clearing browser storage by hand.
  //
  // docs/75 D283: signing out erases this device by default (the server
  // keeps everything that synced); D284's "keep data" only disconnects,
  // and remembers which account the data belongs to. The server sign-out
  // goes first, while the refresh token is still there to revoke.
  async function handleSignOut(keepData: boolean) {
    if (!keepData) {
      await signOut();
      await store.resetLocalData();
      return;
    }
    const knownEmail = authAccount?.email ?? '';
    await disconnectSync();
    await signOut();
    setKeptData(authAccount);
    setAuthAccount(null);
    setSignOutOpen(false);
    setEmailInput(knownEmail);
  }

  // "Reconnect" only has something to do when the session itself is still
  // valid — it can't revive one that's actually dead (revoked/expired),
  // since there's no credential left to reconnect with (see auth.ts's
  // signOut comment on why that's not a bug). A real report found that
  // case looked identical to a broken button: tapping it just did
  // nothing, with zero feedback either way. Checking credentials directly
  // first tells the two apart — a dead session now drops straight into
  // the sign-in-again form instead of silently failing, with the known
  // email pre-filled since there's no reason to make the user retype
  // something this device already knows.
  //
  // docs/69 D246: the same handler backs "Sync now" while connected —
  // forceSync() is a reconnect that also waits for the sync to land.
  async function handleSyncNow() {
    setSyncing(true);
    setSyncResult(null);
    try {
      await disconnectSync();
      const credentials = await fetchPowerSyncCredentials();
      if (!credentials) {
        const knownEmail = authAccount?.email ?? '';
        setAuthAccount(null);
        setEmailInput(knownEmail);
        return;
      }
      setSyncResult(await forceSync());
    } finally {
      setSyncing(false);
    }
  }
  const downloadProgress = syncStatus.downloadProgress;
  const syncError = syncStatus.dataFlowStatus.downloadError ?? syncStatus.dataFlowStatus.uploadError;

  // docs/05 flow step 1: "User taps 'Enable sync & AI' → enters email."
  async function sendMagicLink() {
    setLinkState('sending');
    try {
      await requestMagicLink(emailInput.trim());
      setLinkState('sent');
    } catch (err) {
      setLinkState('error');
      setLinkError(err instanceof Error ? err.message : t('settings.sendFailed'));
    }
  }

  // docs/56 D204: finish sign-in with the emailed code, right here in the
  // context that asked for it. The code rides in router state, never the
  // URL, so it doesn't land in history; AuthVerifyScreen runs the same
  // post-verify profile/merge flow either way.
  function submitCode() {
    navigate('/auth/verify', { state: { email: emailInput.trim(), code: codeDigits } });
  }

  function useDifferentEmail() {
    clearPendingEmail();
    setCodeInput('');
    setLinkState('idle');
  }

  function resetData() {
    if (
      !window.confirm(t('settings.resetConfirm'))
    ) {
      return;
    }
    void store.resetLocalData();
  }

  return (
    <main className="home">
      <div className="app-bar">
        <Link to="/settings" className="back-link">← {t('common.back')}</Link>
        <span className="wordmark">{t('settingsHub.accountSync')}</span>
        <span style={{ width: '3rem' }} />
      </div>

      <div className="section-label">{t('settings.account')}</div>
      {/* docs/72 D260 — signed out because the owner deleted the account
          on another device. */}
      {!authAccount && deletedNotice !== null && (
        <div className="settings-field account-deleted-note">
          <p className="delete-account-text">
            {deletedNotice ? (
              <Trans i18nKey="settings.accountDeletedNotice" values={{ email: deletedNotice }} components={{ strong: <strong /> }} />
            ) : (
              t('settings.accountDeletedNoticeAnon')
            )}
          </p>
          <button type="button" className="chip ghost" onClick={() => setDeletedNotice(null)}>
            {t('common.ok')}
          </button>
        </div>
      )}
      {authAccount ? (
        <div className="accounts-list">
          <div className="settings-row settings-row-static">
            <span>{t('settings.signedInAs')}</span>
            <span style={{ color: 'var(--ink-faint)', fontSize: '0.85rem' }}>{authAccount.email || t('settings.thisDeviceFallback')}</span>
          </div>
          <div className="settings-row settings-row-static">
            <span>{t('settings.cloudSync')}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ color: 'var(--ink-faint)', fontSize: '0.85rem' }}>
                {syncing
                  ? downloadProgress
                    ? t('settings.downloading', { percent: Math.round(downloadProgress.downloadedFraction * 100) })
                    : t('settings.syncing')
                  : connectionLabel(sessionExpired, online, syncStatus)}
              </span>
              {/* Available whether or not the status says connected — a
                  real report found the connection can silently stall
                  without ever leaving "Connecting…", and a "Connected"
                  device can still be behind (docs/69). Offline, it has
                  nothing to reach, so it's disabled rather than hidden. */}
              {!syncing && (
                <button
                  type="button"
                  className="chip ghost"
                  disabled={!online && !sessionExpired}
                  onClick={() => void handleSyncNow()}
                >
                  {sessionExpired ? t('settings.signInAgain') : syncStatus.connected ? t('settings.syncNow') : t('settings.reconnect')}
                </button>
              )}
            </span>
          </div>
          {!sessionExpired && (
            <div className="settings-row settings-row-static">
              <span>{t('settings.lastSynced')}</span>
              <span style={{ color: 'var(--ink-faint)', fontSize: '0.85rem' }}>
                {formatLastSynced(syncStatus.lastSyncedAt)}
              </span>
            </div>
          )}
          {pendingUploads > 0 && (
            <div className="settings-row settings-row-static">
              <span>{t('settings.waitingUpload')}</span>
              <span style={{ color: 'var(--ink-faint)', fontSize: '0.85rem' }}>
                {t('settings.changes', { count: pendingUploads })}
              </span>
            </div>
          )}
          {/* D247: the SDK's error text is raw server JSON — kept in the
              tooltip for debugging, not shown as the message. */}
          {!syncing && (syncResult === 'still-running' || (syncResult === 'error' && syncError)) && (
            <div className="settings-row settings-row-static">
              <span>{t('settings.sync')}</span>
              <span
                title={syncResult === 'error' ? syncError?.message : undefined}
                style={{ color: syncResult === 'error' ? 'var(--warn)' : 'var(--ink-faint)', fontSize: '0.85rem' }}
              >
                {syncResult === 'error' ? t('settings.syncRetrying') : t('settings.syncBackground')}
              </span>
            </div>
          )}
          {/* docs/46 D163 — the whole point of this endpoint no longer
              returning a bare { ok: true }: a skipped op is now visible
              here instead of silently vanishing from view. */}
          {skippedSyncOps.length > 0 && (
            <div className="settings-row settings-row-static">
              <span>{t('settings.sync')}</span>
              <span style={{ color: 'var(--warn)', fontSize: '0.85rem' }}>
                {t('settings.skipped', { count: skippedSyncOps.length })}
              </span>
            </div>
          )}
          <button className="settings-row settings-row-danger" onClick={() => setSignOutOpen((v) => !v)}>
            <span>{t('settings.signOut')}</span>
            <span className="settings-row-arrow">{signOutOpen ? '⌄' : '›'}</span>
          </button>
          {signOutOpen && (
            <div className="settings-field signout-panel">
              <p className="delete-account-text">{t('signOut.explain')}</p>
              {/* D287 — erasing also drops the upload queue, so anything
                  still waiting there would be lost for good. */}
              {pendingUploads > 0 && (
                <p className="delete-account-text signout-warn">{t('signOut.pending', { count: pendingUploads })}</p>
              )}
              {pendingUploads > 0 && online && !sessionExpired && (
                <button type="button" className="chip ghost" disabled={syncing} onClick={() => void handleSyncNow()}>
                  {syncing ? t('settings.syncing') : t('settings.syncNow')}
                </button>
              )}
              <button className="save-btn delete-account-btn" onClick={() => void handleSignOut(false)}>
                {t('signOut.erase')}
              </button>
              <button type="button" className="chip ghost signout-keep" onClick={() => void handleSignOut(true)}>
                {t('signOut.keep')}
              </button>
            </div>
          )}
          {/* docs/72 D257 — App Review 5.1.1(v). */}
          <Link to="/settings/delete-account" className="settings-row settings-row-danger">
            <span>{t('settings.deleteAccount')}</span>
            <span className="settings-row-arrow">›</span>
          </Link>
        </div>
      ) : linkState === 'sent' ? (
        <div className="settings-field signin-code">
          <p className="qr-caption">
            {t('settings.codeSent', { email: emailInput.trim() })}
          </p>
          <label className="field-label">
            {t('settings.codeLabel')}
            <input
              className="text-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123 456"
              maxLength={7}
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && codeDigits.length === 6) submitCode();
              }}
            />
          </label>
          <div className="signin-code-actions">
            <button className="save-btn" onClick={submitCode} disabled={codeDigits.length !== 6}>
              {t('settings.signIn')}
            </button>
            <button type="button" className="chip ghost" onClick={useDifferentEmail}>
              {t('settings.differentEmail')}
            </button>
          </div>
        </div>
      ) : (
        <div className="settings-field">
          {/* docs/75 D284/D285 — signed out keeping data: only that
              account can pick it back up; any other one erases it first. */}
          {keptData && (
            <p className="delete-account-text">
              {keptData.email ? t('signOut.keptNote', { email: keptData.email }) : t('signOut.keptNoteAnon')}
            </p>
          )}
          <label className="field-label">
            {t('settings.enableSync')}
            <input
              className="text-input"
              type="email"
              placeholder={t('settings.emailPlaceholder')}
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
            />
          </label>
          {keptData?.email && emailInput.trim() && !sameEmail(emailInput, keptData.email) ? (
            <>
              <p className="delete-account-text signout-warn">{t('signOut.otherEmail', { email: keptData.email })}</p>
              <button className="save-btn delete-account-btn" onClick={resetData}>
                {t('signOut.eraseNow')}
              </button>
            </>
          ) : (
            <button
              className="save-btn"
              onClick={() => void sendMagicLink()}
              disabled={!emailInput.trim() || linkState === 'sending'}
            >
              {linkState === 'sending' ? t('settings.sending') : t('settings.sendLink')}
            </button>
          )}
          {linkState === 'error' && <p className="qr-caption">{linkError}</p>}
          {/* docs/71 D255 — no email needed when another device is
              already signed in to the account. */}
          <Link to="/auth/scan" className="text-link signin-scan-link">
            {t('settings.scanCode')}
          </Link>
        </div>
      )}

      <div className="section-label">{t('settings.sync')}</div>
      <div className="settings-field">
        <label className="field-label">
          {t('settings.deviceName')}
          <input
            className="text-input"
            placeholder={guessDeviceLabel()}
            value={deviceLabel}
            onChange={(e) => {
              setDeviceLabel(e.target.value);
              // docs/48 D176 — keep this device's synced row's label in
              // step with what Settings shows, so the household devices
              // list below (and any other device's view of it) doesn't
              // go stale the moment this is renamed.
              void store.touchDevice();
            }}
          />
        </label>
      </div>
      {peers.length > 0 && (
        <>
          <div className="section-label">{t('settings.pairedDevices')}</div>
          <div className="accounts-list">
            {/* Tappable, unlike the earlier static version — the whole
                point of remembering a peer (docs/25 D138) is a lighter
                repeat sync: this jumps straight into pairing with the
                own-device/someone-else question already answered from
                last time, instead of the full choice flow again. */}
            {peers.map((p) => (
              <Link key={p.id} to={`/settings/pair?peer=${encodeURIComponent(p.id)}`} className="settings-row">
                <span>{p.label}</span>
                <span style={{ color: 'var(--ink-faint)', fontSize: '0.8rem' }}>{t('settings.synced', { time: formatTimeAgo(p.lastSyncedAt) })}</span>
              </Link>
            ))}
          </div>
        </>
      )}

      {/* Signed in, the Household screen covers this (docs/71); this stays
          for a household formed only through docs/25's P2P pairing. */}
      {!authAccount && hasHousehold(householdPeers) && (
        <>
          {/* docs/26 D124 — bare read-only members list, just enough to say
              who the payer/owner badges elsewhere refer to. No invite/
              pair/leave actions here; that surface belongs to docs/25's
              pairing flow above, not this list. */}
          <div className="section-label">{t('settings.household')}</div>
          <div className="accounts-list">
            {householdMembers(householdPeers, store.profiles).map((m) => (
              <div className="member-row" key={m.userId}>
                <PayerBadge label={m.label} mine={m.isYou} className="member-badge" />
                <span className="member-name">
                  {m.label}
                  {m.isYou && <span className="member-you">{t('household.you')}</span>}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Dev-stage only — see store.tsx's resetLocalData comment. Remove
          once this app has a real migration story instead of "wipe and
          reseed" as the answer to a schema change. docs/79 D310: lives
          here now, next to the rest of this device's data. */}
      <div className="section-label">{t('settings.developer')}</div>
      <div className="accounts-list">
        <button className="settings-row settings-row-danger" onClick={resetData}>
          <span>{t('settings.resetData')}</span>
        </button>
      </div>
    </main>
  );
}

// Emails are stored lowercased by the server; typed ones may not be.
function sameEmail(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}


import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../lib/store';
import { ACCOUNT_PICKER_SCALE_THRESHOLD, guessDeviceLabel, useAccountPickerMode, useDeviceLabel, useThemeMode } from '../lib/settings';
import { usePairedPeers } from '../lib/peers';
import { hasHousehold, householdMembers, useHouseholdPeers } from '../lib/household';
import { PayerBadge } from './PayerBadge';
import { APP_VERSION } from '../lib/version';
import { fetchPowerSyncCredentials, requestMagicLink, signOut, useAuthAccount } from '../lib/auth';
import { connectSync, disconnectSync, useSyncStatus } from '../lib/db';
import { useSkippedSyncOps } from '../lib/connector';

// "synced just now" / "N minutes/hours ago" — finer-grained than
// format.ts's formatRelativeDate (which only resolves to whole calendar
// days), needed here since a peer synced 20 minutes ago and one synced
// yesterday should read differently, not both collapse to "today".
function formatSyncedAgo(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function SettingsScreen() {
  const store = useStore();
  const [pickerMode, setPickerMode] = useAccountPickerMode();
  const [themeMode, setThemeMode] = useThemeMode();
  const [deviceLabel, setDeviceLabel] = useDeviceLabel();
  const [peers] = usePairedPeers();
  const householdPeers = useHouseholdPeers();
  const [authAccount, setAuthAccount] = useAuthAccount();
  const syncStatus = useSyncStatus();
  const skippedSyncOps = useSkippedSyncOps();
  const [emailInput, setEmailInput] = useState('');
  const [linkState, setLinkState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [linkError, setLinkError] = useState('');
  const [reconnecting, setReconnecting] = useState(false);

  // A real gap found from a real stuck device: its refresh chain had been
  // revoked server-side (see auth.ts's signOut comment), and there was no
  // way to sign out or force a fresh connection attempt — Settings just
  // showed "signed in as ___" next to a permanently "Not connected" cloud
  // sync with no recourse but clearing browser storage by hand.
  async function handleSignOut() {
    const knownEmail = authAccount?.email ?? '';
    await disconnectSync();
    await signOut();
    setAuthAccount(null);
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
  async function handleReconnect() {
    setReconnecting(true);
    try {
      await disconnectSync();
      const credentials = await fetchPowerSyncCredentials();
      if (!credentials) {
        const knownEmail = authAccount?.email ?? '';
        setAuthAccount(null);
        setEmailInput(knownEmail);
        return;
      }
      await connectSync();
    } finally {
      setReconnecting(false);
    }
  }
  // docs/13 D69 — only surface this once it'd actually do something,
  // rather than a control that's a no-op below the threshold.
  const showPickerModeSetting = store.accounts.filter((a) => !a.archived).length > ACCOUNT_PICKER_SCALE_THRESHOLD;

  // docs/05 flow step 1: "User taps 'Enable sync & AI' → enters email."
  async function sendMagicLink() {
    setLinkState('sending');
    try {
      await requestMagicLink(emailInput.trim());
      setLinkState('sent');
    } catch (err) {
      setLinkState('error');
      setLinkError(err instanceof Error ? err.message : 'Could not send the link.');
    }
  }

  function resetData() {
    if (
      !window.confirm(
        'Erase all local data and reload with fresh seed data? This deletes every account, category, transaction, and budget on this device, and forgets every paired device.',
      )
    ) {
      return;
    }
    void store.resetLocalData();
  }

  return (
    <main className="home">
      <div className="app-bar">
        <Link to="/" className="back-link">← Back</Link>
        <span className="wordmark">Settings</span>
        <span style={{ width: '3rem' }} />
      </div>

      <div className="accounts-list">
        <Link to="/accounts" className="settings-row">
          <span>Accounts</span>
          <span className="settings-row-arrow">›</span>
        </Link>
        <Link to="/categories" className="settings-row">
          <span>Categories</span>
          <span className="settings-row-arrow">›</span>
        </Link>
      </div>

      <div className="section-label">Account</div>
      {authAccount ? (
        <div className="accounts-list">
          <div className="settings-row settings-row-static">
            <span>Signed in as</span>
            <span style={{ color: 'var(--ink-faint)', fontSize: '0.85rem' }}>{authAccount.email || '(this device)'}</span>
          </div>
          <div className="settings-row settings-row-static">
            <span>Cloud sync</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ color: 'var(--ink-faint)', fontSize: '0.85rem' }}>
                {reconnecting ? 'Reconnecting…' : syncStatus.connected ? 'Connected' : syncStatus.connecting ? 'Connecting…' : 'Not connected'}
              </span>
              {/* Not gated to the "Not connected" case only — a real report
                  found the sync connection can silently stall without the
                  status ever flipping away from "Connecting…", so this
                  stays available whenever it isn't already mid-attempt. */}
              {!reconnecting && !syncStatus.connected && (
                <button type="button" className="chip ghost" onClick={() => void handleReconnect()}>
                  Reconnect
                </button>
              )}
            </span>
          </div>
          {/* docs/46 D163 — the whole point of this endpoint no longer
              returning a bare { ok: true }: a skipped op is now visible
              here instead of silently vanishing from view. */}
          {skippedSyncOps.length > 0 && (
            <div className="settings-row settings-row-static">
              <span>Sync</span>
              <span style={{ color: 'var(--warn)', fontSize: '0.85rem' }}>
                {skippedSyncOps.length} item{skippedSyncOps.length === 1 ? '' : 's'} didn't sync
              </span>
            </div>
          )}
          <button className="settings-row settings-row-danger" onClick={() => void handleSignOut()}>
            <span>Sign out</span>
          </button>
        </div>
      ) : linkState === 'sent' ? (
        <div className="settings-row settings-row-static">
          <span>Check your email for a sign-in link.</span>
        </div>
      ) : (
        <div className="settings-field">
          <label className="field-label">
            Enable cloud sync & AI entry
            <input
              className="text-input"
              type="email"
              placeholder="you@example.com"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
            />
          </label>
          <button
            className="save-btn"
            onClick={() => void sendMagicLink()}
            disabled={!emailInput.trim() || linkState === 'sending'}
          >
            {linkState === 'sending' ? 'Sending…' : 'Send sign-in link'}
          </button>
          {linkState === 'error' && <p className="qr-caption">{linkError}</p>}
        </div>
      )}

      <div className="section-label">Sync</div>
      <div className="settings-field">
        <label className="field-label">
          This device's name
          <input
            className="text-input"
            placeholder={guessDeviceLabel()}
            value={deviceLabel}
            onChange={(e) => setDeviceLabel(e.target.value)}
          />
        </label>
      </div>
      <div className="accounts-list">
        <Link to="/settings/pair" className="settings-row">
          <span>+ Connect a device</span>
          <span className="settings-row-arrow">›</span>
        </Link>
      </div>
      {peers.length > 0 && (
        <>
          <div className="section-label">Paired devices</div>
          <div className="accounts-list">
            {/* Tappable, unlike the earlier static version — the whole
                point of remembering a peer (docs/25 D138) is a lighter
                repeat sync: this jumps straight into pairing with the
                own-device/someone-else question already answered from
                last time, instead of the full choice flow again. */}
            {peers.map((p) => (
              <Link key={p.id} to={`/settings/pair?peer=${encodeURIComponent(p.id)}`} className="settings-row">
                <span>{p.label}</span>
                <span style={{ color: 'var(--ink-faint)', fontSize: '0.8rem' }}>synced {formatSyncedAgo(p.lastSyncedAt)}</span>
              </Link>
            ))}
          </div>
        </>
      )}

      {hasHousehold(householdPeers) && (
        <>
          {/* docs/26 D124 — bare read-only members list, just enough to say
              who the payer/owner badges elsewhere refer to. No invite/
              pair/leave actions here; that surface belongs to docs/25's
              pairing flow above, not this list. */}
          <div className="section-label">Household</div>
          <div className="accounts-list">
            {householdMembers(householdPeers).map((m) => (
              <div className="member-row" key={m.userId}>
                <PayerBadge label={m.label} mine={m.isYou} className="member-badge" />
                <span className="member-name">
                  {m.label}
                  {m.isYou && <span className="member-you">you</span>}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="section-label">Appearance</div>
      <div className="chip-row settings-chip-row">
        <button
          className={`chip ${themeMode === 'system' ? 'picked' : ''}`}
          onClick={() => setThemeMode('system')}
        >
          System
        </button>
        <button
          className={`chip ${themeMode === 'light' ? 'picked' : ''}`}
          onClick={() => setThemeMode('light')}
        >
          Light
        </button>
        <button
          className={`chip ${themeMode === 'dark' ? 'picked' : ''}`}
          onClick={() => setThemeMode('dark')}
        >
          Dark
        </button>
      </div>

      {showPickerModeSetting && (
        <>
          <div className="section-label">Account picker</div>
          <div className="settings-row settings-row-static">
            <span>When there's a lot of accounts, show them</span>
          </div>
          <div className="chip-row settings-chip-row">
            <button
              className={`chip ${pickerMode === 'grouped' ? 'picked' : ''}`}
              onClick={() => setPickerMode('grouped')}
            >
              Grouped by institution
            </button>
            <button
              className={`chip ${pickerMode === 'capped' ? 'picked' : ''}`}
              onClick={() => setPickerMode('capped')}
            >
              Most-used, capped
            </button>
          </div>
        </>
      )}

      {/* Dev-stage only — see store.tsx's resetLocalData comment. Remove
          once this app has a real migration story instead of "wipe and
          reseed" as the answer to a schema change. */}
      <div className="section-label">Developer</div>
      <div className="accounts-list">
        <button className="settings-row settings-row-danger" onClick={resetData}>
          <span>Reset local data</span>
        </button>
      </div>

      <div className="accounts-list">
        <Link to="/about" className="settings-row">
          <span>About piggypal</span>
          <span style={{ color: 'var(--ink-faint)', fontSize: '0.85rem' }}>v{APP_VERSION}</span>
        </Link>
      </div>
    </main>
  );
}

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../lib/store';
import { ACCOUNT_PICKER_SCALE_THRESHOLD, guessDeviceLabel, useAccountPickerMode, useDeviceLabel, useThemeMode } from '../lib/settings';
import { usePairedPeers } from '../lib/peers';
import { hasHousehold, householdMembers } from '../lib/household';
import { PayerBadge } from './PayerBadge';
import { APP_VERSION } from '../lib/version';
import { requestMagicLink, useAuthAccount } from '../lib/auth';
import { useSyncStatus } from '../lib/db';

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
  const [authAccount] = useAuthAccount();
  const syncStatus = useSyncStatus();
  const [emailInput, setEmailInput] = useState('');
  const [linkState, setLinkState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [linkError, setLinkError] = useState('');
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
            <span style={{ color: 'var(--ink-faint)', fontSize: '0.85rem' }}>
              {syncStatus.connected ? 'Connected' : syncStatus.connecting ? 'Connecting…' : 'Not connected'}
            </span>
          </div>
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

      {hasHousehold(peers) && (
        <>
          {/* docs/26 D124 — bare read-only members list, just enough to say
              who the payer/owner badges elsewhere refer to. No invite/
              pair/leave actions here; that surface belongs to docs/25's
              pairing flow above, not this list. */}
          <div className="section-label">Household</div>
          <div className="accounts-list">
            {householdMembers(peers).map((m) => (
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

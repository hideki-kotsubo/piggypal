import { Link } from 'react-router-dom';
import { useStore } from '../lib/store';
import { ACCOUNT_PICKER_SCALE_THRESHOLD, guessDeviceLabel, useAccountPickerMode, useDeviceLabel, useThemeMode } from '../lib/settings';
import { usePairedPeers } from '../lib/peers';
import { APP_VERSION } from '../lib/version';

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
  // docs/13 D69 — only surface this once it'd actually do something,
  // rather than a control that's a no-op below the threshold.
  const showPickerModeSetting = store.accounts.filter((a) => !a.archived).length > ACCOUNT_PICKER_SCALE_THRESHOLD;

  function resetData() {
    if (
      !window.confirm(
        'Erase all local data and reload with fresh seed data? This deletes every account, category, transaction, and budget on this device.',
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

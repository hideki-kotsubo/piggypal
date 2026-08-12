import { Link } from 'react-router-dom';
import { useStore } from '../lib/store';
import { ACCOUNT_PICKER_SCALE_THRESHOLD, useAccountPickerMode, useThemeMode } from '../lib/settings';

export function SettingsScreen() {
  const store = useStore();
  const [pickerMode, setPickerMode] = useAccountPickerMode();
  const [themeMode, setThemeMode] = useThemeMode();
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
    </main>
  );
}

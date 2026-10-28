import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import i18n, { LANGUAGES, useLanguagePreference } from '../lib/i18n';
import { useStore } from '../lib/store';
import { useDollarPreference } from '../lib/dollar';
import { useThemeMode } from '../lib/settings';
import { APP_VERSION } from '../lib/version';
import { useAuthAccount, useSessionExpired } from '../lib/auth';
import { useInstallPrompt } from '../lib/installPrompt';
import { useSyncStatus } from '../lib/db';
import { connectionLabel, useOnline } from '../lib/syncNow';

// docs/79 D310 — Settings is a short hub of groups; each row shows a
// one-line summary and opens its own page. What used to be one long page
// now lives in SyncSettingsScreen (account, sync, this device) and
// PreferenceScreens (appearance, language, voice & entry).
export function SettingsScreen() {
  const store = useStore();
  const { t } = useTranslation();
  const [authAccount] = useAuthAccount();
  const sessionExpired = useSessionExpired();
  const syncStatus = useSyncStatus();
  const online = useOnline();
  const [themeMode] = useThemeMode();
  const { preference: languagePreference, language } = useLanguagePreference();
  const [dollarPreference] = useDollarPreference();
  const install = useInstallPrompt();
  const [showIosInstallSteps, setShowIosInstallSteps] = useState(false);

  const accountCount = store.accounts.filter((a) => !a.archived).length;
  const categoryCount = store.categories.filter((c) => !c.archived).length;
  const scheduleCount = store.scheduledPayments.filter((r) => !r.archived && !r.deletedAt).length;
  const languageLabel = LANGUAGES.find((l) => l.tag === language)?.label ?? language;
  const themeLabel = t(themeMode === 'system' ? 'settings.themeSystem' : themeMode === 'light' ? 'settings.themeLight' : 'settings.themeDark');

  return (
    <main className="home">
      <div className="app-bar">
        <Link to="/" className="back-link">← {t('common.back')}</Link>
        <span className="wordmark">{t('nav.settings')}</span>
        <span style={{ width: '3rem' }} />
      </div>

      {/* The account card is the way into Account & sync, signed in or not. */}
      <div className="settings-group">
        <Link to="/settings/sync" className="settings-hub-row settings-hub-account">
          <span className="settings-hub-avatar" aria-hidden="true">
            {authAccount?.email ? authAccount.email[0].toUpperCase() : <HubIcon name="cloud" />}
          </span>
          <span className="settings-hub-text">
            <span className="settings-hub-title">
              {authAccount ? authAccount.email || t('settings.thisDeviceFallback') : t('settingsHub.syncOffTitle')}
            </span>
            <span className="settings-hub-meta">
              {authAccount ? (
                <>
                  <span className={`settings-hub-dot ${syncStatus.connected && online && !sessionExpired ? 'on' : ''}`} aria-hidden="true" />
                  {connectionLabel(sessionExpired, online, syncStatus)}
                </>
              ) : (
                t('settingsHub.syncOffHint')
              )}
            </span>
          </span>
          <Chevron />
        </Link>
      </div>

      <div className="section-label">{t('settingsHub.yourMoney')}</div>
      <div className="settings-group">
        <HubRow to="/accounts" icon="wallet" label={t('settings.accounts')} meta={String(accountCount)} />
        <HubRow to="/categories" icon="tag" label={t('settings.categories')} meta={String(categoryCount)} />
        <HubRow
          to="/schedules"
          icon="calendar"
          label={t('settings.scheduledPayments')}
          meta={scheduleCount > 0 ? t('settingsHub.activeCount', { count: scheduleCount }) : undefined}
        />
      </div>

      <div className="section-label">{t('settingsHub.syncHousehold')}</div>
      <div className="settings-group">
        {/* docs/71 — people and devices in one place, once signed in. */}
        {authAccount && (
          <HubRow
            to="/settings/household"
            icon="people"
            label={t('settings.household')}
            meta={householdSummary(store.profiles.filter((p) => !p.deletedAt).length, store.devices.length)}
          />
        )}
        <HubRow to="/settings/pair" icon="phone" label={t('settingsHub.connectDevice')} />
      </div>

      <div className="section-label">{t('settingsHub.preferences')}</div>
      <div className="settings-group">
        <HubRow to="/settings/appearance" icon="sun" label={t('settings.appearance')} meta={themeLabel} />
        <HubRow
          to="/settings/language"
          icon="globe"
          label={t('settings.language.title')}
          meta={languagePreference === 'auto' ? t('settings.language.automatic', { language: languageLabel }) : languageLabel}
        />
        <HubRow to="/settings/entry" icon="mic" label={t('settingsHub.voiceEntry')} meta={t('settingsHub.dollarSummary', { code: dollarPreference })} />
      </div>

      <div className="section-label">{t('settings.app')}</div>
      <div className="settings-group">
        {/* docs/56 D201 — only when there's something to do: hidden inside
            the installed app itself and on browsers with no install path. */}
        {install.mode === 'prompt' && (
          <button className="settings-hub-row" onClick={() => void install.install()}>
            <HubIconBox name="download" />
            <span className="settings-hub-text"><span className="settings-hub-title">{t('settings.install')}</span></span>
            <Chevron />
          </button>
        )}
        {install.mode === 'ios-instructions' && (
          <>
            <button className="settings-hub-row" aria-expanded={showIosInstallSteps} onClick={() => setShowIosInstallSteps((v) => !v)}>
              <HubIconBox name="download" />
              <span className="settings-hub-text"><span className="settings-hub-title">{t('settings.addToHome')}</span></span>
              <span className="settings-row-arrow">{showIosInstallSteps ? '⌄' : '›'}</span>
            </button>
            {showIosInstallSteps && (
              <p className="qr-caption install-steps">
                <Trans i18nKey="settings.iosSteps" components={{ icon: <span aria-hidden="true" />, strong: <strong /> }} />
              </p>
            )}
          </>
        )}
        <HubRow to="/about" icon="info" label={t('settings.about')} meta={`v${APP_VERSION}`} />
      </div>
    </main>
  );
}

function HubRow({ to, icon, label, meta }: { to: string; icon: IconName; label: string; meta?: string }) {
  return (
    <Link to={to} className="settings-hub-row">
      <HubIconBox name={icon} />
      <span className="settings-hub-text">
        <span className="settings-hub-title">{label}</span>
      </span>
      {meta && <span className="settings-hub-value">{meta}</span>}
      <Chevron />
    </Link>
  );
}

function Chevron() {
  return (
    <svg className="settings-hub-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

type IconName = 'wallet' | 'tag' | 'calendar' | 'people' | 'phone' | 'sun' | 'globe' | 'mic' | 'info' | 'download' | 'cloud';

const ICON_PATHS: Record<IconName, ReactNode> = {
  wallet: <><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18" /></>,
  tag: <><path d="M3 12V4h8l9 9-8 8z" /><circle cx="7.5" cy="8.5" r="1.2" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  people: <><circle cx="9" cy="8" r="3" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /><circle cx="17" cy="9" r="2.5" /><path d="M16 14.2c2.8.4 5 2.8 5 5.8" /></>,
  phone: <><rect x="7" y="2" width="10" height="20" rx="2" /><path d="M11 18h2" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3z" /></>,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  download: <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />,
  cloud: <path d="M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 9.5 4.3 4.3 0 0 0 7 18z" />,
};

function HubIcon({ name }: { name: IconName }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICON_PATHS[name]}
    </svg>
  );
}

function HubIconBox({ name }: { name: IconName }) {
  return (
    <span className="settings-hub-icon">
      <HubIcon name={name} />
    </span>
  );
}

// "2 people · 3 devices" for the Household row.
function householdSummary(people: number, devices: number): string {
  return `${i18n.t('settings.people', { count: people })} · ${i18n.t('settings.devices', { count: devices })}`;
}

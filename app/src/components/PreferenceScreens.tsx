import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useStore } from '../lib/store';
import { LANGUAGES, uiLocale, useLanguagePreference } from '../lib/i18n';
import { isSpeechInputSupported } from '../lib/speechInput';
import { useVoicePreference } from '../lib/voiceLanguage';
import { useDollarPreference } from '../lib/dollar';
import { ACCOUNT_PICKER_SCALE_THRESHOLD, useAccountPickerMode, useThemeMode } from '../lib/settings';

// docs/79 D310 — the Settings hub's Preferences group, one small page
// each. The controls themselves are unchanged from the old single page.

function SettingsPage({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <main className="home">
      <div className="app-bar">
        <Link to="/settings" className="back-link">← {t('common.back')}</Link>
        <span className="wordmark">{title}</span>
        <span style={{ width: '3rem' }} />
      </div>
      {children}
    </main>
  );
}

export function AppearanceScreen() {
  const { t } = useTranslation();
  const [themeMode, setThemeMode] = useThemeMode();
  return (
    <SettingsPage title={t('settings.appearance')}>
      <div className="section-label">{t('settings.appearance')}</div>
      <div className="chip-row settings-chip-row">
        {(['system', 'light', 'dark'] as const).map((mode) => (
          <button key={mode} className={`chip ${themeMode === mode ? 'picked' : ''}`} onClick={() => setThemeMode(mode)}>
            {t(mode === 'system' ? 'settings.themeSystem' : mode === 'light' ? 'settings.themeLight' : 'settings.themeDark')}
          </button>
        ))}
      </div>
    </SettingsPage>
  );
}

// docs/73 D262 — per device, never synced. Language names are endonyms,
// so they stay readable whatever is picked.
export function LanguageScreen() {
  const { t } = useTranslation();
  const { preference, automaticLanguage, setPreference } = useLanguagePreference();
  return (
    <SettingsPage title={t('settings.language.title')}>
      <div className="section-label">{t('settings.language.title')}</div>
      <div className="chip-row settings-chip-row">
        <button className={`chip ${preference === 'auto' ? 'picked' : ''}`} onClick={() => setPreference('auto')}>
          {t('settings.language.automatic', { language: LANGUAGES.find((l) => l.tag === automaticLanguage)?.label })}
        </button>
        {LANGUAGES.map((l) => (
          <button key={l.tag} lang={l.tag} className={`chip ${preference === l.tag ? 'picked' : ''}`} onClick={() => setPreference(l.tag)}>
            {l.label}
          </button>
        ))}
      </div>
    </SettingsPage>
  );
}

export function EntrySettingsScreen() {
  const store = useStore();
  const { t } = useTranslation();
  const { language } = useLanguagePreference();
  const [voicePreference, setVoicePreference] = useVoicePreference();
  const [dollarPreference, setDollarPreference] = useDollarPreference();
  const [pickerMode, setPickerMode] = useAccountPickerMode();
  const currencyNames = new Intl.DisplayNames([uiLocale()], { type: 'currency' });
  // docs/13 D69 — only surface this once it'd actually do something,
  // rather than a control that's a no-op below the threshold.
  const showPickerModeSetting = store.accounts.filter((a) => !a.archived).length > ACCOUNT_PICKER_SCALE_THRESHOLD;

  return (
    <SettingsPage title={t('settingsHub.voiceEntry')}>
      {/* docs/73 D268 — what voice entry listens for; often not the app's
          language. Hidden where there's no voice entry at all. */}
      {isSpeechInputSupported() && (
        <>
          <div className="section-label">{t('settings.voiceLanguage')}</div>
          <div className="chip-row settings-chip-row">
            <button className={`chip ${voicePreference === 'app' ? 'picked' : ''}`} onClick={() => setVoicePreference('app')}>
              {t('settings.voiceSameAsApp', { language: LANGUAGES.find((l) => l.tag === language)?.label })}
            </button>
            {LANGUAGES.map((l) => (
              <button
                key={l.tag}
                lang={l.tag}
                className={`chip ${voicePreference === l.tag ? 'picked' : ''}`}
                onClick={() => setVoicePreference(l.tag)}
              >
                {l.label}
              </button>
            ))}
          </div>
        </>
      )}

      {/* docs/73 D272 — what "dollars" / "$" means when no country is said. */}
      <div className="section-label">{t('settings.dollarMeans')}</div>
      <div className="settings-row settings-row-static">
        <span>{t('settings.dollarHint')}</span>
      </div>
      <div className="chip-row settings-chip-row">
        {(['CAD', 'USD'] as const).map((code) => (
          <button key={code} className={`chip ${dollarPreference === code ? 'picked' : ''}`} onClick={() => setDollarPreference(code)}>
            {currencyNames.of(code)} ({code})
          </button>
        ))}
      </div>

      {showPickerModeSetting && (
        <>
          <div className="section-label">{t('settings.accountPicker')}</div>
          <div className="settings-row settings-row-static">
            <span>{t('settings.accountPickerHint')}</span>
          </div>
          <div className="chip-row settings-chip-row">
            <button className={`chip ${pickerMode === 'grouped' ? 'picked' : ''}`} onClick={() => setPickerMode('grouped')}>
              {t('settings.groupedByInstitution')}
            </button>
            <button className={`chip ${pickerMode === 'capped' ? 'picked' : ''}`} onClick={() => setPickerMode('capped')}>
              {t('settings.mostUsed')}
            </button>
          </div>
        </>
      )}
    </SettingsPage>
  );
}

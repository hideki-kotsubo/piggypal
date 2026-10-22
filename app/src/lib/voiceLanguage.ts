import { useState } from 'react';
import i18n, { LANGUAGES, type Language } from './i18n';

// docs/73 D268 — the language voice entry listens for. Separate from the
// UI language because people often run the app in one language and speak
// in another; "Same as app" is the default. Per device, never synced.
export type VoicePreference = 'app' | Language;

const VOICE_KEY = 'flowtab:voice-language';

function readVoicePreference(): VoicePreference {
  try {
    const stored = localStorage.getItem(VOICE_KEY);
    if (stored && LANGUAGES.some((l) => l.tag === stored)) return stored as Language;
  } catch {
    // No storage — same as app.
  }
  return 'app';
}

export function voiceLanguage(preference: VoicePreference = readVoicePreference()): Language {
  return preference === 'app' ? (i18n.language as Language) : preference;
}

// Recognizers want a concrete region and don't reliably accept es-419.
// A variant picked by region (pt-BR, es-ES, fr-CA) is sent exactly; a base
// language takes the device's region when it speaks that language, unless
// that region is the other variant (a Spain-Spanish phone with
// "Latinoamérica" picked still gets a Latin American recognizer).
const DEFAULT_SPEECH_TAG: Record<Language, string> = {
  en: 'en-US',
  'pt-BR': 'pt-BR',
  es: 'es-MX',
  'es-ES': 'es-ES',
  fr: 'fr-FR',
  'fr-CA': 'fr-CA',
  ja: 'ja-JP',
  ko: 'ko-KR',
  // Always Mandarin: a Hong Kong device's own zh-HK selects Cantonese
  // recognition (docs/76), so the script tags send fixed regions.
  'zh-Hans': 'zh-CN',
  'zh-Hant': 'zh-TW',
};
const OTHER_VARIANT: Partial<Record<Language, string>> = { es: 'es-es', fr: 'fr-ca' };

export function speechTagFor(language: Language, deviceLanguages: readonly string[]): string {
  if (language.includes('-')) return DEFAULT_SPEECH_TAG[language];
  const device = deviceLanguages.find(
    (d) => d.includes('-') && d.toLowerCase().split('-')[0] === language && d.toLowerCase() !== OTHER_VARIANT[language],
  );
  return device ?? DEFAULT_SPEECH_TAG[language];
}

export function currentSpeechTag(): string {
  const device = typeof navigator === 'undefined' ? [] : navigator.languages?.length ? navigator.languages : [navigator.language];
  return speechTagFor(voiceLanguage(), device);
}

export function useVoicePreference(): [VoicePreference, (next: VoicePreference) => void] {
  const [preference, setPreferenceState] = useState<VoicePreference>(readVoicePreference);
  function setPreference(next: VoicePreference) {
    try {
      if (next === 'app') localStorage.removeItem(VOICE_KEY);
      else localStorage.setItem(VOICE_KEY, next);
    } catch {
      // Applies for this session even if it can't be saved.
    }
    setPreferenceState(next);
  }
  return [preference, setPreference];
}

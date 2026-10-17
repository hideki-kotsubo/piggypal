import { useState } from 'react';
import i18n from 'i18next';
import { initReactI18next, useTranslation } from 'react-i18next';
import en from '../locales/en.json';
import ptBR from '../locales/pt-BR.json';
import es from '../locales/es.json';
import esES from '../locales/es-ES.json';
import fr from '../locales/fr.json';
import frCA from '../locales/fr-CA.json';

// docs/73 — UI languages. Regional files (es-ES, fr-CA) hold only the
// strings that differ from their base; i18next falls back along
// es-ES → es → en on its own (D261). Labels are endonyms, never translated.
export const LANGUAGES = [
  { tag: 'en', label: 'English' },
  { tag: 'pt-BR', label: 'Português (Brasil)' },
  { tag: 'es', label: 'Español (Latinoamérica)' },
  { tag: 'es-ES', label: 'Español (España)' },
  { tag: 'fr', label: 'Français (France)' },
  { tag: 'fr-CA', label: 'Français (Canada)' },
] as const;

export type Language = (typeof LANGUAGES)[number]['tag'];
export type LanguagePreference = 'auto' | Language;

export const resources = {
  en: { translation: en },
  'pt-BR': { translation: ptBR },
  es: { translation: es },
  'es-ES': { translation: esES },
  fr: { translation: fr },
  'fr-CA': { translation: frCA },
} as const;

function primary(tag: string): string {
  return tag.toLowerCase().split('-')[0];
}

// D262 — "Automatic" walks the device's preferred languages in order and
// takes the first one we can serve. Exact regional matches win (es-ES,
// fr-CA); any other region of a supported language gets its base (pt-PT →
// pt-BR, es-AR → es, fr-BE → fr).
export function resolveLanguage(deviceLanguages: readonly string[]): Language {
  for (const device of deviceLanguages) {
    const exact = LANGUAGES.find((l) => l.tag.toLowerCase() === device.toLowerCase());
    if (exact) return exact.tag;
    switch (primary(device)) {
      case 'en':
        return 'en';
      case 'pt':
        return 'pt-BR';
      case 'es':
        return 'es';
      case 'fr':
        return 'fr';
    }
  }
  return 'en';
}

// D265 — Intl formatting follows the UI language, but takes the device's
// region when the device speaks the same language (UI `es` on an `es-AR`
// phone formats as es-AR). Otherwise a per-language default; en-CA keeps
// what format.ts hardcoded before this doc.
const DEFAULT_FORMAT_LOCALE: Record<Language, string> = {
  en: 'en-CA',
  'pt-BR': 'pt-BR',
  es: 'es-419',
  'es-ES': 'es-ES',
  fr: 'fr-FR',
  'fr-CA': 'fr-CA',
};

export function formatLocaleFor(language: Language, deviceLanguages: readonly string[]): string {
  const sameLanguage = deviceLanguages.find((d) => primary(d) === primary(language) && d.includes('-'));
  return sameLanguage ?? DEFAULT_FORMAT_LOCALE[language];
}

const LANGUAGE_KEY = 'flowtab:language';

function deviceLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return [];
  return navigator.languages?.length ? navigator.languages : [navigator.language];
}

// Per-device, never synced (D262, docs/09 D32), same plain-localStorage
// home as settings.ts's other device preferences.
function readPreference(): LanguagePreference {
  try {
    const stored = localStorage.getItem(LANGUAGE_KEY);
    if (stored && LANGUAGES.some((l) => l.tag === stored)) return stored as Language;
  } catch {
    // No storage (Node tests, locked-down browser) — fall through to auto.
  }
  return 'auto';
}

function languageFor(preference: LanguagePreference): Language {
  return preference === 'auto' ? resolveLanguage(deviceLanguages()) : preference;
}

let formatLocale = formatLocaleFor(languageFor(readPreference()), deviceLanguages());

// What format.ts hands to Intl.
export function uiLocale(): string {
  return formatLocale;
}

function applyLanguage(language: Language) {
  formatLocale = formatLocaleFor(language, deviceLanguages());
  if (typeof document !== 'undefined') document.documentElement.lang = language;
  void i18n.changeLanguage(language);
}

// Bundled, not lazy-loaded (D263): offline-first, and init is synchronous
// with inline resources, so the first paint is already in the right
// language. Missing keys fall back to English.
void i18n.use(initReactI18next).init({
  resources,
  lng: languageFor(readPreference()),
  fallbackLng: 'en',
  interpolation: { escapeValue: false }, // React already escapes
});
if (typeof document !== 'undefined') document.documentElement.lang = i18n.language;

export function useLanguagePreference(): {
  preference: LanguagePreference;
  language: Language;
  automaticLanguage: Language;
  setPreference: (next: LanguagePreference) => void;
} {
  // useTranslation subscribes this component to language changes; the
  // preference itself is state too, since Automatic → English on an
  // English device changes the picked chip but not the language.
  const { i18n: instance } = useTranslation();
  const [preference, setPreferenceState] = useState<LanguagePreference>(readPreference);
  function setPreference(next: LanguagePreference) {
    try {
      if (next === 'auto') localStorage.removeItem(LANGUAGE_KEY);
      else localStorage.setItem(LANGUAGE_KEY, next);
    } catch {
      // Applies for this session even if it can't be saved.
    }
    setPreferenceState(next);
    applyLanguage(languageFor(next));
  }
  return {
    preference,
    language: instance.language as Language,
    automaticLanguage: resolveLanguage(deviceLanguages()),
    setPreference,
  };
}

export default i18n;

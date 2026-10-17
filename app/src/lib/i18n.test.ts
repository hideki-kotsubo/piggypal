import { describe, expect, it } from 'vitest';
import i18n, { formatLocaleFor, resolveLanguage, resources, type Language } from './i18n';

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([k, v]) =>
    typeof v === 'string' ? [`${prefix}${k}`] : flatten(v, `${prefix}${k}.`),
  );
}

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

// Plural keys collapse to their base ("date.daysAgo_one" → "date.daysAgo"),
// since each language needs a different set of suffixes.
function baseKeys(lang: Language): Set<string> {
  return new Set(flatten(resources[lang].translation as Tree).map((k) => k.replace(PLURAL_SUFFIX, '')));
}

const BASE_LANGUAGES = ['pt-BR', 'es', 'fr'] as const satisfies Language[];
const REGIONAL_LANGUAGES = ['es-ES', 'fr-CA'] as const satisfies Language[];
const enKeys = baseKeys('en');

// docs/73 D264
describe('locale key parity', () => {
  for (const lang of BASE_LANGUAGES) {
    it(`${lang} has exactly the keys en.json has`, () => {
      const keys = baseKeys(lang);
      expect([...enKeys].filter((k) => !keys.has(k)), 'missing').toEqual([]);
      expect([...keys].filter((k) => !enKeys.has(k)), 'extra').toEqual([]);
    });
  }

  for (const lang of REGIONAL_LANGUAGES) {
    it(`${lang} only overrides keys en.json has`, () => {
      expect([...baseKeys(lang)].filter((k) => !enKeys.has(k))).toEqual([]);
    });
  }

  for (const lang of ['en', ...BASE_LANGUAGES] as const) {
    it(`${lang} has every plural form its language needs`, () => {
      const flat = flatten(resources[lang].translation as Tree);
      const pluralBases = new Set(flat.filter((k) => PLURAL_SUFFIX.test(k)).map((k) => k.replace(PLURAL_SUFFIX, '')));
      const categories = new Intl.PluralRules(lang).resolvedOptions().pluralCategories;
      const missing = [...pluralBases].flatMap((base) =>
        categories.filter((c) => !flat.includes(`${base}_${c}`)).map((c) => `${base}_${c}`),
      );
      expect(missing).toEqual([]);
    });
  }
});

describe('resolveLanguage', () => {
  it('takes exact regional matches', () => {
    expect(resolveLanguage(['es-ES'])).toBe('es-ES');
    expect(resolveLanguage(['fr-CA'])).toBe('fr-CA');
    expect(resolveLanguage(['pt-BR'])).toBe('pt-BR');
  });

  it('maps other regions to the base language', () => {
    expect(resolveLanguage(['pt-PT'])).toBe('pt-BR');
    expect(resolveLanguage(['es-AR'])).toBe('es');
    expect(resolveLanguage(['es'])).toBe('es');
    expect(resolveLanguage(['fr-BE'])).toBe('fr');
    expect(resolveLanguage(['en-GB'])).toBe('en');
  });

  it('walks the preference list and falls back to English', () => {
    expect(resolveLanguage(['ja-JP', 'fr-CA', 'en-US'])).toBe('fr-CA');
    expect(resolveLanguage(['ja-JP', 'de-DE'])).toBe('en');
    expect(resolveLanguage([])).toBe('en');
  });
});

// docs/73 D265
describe('formatLocaleFor', () => {
  it("uses the device's region when it speaks the same language", () => {
    expect(formatLocaleFor('es', ['es-AR'])).toBe('es-AR');
    expect(formatLocaleFor('en', ['pt-BR', 'en-GB'])).toBe('en-GB');
  });

  it('otherwise uses the language default', () => {
    expect(formatLocaleFor('pt-BR', ['en-CA'])).toBe('pt-BR');
    expect(formatLocaleFor('es', ['en-CA'])).toBe('es-419');
    expect(formatLocaleFor('fr', ['fr'])).toBe('fr-FR');
    expect(formatLocaleFor('en', [])).toBe('en-CA');
  });
});

describe('fallback', () => {
  it('regional files fall back to their base language, then English', async () => {
    const t = i18n.getFixedT('fr-CA');
    expect(t('settings.language.title')).toBe('Langue');
    await i18n.changeLanguage('fr');
    expect(i18n.t('date.daysAgo', { count: 3 })).toBe('il y a 3 jours');
    expect(i18n.t('date.daysAgo', { count: 1 })).toBe('il y a 1 jour');
    await i18n.changeLanguage('en');
  });
});

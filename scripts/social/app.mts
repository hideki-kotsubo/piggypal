// docs/74 — driving the real app for screenshots.mts and videos.mts: the
// entries each language types, and its device settings.
import type { Page } from 'playwright';
import type { Language } from './languages.mts';

// Everyday entries, written the way a person would type them. Kept to
// phrases the parser categorizes, so the screenshots show a tidy list
// instead of an inbox full of "Uncategorized". The first one is also the
// phrase shown in the "Understood" panel shot.
export const ENTRIES: Record<Language, string[]> = {
  en: ['groceries 86.20 at costco', 'coffee 4.50', 'uber 18 yesterday', 'gas 62', 'dinner 48', 'movies 15.90'],
  'pt-BR': ['mercado 86,20 no carrefour', 'café 4,50', 'uber 18 ontem', 'gasolina 62', 'jantar 48', 'cinema R$ 15,90'],
  es: ['supermercado 86.20 en walmart', 'café 4.50', 'uber 18 ayer', 'gasolina 62', 'cena 48', 'cine 15.90'],
  fr: ['épicerie 86,20 chez iga', 'café 4,50', 'uber 18 hier', 'essence 62', 'souper 48', 'cinéma 15,90'],
};

// Entries are saved last-to-first, so the last phrase sets the currency
// the others default to (a fresh install starts in CAD, store.tsx); pt-BR
// says "R$" there so its shots show reais. Amounts avoid "99": the starter
// keyword for the 99 ride app also matches inside "16.99".
//
// Per language: the app language to store, and the browser locale and
// timezone (number/date format). fr is Canadian French, matching "souper".
export const DEVICE: Record<Language, { tag: string; locale: string; timezoneId: string }> = {
  en: { tag: 'en', locale: 'en-CA', timezoneId: 'America/Vancouver' },
  'pt-BR': { tag: 'pt-BR', locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' },
  es: { tag: 'es', locale: 'es-MX', timezoneId: 'America/Mexico_City' },
  fr: { tag: 'fr-CA', locale: 'fr-CA', timezoneId: 'America/Toronto' },
};

export async function settle(page: Page) {
  // Not 'networkidle': Vite's dev server keeps a socket open.
  await page.locator('main').first().waitFor();
  await page.waitForTimeout(800);
}

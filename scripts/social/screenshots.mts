// docs/74 — localized app screenshots for social posts and the store
// listings. Each language gets a fresh browser profile (its own OPFS, so a
// clean install), types a handful of everyday entries in that language
// through the real on-device parser, and captures the same screens.
//
//   npm run social:screenshots                         all languages, against :3001
//   npm run social:screenshots -- --url http://localhost:3011 --lang pt-BR
//   npm run social:screenshots -- --size store         440×956 @3x (App Store 6.9")
//
// Writes marketing/out/screenshots/<lang>/<screen>.png (git-ignored).
// Run it on a Mac: the app uses system fonts (Charter, SF), so a Linux run
// renders fallbacks and is only good for checking the flow.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright';
import { LANGUAGES, type Language } from './languages.mts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const SIZES = {
  social: { width: 390, height: 844, scale: 3 }, // 1170×2532, cropped to 4:5 / 9:16 by compose
  store: { width: 440, height: 956, scale: 3 }, // 1320×2868, App Store 6.9" / Play phone
} as const;

// Everyday entries, written the way a person would type them. Kept to
// phrases the parser categorizes, so the screenshots show a tidy list
// instead of an inbox full of "Uncategorized". The first one is also the
// phrase shown in the "Understood" panel shot.
const ENTRIES: Record<Language, string[]> = {
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
const DEVICE: Record<Language, { tag: string; locale: string; timezoneId: string }> = {
  en: { tag: 'en', locale: 'en-CA', timezoneId: 'America/Vancouver' },
  'pt-BR': { tag: 'pt-BR', locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' },
  es: { tag: 'es', locale: 'es-MX', timezoneId: 'America/Mexico_City' },
  fr: { tag: 'fr-CA', locale: 'fr-CA', timezoneId: 'America/Toronto' },
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const baseUrl = arg('url') ?? 'http://localhost:3001';
const size = SIZES[(arg('size') as keyof typeof SIZES) ?? 'social'];
if (!size) throw new Error('--size must be social or store');
const only = arg('lang') as Language | undefined;
const theme = arg('theme') ?? 'light';
const langs = only ? [only] : LANGUAGES;

async function settle(page: Page) {
  // Not 'networkidle': Vite's dev server keeps a socket open.
  await page.locator('main').first().waitFor();
  await page.waitForTimeout(800);
}

async function typeEntry(page: Page, text: string) {
  const input = page.locator('.entry-zone-dock input[type="text"], .entry-zone-dock input:not([type])').first();
  await input.fill(text);
  await input.press('Enter'); // shows the "Understood" preview (docs/22)
  await page.locator('.parse-confirm').waitFor({ timeout: 5000 });
}

async function addEntry(page: Page, text: string) {
  await typeEntry(page, text);
  await page.locator('.parse-confirm').click();
  await page.waitForTimeout(500);
}

const browser = await chromium.launch();
try {
  for (const lang of langs) {
    const dir = path.join(root, 'marketing/out/screenshots', lang);
    mkdirSync(dir, { recursive: true });
    const ctx = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: size.scale,
      locale: DEVICE[lang].locale,
      timezoneId: DEVICE[lang].timezoneId,
      colorScheme: theme === 'dark' ? 'dark' : 'light',
    });
    await ctx.addInitScript((tag) => localStorage.setItem('flowtab:language', tag), DEVICE[lang].tag);
    const page = await ctx.newPage();
    const shot = (name: string) => page.screenshot({ path: path.join(dir, `${name}.png`) });

    await page.goto(baseUrl);
    await settle(page);
    await shot('01-empty');

    const [first, ...rest] = ENTRIES[lang];
    for (const text of [...rest].reverse()) await addEntry(page, text);
    await typeEntry(page, first);
    await shot('02-understood');
    await page.locator('.parse-confirm').click();
    await page.waitForTimeout(5500); // the "Added" toast stays 5 s (App.tsx)
    await shot('03-home');

    for (const [name, route] of [
      ['04-transactions', '/transactions'],
      ['05-insights', '/insights'],
      ['06-accounts', '/accounts'],
      ['07-settings', '/settings'],
    ] as const) {
      await page.goto(new URL(route, baseUrl).href);
      await settle(page);
      await shot(name);
    }
    await ctx.close();
    console.log(`${lang}: ${path.relative(root, dir)}`);
  }
} finally {
  await browser.close();
}

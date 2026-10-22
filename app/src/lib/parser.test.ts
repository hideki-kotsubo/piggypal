import { describe, expect, it } from 'vitest';
import { parseUtterance, type ParserContext } from './parser';
import { seedCategories, seedCategoryKeywords } from './seed';
import { starterAccountAliases, starterCategoryAliases } from './starterLabels';
import type { Account, Category } from './types';

// Friday, 16 October 2026, 10:00 local.
const NOW = new Date(2026, 9, 16, 10, 0, 0);

const categories: Category[] = seedCategories.map((c) => ({ ...c, updatedAt: '2026-01-01T00:00:00.000Z' }));
const accounts: Account[] = [
  { id: 'acc-cash', institution: null, name: 'Cash', kind: 'cash', archived: false, ownerUserId: null, updatedAt: '' },
  { id: 'acc-checking', institution: null, name: 'Checking', kind: 'checking', archived: false, ownerUserId: null, updatedAt: '' },
  { id: 'acc-visa', institution: 'TD', name: 'Visa', kind: 'credit', archived: false, ownerUserId: null, updatedAt: '' },
];

function parse(text: string, language?: string, overrides: Partial<ParserContext> = {}) {
  return parseUtterance(text, {
    categories,
    keywords: seedCategoryKeywords,
    accounts,
    merchants: [],
    now: NOW,
    language,
    categoryAliases: starterCategoryAliases(categories),
    accountAliases: starterAccountAliases(accounts),
    ...overrides,
  });
}

const day = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T10:00:00`;

describe('English', () => {
  it('reads amount, category and relative date', () => {
    const r = parse('12 coffee yesterday', 'en');
    expect(r.amountCents).toBe(1200);
    expect(r.categoryId).toBe('cat-food-coffee');
    expect(r.occurredAt).toBe(day(2026, 10, 15));
    expect(r.unrecognized).toBeNull();
  });

  it('reads spelled-out numbers, last <weekday> and month dates', () => {
    expect(parse('forty five groceries', 'en').amountCents).toBe(4500);
    expect(parse('20 uber last monday', 'en').occurredAt).toBe(day(2026, 10, 12));
    expect(parse('sept 16 5 coffee', 'en').occurredAt).toBe(day(2026, 9, 16));
    expect(parse('got paid 2000', 'en').direction).toBe('income');
  });
});

describe('Portuguese', () => {
  it('reads the docs/16 examples', () => {
    const r = parse('45 mercado ontem', 'pt-BR');
    expect(r.amountCents).toBe(4500);
    expect(r.categoryId).toBe('cat-food-groceries');
    expect(r.occurredAt).toBe(day(2026, 10, 15));
    expect(parse('quarenta e cinco no mercado', 'pt-BR').amountCents).toBe(4500);
    expect(parse('R$ 30 uber', 'pt-BR').currency).toBe('BRL');
    expect(parse('16 de agosto de 2026, 45 no mercado', 'pt-BR').occurredAt).toBe(day(2026, 8, 16));
    expect(parse('20 farmácia anteontem', 'pt-BR').occurredAt).toBe(day(2026, 10, 14));
  });

  it('pays with the starter Cash account by its Portuguese name', () => {
    expect(parse('30 almoço em dinheiro', 'pt-BR').accountId).toBe('acc-cash');
  });

  it('keeps "no <Merchant>" as a merchant guess', () => {
    const r = parse('20 no Walmart', 'pt-BR');
    expect(r.merchant).toBe('Walmart');
    expect(r.merchantGuessed).toBe(true);
  });

  it('reads iOS dictation\'s bare "$" as dollars, for speech only', () => {
    // iOS Portuguese dictation: "cem dólares em combustível" -> "$100 em combustivel".
    const spoken = parse('$100 em combustivel', 'pt-BR', { fromSpeech: true });
    expect(spoken.amountCents).toBe(10000);
    expect(spoken.currency).toBe('USD');
    expect(spoken.categoryId).toBe('cat-transport-fuel');
    expect(spoken.unrecognized).toBeNull();
    expect(parse('R$ 30 em mercado', 'pt-BR', { fromSpeech: true }).currency).toBe('BRL');
    expect(parse('$100 em combustivel', 'pt-BR').currency).toBeNull();
    expect(parse('$100 gas', 'en', { fromSpeech: true }).currency).toBeNull();
    expect(parse('$100 gasolina', 'es', { fromSpeech: true }).currency).toBeNull();
  });

  it('never reads "dos" as Spanish two', () => {
    expect(parse('almoço dos meninos quarenta', 'pt-BR').amountCents).toBe(4000);
  });
});

describe('Spanish', () => {
  it('reads amount, category and date words', () => {
    const r = parse('45 supermercado ayer', 'es');
    expect(r.amountCents).toBe(4500);
    expect(r.categoryId).toBe('cat-food-groceries');
    expect(r.occurredAt).toBe(day(2026, 10, 15));
    expect(parse('30 farmacia anteayer', 'es').occurredAt).toBe(day(2026, 10, 14));
    expect(parse('30 farmacia antes de ayer', 'es-ES').occurredAt).toBe(day(2026, 10, 14));
  });

  it('reads Spanish numbers, including articles', () => {
    expect(parse('treinta y cinco en el súper', 'es').amountCents).toBe(3500);
    expect(parse('veintidós gasolina', 'es').amountCents).toBe(2200);
    expect(parse('un café cinco', 'es').amountCents).toBe(500);
    const r = parse('veinte dólares gasolina', 'es');
    expect(r.amountCents).toBe(2000);
    expect(r.currency).toBe('USD');
    expect(r.categoryId).toBe('cat-transport-fuel');
  });

  it('reads "el lunes pasado" and "15 de marzo"', () => {
    expect(parse('12 café el lunes pasado', 'es').occurredAt).toBe(day(2026, 10, 12));
    expect(parse('15 de marzo 30 farmacia', 'es').occurredAt).toBe(day(2026, 3, 15));
  });

  it('reads income', () => {
    const r = parse('recibí 2000 de sueldo', 'es');
    expect(r.direction).toBe('income');
    expect(r.categoryId).toBe('cat-salary');
  });

  it('guesses a merchant after "en", and never treats "no" as a connector', () => {
    expect(parse('20 en Walmart', 'es').merchant).toBe('Walmart');
    const r = parse('no Costco, 20 farmacia', 'es');
    expect(r.merchant).toBeNull();
    expect(r.categoryId).toBe('cat-health-pharmacy');
  });

  it('finds the starter Cash account as "efectivo"', () => {
    expect(parse('15 taxi en efectivo', 'es').accountId).toBe('acc-cash');
  });
});

describe('French', () => {
  it('reads amount, category and date words', () => {
    const r = parse('12 café hier', 'fr');
    expect(r.amountCents).toBe(1200);
    expect(r.categoryId).toBe('cat-food-coffee');
    expect(r.occurredAt).toBe(day(2026, 10, 15));
    expect(parse('20 resto avant-hier', 'fr').occurredAt).toBe(day(2026, 10, 14));
    expect(parse("20 resto aujourd'hui", 'fr').occurredAt).toBe(day(2026, 10, 16));
    expect(parse('20 resto lundi dernier', 'fr').occurredAt).toBe(day(2026, 10, 12));
  });

  it('reads French numbers', () => {
    const r = parse('trente-cinq euros courses', 'fr');
    expect(r.amountCents).toBe(3500);
    expect(r.currency).toBe('EUR');
    expect(r.categoryId).toBe('cat-food-groceries');
    expect(parse('dix-sept pharmacie', 'fr').amountCents).toBe(1700);
    expect(parse('vingt et un taxi', 'fr').amountCents).toBe(2100);
    expect(parse('soixante-dix essence', 'fr').amountCents).toBe(7000);
    expect(parse('soixante-quinze essence', 'fr').amountCents).toBe(7500);
    expect(parse('quatre-vingt-dix essence', 'fr').amountCents).toBe(9000);
    expect(parse('quatre-vingts essence', 'fr').amountCents).toBe(8000);
  });

  it('reads "sept" as seven, not September', () => {
    const r = parse('sept euros café', 'fr');
    expect(r.amountCents).toBe(700);
    expect(r.occurredAt).toBeNull();
  });

  it('reads "16 août" and "le 1er mai" dates', () => {
    const r = parse('16 août 40 essence', 'fr-CA');
    expect(r.occurredAt).toBe(day(2026, 8, 16));
    expect(r.amountCents).toBe(4000);
    expect(parse('le 1er mai 12 café', 'fr').occurredAt).toBe(day(2026, 5, 1));
  });

  it('guesses a merchant after "chez"', () => {
    expect(parse('25 chez Carrefour', 'fr').merchant).toBe('Carrefour');
  });

  it('finds starter categories by their French names', () => {
    expect(parse('45 épicerie', 'fr-CA').categoryId).toBe('cat-food-groceries');
    expect(parse('60 stationnement', 'fr-CA').categoryId).toBe('cat-transport-parking');
  });

  it('reads income', () => {
    expect(parse('salaire 3000', 'fr').direction).toBe('income');
  });
});

// docs/73 D272 — real report: "15 dollars in ice cream" with voice in
// English saved as R$ 15.
describe('dollars', () => {
  it('flags "dollars" and a bare "$" as some dollar, for the caller to resolve', () => {
    for (const [text, lang, fromSpeech] of [
      ['15 dollars in ice cream', 'en', true],
      ['$15 in ice cream', 'en', true],
      ['$15 ice cream', 'pt-BR', false],
      ['15 bucks coffee', 'en', false],
      ['15 dollars café', 'fr-CA', true],
      ['15 $ café', 'fr-CA', false],
    ] as const) {
      const r = parse(text, lang, { fromSpeech });
      expect(r.currency, text).toBeNull();
      expect(r.dollarFamily, text).toBe(true);
      expect(r.unrecognized ?? '', text).not.toMatch(/dollar|bucks|\$/);
    }
  });

  it('reads country-qualified dollars exactly', () => {
    expect(parse('20 canadian dollars coffee', 'en').currency).toBe('CAD');
    expect(parse('20 US dollars coffee', 'en').currency).toBe('USD');
    expect(parse('20 american dollars coffee', 'en').currency).toBe('USD');
    expect(parse('20 dólares canadenses café', 'pt-BR').currency).toBe('CAD');
    expect(parse('20 dólares canadienses café', 'es').currency).toBe('CAD');
    expect(parse('20 dollars canadiens café', 'fr').currency).toBe('CAD');
    expect(parse('20 dollars américains café', 'fr').currency).toBe('USD');
    const r = parse('20 dólares café', 'pt-BR');
    expect(r.currency).toBe('USD');
    expect(r.dollarFamily).toBe(false);
  });

  it('leaves a bare "$" alone in Spanish, where it is often pesos', () => {
    const r = parse('$150 helado', 'es', { fromSpeech: true });
    expect(r.currency).toBeNull();
    expect(r.dollarFamily).toBe(false);
  });

  it('files ice cream under Snacks in every language', () => {
    expect(parse('15 dollars in ice cream', 'en').categoryId).toBe('cat-food-snacks');
    expect(parse('15 sorvete', 'pt-BR').categoryId).toBe('cat-food-snacks');
    expect(parse('15 helado', 'es').categoryId).toBe('cat-food-snacks');
    expect(parse('15 crème glacée', 'fr-CA').categoryId).toBe('cat-food-snacks');
  });
});

// Real report, 2026-10-16: an account whose name was cleared ("Cash —")
// matched every entry.
describe('empty names', () => {
  it('never match', () => {
    const blank: Account = { id: 'acc-blank', institution: 'Cash', name: '', kind: 'cash', archived: false, ownerUserId: null, updatedAt: '' };
    const r = parse('15 coffee', 'en', {
      accounts: [blank],
      accountAliases: [],
      categories: [...categories, { ...categories[0], id: 'cat-blank', name: '', parentId: null }],
      merchants: ['', '  '],
    });
    expect(r.accountId).toBeNull();
    expect(r.categoryId).toBe('cat-food-coffee');
    expect(r.merchant).toBeNull();
  });
});

// docs/76 step 2. NOW is Friday 16 Oct 2026, 10:00.
describe('Japanese', () => {
  it('reads amount, currency, category and date with no spaces', () => {
    const r = parse('昨日コーヒー500円', 'ja');
    expect(r.amountCents).toBe(50000);
    expect(r.currency).toBe('JPY');
    expect(r.categoryId).toBe('cat-food-coffee');
    expect(r.occurredAt).toBe(day(2026, 10, 15));
    expect(r.unrecognized).toBeNull();
  });

  it('reads 万/千 amounts, mixed digits and full-width digits', () => {
    expect(parse('3万円 家賃', 'ja').amountCents).toBe(3_000_000);
    expect(parse('家賃3万円', 'ja').categoryId).toBe('cat-housing-rent');
    expect(parse('1万5千円 電気代', 'ja').amountCents).toBe(1_500_000);
    expect(parse('千五百円のランチ', 'ja').amountCents).toBe(150_000);
    expect(parse('1.5万円 ガソリン', 'ja').amountCents).toBe(1_500_000);
    expect(parse('1,500円 ランチ', 'ja').amountCents).toBe(150_000);
    expect(parse('１５００円 ランチ', 'ja').amountCents).toBe(150_000);
    expect(parse('ランチ 1200', 'ja').amountCents).toBe(120_000);
  });

  it("doesn't read numeral-bearing words as amounts", () => {
    const r = parse('一緒にランチ 1200円', 'ja');
    expect(r.amountCents).toBe(120_000);
  });

  it('reads relative dates, weekdays and 先週', () => {
    expect(parse('一昨日 タクシー 2800円', 'ja').occurredAt).toBe(day(2026, 10, 14));
    expect(parse('おととい タクシー 2800円', 'ja').occurredAt).toBe(day(2026, 10, 14));
    expect(parse('今日 ランチ 900円', 'ja').occurredAt).toBe(day(2026, 10, 16));
    expect(parse('水曜日 ラーメン 900円', 'ja').occurredAt).toBe(day(2026, 10, 14));
    // The previous calendar week's Monday, not this week's.
    expect(parse('先週の月曜 映画 1800円', 'ja').occurredAt).toBe(day(2026, 10, 5));
  });

  it('reads 8月16日 and 2026年3月15日 dates, and times', () => {
    const r = parse('8月16日 ガソリン 5000円', 'ja');
    expect(r.occurredAt).toBe(day(2026, 8, 16));
    expect(r.amountCents).toBe(500_000);
    expect(r.categoryId).toBe('cat-transport-fuel');
    expect(parse('2025年3月15日 薬局 800円', 'ja').occurredAt).toBe('2025-03-15T10:00:00');
    expect(parse('午後3時半 カフェ 500円', 'ja').occurredAt).toBe('2026-10-16T15:30:00');
    expect(parse('15時10分 カフェ 500円', 'ja').occurredAt).toBe('2026-10-16T15:10:00');
    // 3時間 is a duration, not a time.
    expect(parse('駐車場 3時間 600円', 'ja').occurredAt).toBeNull();
  });

  it('prefers the longer keyword: アイスコーヒー is coffee, アイス alone is snacks', () => {
    expect(parse('アイスコーヒー 450円', 'ja').categoryId).toBe('cat-food-coffee');
    expect(parse('アイス 300円', 'ja').categoryId).toBe('cat-food-snacks');
  });

  it('guesses the shop before で, never a word another field read', () => {
    const r = parse('ドトールでアイスコーヒー650円', 'ja');
    expect(r.merchant).toBe('ドトール');
    expect(r.merchantGuessed).toBe(true);
    expect(r.categoryId).toBe('cat-food-coffee');
    expect(r.unrecognized).toBe('ドトールで');
    const cafe = parse('カフェで500円', 'ja');
    expect(cafe.merchant).toBeNull();
    expect(cafe.unrecognized).toBeNull();
  });

  it('finds the starter Cash account as 現金 and trims particles from the note', () => {
    const r = parse('現金で弁当600円', 'ja');
    expect(r.accountId).toBe('acc-cash');
    expect(r.categoryId).toBe('cat-food-dining');
    expect(r.unrecognized).toBeNull();
  });

  it('reads income and currency words', () => {
    // An income word that is also the Salary keyword keeps both readings.
    const en = parse('salary 3000', 'en');
    expect(en.direction).toBe('income');
    expect(en.categoryId).toBe('cat-salary');
    const r = parse('給料 25万円', 'ja');
    expect(r.direction).toBe('income');
    expect(r.categoryId).toBe('cat-salary');
    expect(r.amountCents).toBe(25_000_000);
    expect(parse('20米ドル コーヒー', 'ja').currency).toBe('USD');
    expect(parse('20カナダドル コーヒー', 'ja').currency).toBe('CAD');
    const dollars = parse('20ドル コーヒー', 'ja');
    expect(dollars.currency).toBeNull();
    expect(dollars.dollarFamily).toBe(true);
  });

  it('finds Japanese starter category names', () => {
    expect(parse('食料品 3200円', 'ja').categoryId).toBe('cat-food-groceries');
    expect(parse('スーパー 3200円', 'ja').categoryId).toBe('cat-food-groceries');
  });
});

describe('thousands separators (docs/76, all languages)', () => {
  it('reads groups of three digits as thousands, a final one or two as cents', () => {
    expect(parse('1,500 dollars coffee', 'en').amountCents).toBe(150_000);
    expect(parse('1,500.50 rent', 'en').amountCents).toBe(150_050);
    expect(parse('1.500,50 aluguel', 'pt-BR').amountCents).toBe(150_050);
    expect(parse('12,50 café', 'pt-BR').amountCents).toBe(1250);
    expect(parse('10.61 coffee', 'en').amountCents).toBe(1061);
  });
});

describe('categories across languages (docs/73 D270)', () => {
  it('prefers a subcategory over its own group', () => {
    expect(parse('transporte uber 20', 'pt-BR').categoryId).toBe('cat-transport-rideshare');
  });

  it("stays ambiguous between unrelated categories", () => {
    expect(parse('café e farmácia 20', 'pt-BR').categoryId).toBeNull();
  });

  it('matches a renamed starter category only by its new name', () => {
    const renamed = categories.map((c) => (c.id === 'cat-food-groceries' ? { ...c, name: 'Costco runs' } : c));
    const ctx = { categories: renamed, categoryAliases: starterCategoryAliases(renamed), keywords: [] };
    expect(parse('45 costco runs', 'en', ctx).categoryId).toBe('cat-food-groceries');
    // "épicerie" is no longer one of its names, though the French pack
    // keyword still points at the starter category id.
    expect(parse('45 épicerie', 'fr', ctx).categoryId).toBe('cat-food-groceries');
  });

  it('skips built-in keywords for archived starter categories', () => {
    const archived = categories.map((c) => (c.id === 'cat-transport-parking' ? { ...c, archived: true } : c));
    expect(parse('60 stationnement', 'fr', { categories: archived, categoryAliases: [] }).categoryId).toBeNull();
  });

  it('matches built-in keywords as whole words only', () => {
    expect(parse('20 business lunch', 'en').categoryId).toBe('cat-food-dining');
  });

  it('never reads a keyword inside the amount', () => {
    // "99" is a starter Rideshare keyword (the ride app); it used to match
    // inside these prices and make them ambiguous.
    expect(parse('netflix 16.99', 'en').categoryId).toBe('cat-recreation-movies');
    expect(parse('coffee 9.99', 'en').categoryId).toBe('cat-food-coffee');
    expect(parse('gasolina 199', 'pt-BR').categoryId).toBe('cat-transport-fuel');
    // The ride app itself still matches when it isn't the amount.
    const ride = parse('23,50 no 99', 'pt-BR');
    expect(ride.amountCents).toBe(2350);
    expect(ride.categoryId).toBe('cat-transport-rideshare');
  });
});

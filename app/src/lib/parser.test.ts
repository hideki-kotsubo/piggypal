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
});

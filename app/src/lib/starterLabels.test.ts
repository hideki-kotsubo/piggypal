import { afterEach, describe, expect, it } from 'vitest';
import i18n, { resources } from './i18n';
import { seedAccounts, seedCategories } from './seed';
import { accountName, categoryLabel } from './starterLabels';

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('starter labels stay in sync with seed.ts', () => {
  // The "never renamed" check compares stored names against these labels,
  // and the database stores seed.ts's English names.
  it('en.json has the exact seed.ts name for every starter category', () => {
    const labels = resources.en.translation.seedCategory as Record<string, string>;
    for (const c of seedCategories) expect(labels[c.id], c.id).toBe(c.name);
    expect(Object.keys(labels).sort()).toEqual(seedCategories.map((c) => c.id).sort());
  });

  it('starter account names are their kind labels in en.json', () => {
    const kinds = resources.en.translation.accountKind as Record<string, string>;
    for (const a of seedAccounts) expect(kinds[a.kind]).toBe(a.name);
  });
});

// docs/73 D266
describe('categoryLabel', () => {
  const groceries = { id: 'cat-food-groceries', name: 'Groceries' };

  it('shows a never-renamed starter category in the UI language', async () => {
    await i18n.changeLanguage('pt-BR');
    expect(categoryLabel(groceries)).toBe('Mercado');
    await i18n.changeLanguage('fr-CA');
    expect(categoryLabel(groceries)).toBe('Épicerie');
    await i18n.changeLanguage('fr');
    expect(categoryLabel(groceries)).toBe('Courses');
    await i18n.changeLanguage('es');
    expect(categoryLabel({ id: 'cat-recreation', name: 'Recreation & Entertainment' })).toBe('Ocio y Entretenimiento');
  });

  it('treats a starter label saved from another language as never renamed', async () => {
    expect(categoryLabel({ ...groceries, name: 'Mercado' })).toBe('Groceries');
    await i18n.changeLanguage('es-ES');
    expect(categoryLabel({ ...groceries, name: 'Épicerie' })).toBe('Supermercado');
    expect(categoryLabel({ ...groceries, name: '  mercado ' })).toBe('Supermercado');
  });

  it('shows a renamed or user-created category exactly as typed', async () => {
    await i18n.changeLanguage('pt-BR');
    expect(categoryLabel({ ...groceries, name: 'Costco runs' })).toBe('Costco runs');
    expect(categoryLabel({ id: 'a1b2c3', name: 'Groceries' })).toBe('Groceries');
  });

  it("doesn't confuse one starter category's label with another's", async () => {
    await i18n.changeLanguage('pt-BR');
    expect(categoryLabel({ id: 'cat-food-coffee', name: 'Groceries' })).toBe('Groceries');
  });
});

// docs/73 D267
describe('accountName', () => {
  it('translates a starter account still carrying its kind label', async () => {
    await i18n.changeLanguage('pt-BR');
    expect(accountName({ name: 'Cash', kind: 'cash' })).toBe('Dinheiro');
    expect(accountName({ name: 'Checking', kind: 'checking' })).toBe('Conta corrente');
    await i18n.changeLanguage('en');
    expect(accountName({ name: 'Efectivo', kind: 'cash' })).toBe('Cash');
  });

  it('leaves other names alone', async () => {
    await i18n.changeLanguage('pt-BR');
    expect(accountName({ name: 'Visa', kind: 'credit' })).toBe('Visa');
    expect(accountName({ name: 'Cash', kind: 'checking' })).toBe('Cash');
    expect(accountName({ name: 'Cash' })).toBe('Cash');
  });
});

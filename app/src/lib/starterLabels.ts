import i18n, { LANGUAGES } from './i18n';
import type { AccountKind } from './types';

// docs/73 D266/D267 — starter categories and accounts show in the UI
// language, while the database keeps the English starter name. A row
// counts as "never renamed" when its stored name equals its starter label
// in *any* language, so a name saved unchanged from a Portuguese device
// ("Mercado") still translates everywhere else. A renamed or user-created
// row always shows exactly what the user typed.

const normalize = (s: string) => s.trim().toLocaleLowerCase();
const labelCache = new Map<string, Set<string>>();

// Every language's label for one key, regional files resolved through
// their fallback (fr-CA → fr → en).
function labelsInEveryLanguage(key: string): Set<string> {
  let labels = labelCache.get(key);
  if (!labels) {
    labels = new Set(LANGUAGES.map((l) => normalize(i18n.getFixedT(l.tag)(key))));
    labelCache.set(key, labels);
  }
  return labels;
}

function isStarterName(key: string, name: string): boolean {
  return i18n.exists(key, { lng: 'en' }) && labelsInEveryLanguage(key).has(normalize(name));
}

export function categoryLabel(category: { id: string; name: string }): string {
  const key = `seedCategory.${category.id}`;
  return isStarterName(key, category.name) ? i18n.t(key) : category.name;
}

// Starter accounts have random ids (seed.ts), so the match is by kind:
// a cash account still named "Cash" (or "Dinheiro", "Efectivo"…) is the
// starter one.
export function accountName(account: { name: string; kind?: AccountKind }): string {
  if (!account.kind) return account.name;
  const key = `accountKind.${account.kind}`;
  return isStarterName(key, account.name) ? i18n.t(key) : account.name;
}

// docs/73 D270 — every language's starter names, as extra names the
// parser can match ("épicerie", "dinheiro"), but only for rows that were
// never renamed: a renamed category is found by the name the user gave it.
export function starterCategoryAliases(categories: { id: string; name: string }[]): { categoryId: string; alias: string }[] {
  return categories.flatMap((c) => {
    const key = `seedCategory.${c.id}`;
    return isStarterName(key, c.name) ? [...labelsInEveryLanguage(key)].map((alias) => ({ categoryId: c.id, alias })) : [];
  });
}

export function starterAccountAliases(accounts: { id: string; name: string; kind: AccountKind }[]): { accountId: string; alias: string }[] {
  return accounts.flatMap((a) => {
    const key = `accountKind.${a.kind}`;
    return isStarterName(key, a.name) ? [...labelsInEveryLanguage(key)].map((alias) => ({ accountId: a.id, alias })) : [];
  });
}

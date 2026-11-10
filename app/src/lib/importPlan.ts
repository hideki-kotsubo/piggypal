// docs/81 — the format-independent half of import: mapping file names to
// Flowtab accounts/categories (I-D8), matching lines against what's
// already logged (import = audit with nothing to match yet), review
// flags, and building the rows to write. Pure, like mergeMatch.ts and
// duplicateTransactions.ts: the screen renders it, store.importBatch
// writes it.

import { CATEGORY_PATH_SEPARATOR, type ImportLine } from './importFormerApp';
import type { Account, AccountKind, Category, Transaction, TransactionSplit } from './types';

// ---- mapping (I-D8) ----

export type AccountChoice =
  | { type: 'existing'; accountId: string }
  | { type: 'create'; name: string; kind: AccountKind };

export type CategoryChoice =
  | { type: 'existing'; categoryId: string }
  | { type: 'create' }
  | { type: 'none' }; // goes to the Inbox, uncategorized

export interface ImportMapping {
  accounts: Record<string, AccountChoice>; // keyed by the file's wallet name
  categories: Record<string, CategoryChoice>; // keyed by the file's category path
}

// Every name a row is known by (stored name, translated starter label,
// "Institution — Name"…), supplied by the caller so this file stays free
// of i18n.
export interface Named {
  id: string;
  labels: string[];
}

const norm = (s: string) => s.trim().toLocaleLowerCase().replace(/\s+/g, ' ');

function findByLabel<T extends Named>(rows: T[], name: string): T | undefined {
  const n = norm(name);
  return rows.find((r) => r.labels.some((l) => norm(l) === n));
}

export function guessAccountKind(name: string): AccountKind {
  const n = norm(name);
  if (/\b(visa|master ?card|mastercard|amex|card|cart[aã]o|itaucard|credit)\b|master\b/.test(n)) return 'credit';
  if (/\b(savings|poupan[cç]a|[ée]pargne)\b/.test(n)) return 'savings';
  if (/\b(cash|dinheiro|efectivo)\b/.test(n)) return 'cash';
  return 'checking';
}

export function walletNames(lines: ImportLine[]): string[] {
  return [...new Set(lines.flatMap((l) => l.legs.map((g) => g.accountName)))].sort((a, b) => a.localeCompare(b));
}

// Category paths used by expense/income lines (transfers have none), with
// the kind most of their lines have — a name used by income becomes an
// income category when created.
export function categoryPaths(lines: ImportLine[]): { path: string; kind: 'expense' | 'income'; count: number }[] {
  const by = new Map<string, { expense: number; income: number }>();
  for (const l of lines) {
    if (l.kind === 'transfer' || !l.categoryName) continue;
    const c = by.get(l.categoryName) ?? { expense: 0, income: 0 };
    c[l.kind] += 1;
    by.set(l.categoryName, c);
  }
  return [...by.entries()]
    .map(([path, c]) => ({ path, kind: c.income > c.expense ? ('income' as const) : ('expense' as const), count: c.expense + c.income }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function splitPath(path: string): [string, string | null] {
  const i = path.indexOf(CATEGORY_PATH_SEPARATOR);
  return i < 0 ? [path, null] : [path.slice(0, i), path.slice(i + CATEGORY_PATH_SEPARATOR.length)];
}

export function findCategoryForPath(
  path: string,
  categories: (Named & { parentId: string | null; archived?: boolean })[],
): string | null {
  const [parent, child] = splitPath(path);
  const live = categories.filter((c) => !c.archived);
  if (!child) return findByLabel(live, parent)?.id ?? null;
  const p = findByLabel(live.filter((c) => c.parentId === null), parent);
  if (!p) return null;
  return findByLabel(live.filter((c) => c.parentId === p.id), child)?.id ?? null;
}

// First suggestion for every name in the file: a remembered choice that
// still points at a live row, else a match by name, else create (accounts)
// / create (categories). The user reviews all of it before anything is
// written.
export function suggestMapping(
  lines: ImportLine[],
  accounts: (Named & { archived?: boolean })[],
  categories: (Named & { parentId: string | null; archived?: boolean })[],
  remembered?: Partial<ImportMapping>,
): ImportMapping {
  const liveAccounts = accounts.filter((a) => !a.archived);
  const mapping: ImportMapping = { accounts: {}, categories: {} };
  for (const name of walletNames(lines)) {
    const prev = remembered?.accounts?.[name];
    if (prev?.type === 'existing' && liveAccounts.some((a) => a.id === prev.accountId)) {
      mapping.accounts[name] = prev;
      continue;
    }
    const hit = findByLabel(liveAccounts, name);
    mapping.accounts[name] = hit ? { type: 'existing', accountId: hit.id } : { type: 'create', name, kind: guessAccountKind(name) };
  }
  for (const { path } of categoryPaths(lines)) {
    const prev = remembered?.categories?.[path];
    if (prev && (prev.type !== 'existing' || categories.some((c) => c.id === prev.categoryId && !c.archived))) {
      mapping.categories[path] = prev;
      continue;
    }
    const id = findCategoryForPath(path, categories);
    mapping.categories[path] = id ? { type: 'existing', categoryId: id } : { type: 'create' };
  }
  return mapping;
}

// ---- matching + review ----

export type LineStatus =
  | 'new' // will be added
  | 'alreadyImported' // its id is already in Flowtab (a previous import)
  | 'matched' // looks like something already logged by hand
  | 'transfer' // skipped until docs/82
  | 'problem'; // didn't pass the per-type checks; never written

export type LineFlag = 'possibleDuplicate' | 'unusualCurrency';

export interface PlannedLine {
  line: ImportLine;
  status: LineStatus;
  matchId: string | null; // the existing transaction, for alreadyImported/matched
  flags: LineFlag[];
}

export const MATCH_DAYS = 3; // post date vs. transaction date (docs/81)
const DUPLICATE_MINUTES = 10;

const dayNumber = (occurredAt: string) => Date.UTC(+occurredAt.slice(0, 4), +occurredAt.slice(5, 7) - 1, +occurredAt.slice(8, 10)) / 86_400_000;
const minuteNumber = (occurredAt: string) =>
  dayNumber(occurredAt) * 1440 + Number(occurredAt.slice(11, 13)) * 60 + Number(occurredAt.slice(14, 16));

function flagsFor(lines: ImportLine[]): Map<number, LineFlag[]> {
  const flags = new Map<number, LineFlag[]>();
  const add = (i: number, f: LineFlag) => {
    const arr = flags.get(i) ?? [];
    if (!arr.includes(f)) arr.push(f);
    flags.set(i, arr);
  };
  const usable = lines.filter((l) => l.issues.length === 0 && l.kind !== 'transfer');

  // Same amount, currency and merchant a few minutes apart (docs/81's
  // duplicate-charge check, inside the file). Both rows are flagged; both
  // stay selected — the user decides.
  const byKey = new Map<string, ImportLine[]>();
  for (const l of usable) {
    const key = `${l.currency}|${l.amountCents}|${norm(l.merchant ?? '')}`;
    byKey.set(key, [...(byKey.get(key) ?? []), l]);
  }
  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    for (let i = 1; i < sorted.length; i++) {
      if (minuteNumber(sorted[i].occurredAt) - minuteNumber(sorted[i - 1].occurredAt) <= DUPLICATE_MINUTES) {
        add(sorted[i - 1].index, 'possibleDuplicate');
        add(sorted[i].index, 'possibleDuplicate');
      }
    }
  }

  // A currency this wallet almost never uses (Amazon.ca on a CAD card
  // marked BRL). Needs enough history on the wallet to mean anything.
  const byWallet = new Map<string, ImportLine[]>();
  for (const l of usable) {
    const w = l.legs[0]?.accountName;
    if (w) byWallet.set(w, [...(byWallet.get(w) ?? []), l]);
  }
  for (const group of byWallet.values()) {
    if (group.length < 10) continue;
    const counts = new Map<string, number>();
    for (const l of group) counts.set(l.currency, (counts.get(l.currency) ?? 0) + 1);
    for (const l of group) {
      const n = counts.get(l.currency) ?? 0;
      if (n <= 3 && n / group.length < 0.05) add(l.index, 'unusualCurrency');
    }
  }
  return flags;
}

export function planImport(
  lines: ImportLine[],
  existing: Transaction[],
  splits: TransactionSplit[],
  accountIdFor: (walletName: string) => string | null, // existing accounts only; null = will be created
): PlannedLine[] {
  const byId = new Map(existing.map((t) => [t.id, t]));
  const splitAccounts = new Map<string, Set<string>>();
  for (const s of splits) {
    const set = splitAccounts.get(s.transactionId) ?? new Set<string>();
    set.add(s.accountId);
    splitAccounts.set(s.transactionId, set);
  }
  const touches = (t: Transaction, accountId: string) =>
    t.accountId === accountId || (t.accountId === null && (splitAccounts.get(t.id)?.has(accountId) ?? false));

  // Hand-logged candidates, bucketed by currency + amount. Rows from an
  // earlier import are found by id instead, never by amount.
  const candidates = new Map<string, Transaction[]>();
  for (const t of existing) {
    if (t.deletedAt) continue;
    const key = `${t.currency}|${t.amountCents}`;
    candidates.set(key, [...(candidates.get(key) ?? []), t]);
  }
  const claimed = new Set<string>();
  const flags = flagsFor(lines);

  const planned: PlannedLine[] = lines.map((line) => ({ line, status: 'new', matchId: null, flags: flags.get(line.index) ?? [] }));

  for (const p of planned) {
    const { line } = p;
    if (line.issues.length > 0) {
      p.status = 'problem';
      continue;
    }
    // An id already present, even soft-deleted: a deleted row stays
    // deleted, re-importing never brings it back.
    const prior = line.sourceId ? byId.get(line.sourceId) : undefined;
    if (prior) {
      p.status = 'alreadyImported';
      p.matchId = prior.id;
      claimed.add(prior.id);
      continue;
    }
    if (line.kind === 'transfer') p.status = 'transfer';
  }

  // Closest date wins; each existing transaction matches at most once.
  for (const p of planned) {
    if (p.status !== 'new') continue;
    const { line } = p;
    const accountIds = line.legs.map((g) => accountIdFor(g.accountName));
    if (accountIds.some((id) => id === null)) continue; // a new account has nothing logged yet
    const day = dayNumber(line.occurredAt);
    let best: { t: Transaction; diff: number } | null = null;
    for (const t of candidates.get(`${line.currency}|${line.amountCents}`) ?? []) {
      if (claimed.has(t.id)) continue;
      const diff = Math.abs(dayNumber(t.occurredAt) - day);
      if (diff > MATCH_DAYS) continue;
      if (!accountIds.every((id) => touches(t, id as string))) continue;
      if (!best || diff < best.diff) best = { t, diff };
    }
    if (best) {
      p.status = 'matched';
      p.matchId = best.t.id;
      claimed.add(best.t.id);
    }
  }
  return planned;
}

// ---- building the rows ----

export interface ImportBatch {
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  splits: TransactionSplit[];
}

export interface BuildContext {
  existingCategories: Category[];
  localUserId: string;
  payerFor: (accountId: string) => string; // store.defaultPayerFor; new accounts → owner
  newId: () => string;
  now: string; // UTC
}

// Writes `selected` lines (status 'new' or 'matched' the user chose to
// add anyway). New accounts/categories are created only when a selected
// line uses them.
export function buildImportBatch(selected: ImportLine[], mapping: ImportMapping, ctx: BuildContext): ImportBatch {
  const batch: ImportBatch = { accounts: [], categories: [], transactions: [], splits: [] };
  const accountIds = new Map<string, string>();
  const categoryIds = new Map<string, string | null>();
  const createdCategories: (Category & { labels: string[] })[] = [];

  const accountFor = (name: string): string => {
    const known = accountIds.get(name);
    if (known) return known;
    const choice = mapping.accounts[name];
    let id: string;
    if (choice?.type === 'existing') id = choice.accountId;
    else {
      id = ctx.newId();
      batch.accounts.push({
        id,
        institution: null,
        name: choice?.name ?? name,
        kind: choice?.kind ?? guessAccountKind(name),
        archived: false,
        ownerUserId: ctx.localUserId,
        updatedAt: ctx.now,
      });
    }
    accountIds.set(name, id);
    return id;
  };

  const createCategory = (name: string, parentId: string | null, kind: 'expense' | 'income'): string => {
    const all = [
      ...ctx.existingCategories.map((c) => ({ ...c, labels: [c.name] })),
      ...createdCategories,
    ].filter((c) => c.parentId === parentId && !c.archived);
    const hit = findByLabel(all, name);
    if (hit) return hit.id;
    const c: Category = { id: ctx.newId(), name, kind, parentId, archived: false, updatedAt: ctx.now };
    batch.categories.push(c);
    createdCategories.push({ ...c, labels: [name] });
    return c.id;
  };

  const categoryFor = (path: string, kind: 'expense' | 'income'): string | null => {
    if (categoryIds.has(path)) return categoryIds.get(path) ?? null;
    const choice = mapping.categories[path] ?? { type: 'create' };
    let id: string | null = null;
    if (choice.type === 'existing') id = choice.categoryId;
    else if (choice.type === 'create') {
      const [parent, child] = splitPath(path);
      const parentId = createCategory(parent, null, kind);
      id = child ? createCategory(child, parentId, kind) : parentId;
    }
    categoryIds.set(path, id);
    return id;
  };

  for (const line of selected) {
    if (line.kind === 'transfer' || line.issues.length > 0) continue;
    const legAccounts = line.legs.map((g) => accountFor(g.accountName));
    const id = line.sourceId ?? ctx.newId();
    const isSplit = line.legs.length > 1;
    batch.transactions.push({
      id,
      accountId: isSplit ? null : legAccounts[0],
      categoryId: line.categoryName ? categoryFor(line.categoryName, line.kind) : null,
      amountCents: line.amountCents,
      currency: line.currency,
      occurredAt: line.occurredAt,
      note: line.note,
      merchant: line.merchant,
      source: 'import',
      aiRaw: null,
      deletedAt: null,
      paidByUserId: ctx.payerFor(legAccounts[0]),
      createdByUserId: ctx.localUserId,
      scheduleId: null,
      occurrenceDate: null,
      privateToProfileId: null,
      updatedAt: ctx.now,
    });
    if (isSplit) {
      line.legs.forEach((g, i) =>
        batch.splits.push({ id: ctx.newId(), transactionId: id, accountId: legAccounts[i], amountCents: g.amountCents, updatedAt: ctx.now }),
      );
    }
  }
  return batch;
}

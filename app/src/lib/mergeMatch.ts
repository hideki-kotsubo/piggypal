import type { Account, Category } from './types';

// docs/46 D167/D168 — the merge-matching cascade for the sign-in merge
// redesign. Pure, no DB/React import, so it's fully unit-testable and
// reusable by both the sign-in merge flow and the (separately backlogged)
// manual record-level merge feature.
//
// Interpretation call, flagged like docs/41/43's own: docs/46 D167's
// cascade lists four branches ("exact match", "same id different name",
// "fuzzy + same parent", "anything else"). Read literally, branch 4 would
// dump every non-match into "manual review" — but the overwhelming common
// case (a local category with no server counterpart at all) isn't
// ambiguous, it's just new, and showing it as a "conflict" would bury the
// genuinely useful manual cases in noise. This module only surfaces a
// candidate as `manual` when there's a real near-miss worth a human
// glance — concretely, a fuzzy name match that's disqualified from
// auto-merge by a field mismatch (different parent for categories,
// different kind for accounts). A local record with no candidate at all
// is simply new — callers upload it as-is, no entry in any bucket.

// ---- name normalization ----

// Lowercase, strip diacritics, trim, collapse whitespace — bilingual
// pt-BR/en means "Café" and "cafe" must compare equal here.
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // combining diacritical marks left after NFD
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

export function isExactNameMatch(a: string, b: string): boolean {
  return normalizeName(a) === normalizeName(b);
}

// Small built-in table for common budgeting-vocabulary abbreviations that
// aren't simple prefixes (bilingual). Deliberately small and easy to
// extend — flagged in docs/46 as an implementation detail to tune later,
// not a specified-in-full list.
const ABBREVIATIONS: [string, string][] = [
  ['restaurant', 'rest'],
  ['restaurante', 'rest'],
  ['entertainment', 'ent'],
  ['entretenimento', 'entret'],
  ['subscription', 'sub'],
  ['assinatura', 'assin'],
  ['transportation', 'transport'],
  ['transporte', 'transp'],
  ['insurance', 'ins'],
  ['seguro', 'seg'],
];

function abbreviationMatch(a: string, b: string): boolean {
  return ABBREVIATIONS.some(([full, abbr]) => (a === full && b === abbr) || (a === abbr && b === full));
}

// General prefix-abbreviation heuristic: catches "Groc." → "Groceries"
// without a hand-maintained entry for every case. Deliberately requires
// an explicit trailing "." — a bare prefix with no marker ("Restaurant"
// of "Restaurants & Bars") is a real word continuation, not an
// abbreviation, and treating it as one is exactly what let an unrelated,
// longer name slip past the confirmed permissiveness level (caught by a
// real test, not assumed).
function prefixAbbreviationMatch(a: string, b: string): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (!short.endsWith('.')) return false;
  const shortClean = short.slice(0, -1);
  if (shortClean.length < 2) return false;
  return long.startsWith(shortClean);
}

// Singular/plural stemming, pt-BR + en. Deliberately simple — this is a
// small budgeting-category vocabulary, not general NLP: strip a trailing
// "s"/"es", and handle the one common irregular the confirmed example
// needs ("Grocery"/"Groceries", y→ies).
function stem(word: string): string {
  if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith('es') && word.length > 3) return word.slice(0, -2);
  if (word.endsWith('s') && word.length > 3) return word.slice(0, -1);
  return word;
}

function pluralMatch(a: string, b: string): boolean {
  return stem(a) === stem(b);
}

// Plain Levenshtein distance, capped comparison — category/account names
// are short, so the full DP table is simple and fast enough; no need for
// a bounded/early-exit variant.
function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

// Confirmed permissiveness (2026-08-23): "Grocery"/"Groceries" and
// "Cofee"/"Coffee" merge; "Restaurant"/"Restaurants & Bars" does not —
// the length gap there is far past a single typo or a plain plural.
export function isFuzzyNameMatch(rawA: string, rawB: string): boolean {
  const a = normalizeName(rawA);
  const b = normalizeName(rawB);
  if (a === b) return true;
  if (pluralMatch(a, b)) return true;
  if (abbreviationMatch(a, b)) return true;
  if (prefixAbbreviationMatch(a, b)) return true;
  if (levenshtein(a, b) === 1) return true;
  return false;
}

// ---- categories (D167) ----

export interface CategoryMerge {
  localId: string;
  serverId: string;
  via: 'exact' | 'fuzzy';
}

export interface CategorySplit {
  localId: string;
  newId: string;
}

export interface CategoryManualCandidate {
  local: Category;
  server: Category;
  reason: 'different-parent';
}

export interface CategoryMatchResult {
  merged: CategoryMerge[];
  split: CategorySplit[];
  manual: CategoryManualCandidate[];
}

export function matchCategories(local: Category[], server: Category[]): CategoryMatchResult {
  const merged: CategoryMerge[] = [];
  const split: CategorySplit[] = [];
  const manual: CategoryManualCandidate[] = [];

  const serverById = new Map(server.map((c) => [c.id, c]));
  const claimed = new Set<string>();
  // localId -> the id this category effectively has after resolution
  // (server id if merged, a fresh id if split, its own id otherwise) —
  // read by pass 2 to resolve a child's *effective* parent before
  // checking the fuzzy-tier's "same parent" requirement.
  const remap = new Map<string, string>();

  function resolveOne(loc: Category, requireSameParent: (serverParentId: string | null) => boolean) {
    const byId = serverById.get(loc.id);
    if (byId && !claimed.has(byId.id)) {
      claimed.add(byId.id);
      remap.set(loc.id, byId.id);
      if (!isExactNameMatch(loc.name, byId.name)) {
        // Same id, different name (D167.2) — un-collide: this device's
        // version gets a fresh id rather than either name silently
        // winning over the other.
        const newId = crypto.randomUUID();
        remap.set(loc.id, newId);
        split.push({ localId: loc.id, newId });
      }
      return;
    }

    let exact: Category | null = null;
    for (const s of server) {
      if (claimed.has(s.id)) continue;
      if (isExactNameMatch(loc.name, s.name)) {
        exact = s;
        break;
      }
    }
    if (exact) {
      // Deliberately parent-agnostic — the user's own rule only gates
      // the *fuzzy* tier below on a matching parent ("if a category's
      // name isn't exact the same... but if the parent's id is
      // different we should not merge it"); an exact name match merges
      // regardless of where either side currently nests it.
      claimed.add(exact.id);
      remap.set(loc.id, exact.id);
      merged.push({ localId: loc.id, serverId: exact.id, via: 'exact' });
      return;
    }

    let fuzzySameParent: Category | null = null;
    let fuzzyDifferentParent: Category | null = null;
    for (const s of server) {
      if (claimed.has(s.id)) continue;
      if (!isFuzzyNameMatch(loc.name, s.name)) continue;
      if (requireSameParent(s.parentId)) {
        fuzzySameParent = s;
        break;
      }
      fuzzyDifferentParent ??= s;
    }
    if (fuzzySameParent) {
      claimed.add(fuzzySameParent.id);
      remap.set(loc.id, fuzzySameParent.id);
      merged.push({ localId: loc.id, serverId: fuzzySameParent.id, via: 'fuzzy' });
      return;
    }

    remap.set(loc.id, loc.id);
    if (fuzzyDifferentParent) {
      // D167.3's "different parent → do not merge, keep as distinct" is
      // the safe default if nothing acts on this; surfaced anyway per
      // "manual, always, with context" so a genuine duplicate created
      // under the wrong parent isn't silently kept apart forever.
      manual.push({ local: loc, server: fuzzyDifferentParent, reason: 'different-parent' });
    }
    // No candidate at all (exact, id, or fuzzy) — genuinely new, no
    // entry in any bucket; the caller uploads it as-is.
  }

  // Categories are capped at 2 levels (docs/14 D70) — resolve parents
  // first so a child's fuzzy-match parent check can use each parent's
  // *effective* (already-resolved) id, not its stale local one.
  for (const loc of local.filter((c) => c.parentId === null)) {
    resolveOne(loc, (serverParentId) => serverParentId === null);
  }
  for (const loc of local.filter((c) => c.parentId !== null)) {
    const effectiveParent = remap.get(loc.parentId!) ?? loc.parentId;
    resolveOne(loc, (serverParentId) => serverParentId === effectiveParent);
  }

  return { merged, split, manual };
}

// ---- accounts (D168) ----

export interface AccountMerge {
  localId: string;
  serverId: string;
  via: 'exact' | 'fuzzy';
}

export interface AccountSplit {
  localId: string;
  newId: string;
}

export interface AccountManualCandidate {
  local: Account;
  server: Account;
  reason: 'different-kind';
}

export interface AccountMatchResult {
  merged: AccountMerge[];
  split: AccountSplit[];
  manual: AccountManualCandidate[];
}

function accountSignature(a: Account): string {
  return `${normalizeName(a.institution ?? '')}|${normalizeName(a.name)}`;
}

function accountsFuzzyMatch(a: Account, b: Account): boolean {
  return (
    isFuzzyNameMatch(a.institution ?? '', b.institution ?? '') && isFuzzyNameMatch(a.name, b.name)
  );
}

// D168's hard precondition: this only ever compares accounts already
// known to share one owner — the actual mechanism that keeps two
// household members' identically-named accounts (docs/46's "RBC Bank —
// Mastercard — Credit" example) from ever being conflated. Enforced, not
// just documented: throws if either list mixes owners, or if the two
// lists' owners don't match each other.
export function matchAccounts(local: Account[], server: Account[]): AccountMatchResult {
  const localOwners = new Set(local.map((a) => a.ownerUserId));
  const serverOwners = new Set(server.map((a) => a.ownerUserId));
  if (localOwners.size > 1 || serverOwners.size > 1) {
    throw new Error('matchAccounts: local and server lists must each belong to a single owner');
  }
  const localOwner = [...localOwners][0];
  const serverOwner = [...serverOwners][0];
  if (localOwner !== undefined && serverOwner !== undefined && localOwner !== serverOwner) {
    throw new Error('matchAccounts: local and server owners differ — never compare across owners');
  }

  const merged: AccountMerge[] = [];
  const split: AccountSplit[] = [];
  const manual: AccountManualCandidate[] = [];

  const serverById = new Map(server.map((a) => [a.id, a]));
  const claimed = new Set<string>();

  for (const loc of local) {
    const byId = serverById.get(loc.id);
    if (byId && !claimed.has(byId.id)) {
      claimed.add(byId.id);
      if (accountSignature(loc) !== accountSignature(byId) || loc.kind !== byId.kind) {
        split.push({ localId: loc.id, newId: crypto.randomUUID() });
      }
      continue;
    }

    let exact: Account | null = null;
    for (const s of server) {
      if (claimed.has(s.id)) continue;
      if (accountSignature(loc) === accountSignature(s) && loc.kind === s.kind) {
        exact = s;
        break;
      }
    }
    if (exact) {
      claimed.add(exact.id);
      merged.push({ localId: loc.id, serverId: exact.id, via: 'exact' });
      continue;
    }

    let fuzzySameKind: Account | null = null;
    let fuzzyDifferentKind: Account | null = null;
    for (const s of server) {
      if (claimed.has(s.id)) continue;
      if (!accountsFuzzyMatch(loc, s)) continue;
      if (loc.kind === s.kind) {
        fuzzySameKind = s;
        break;
      }
      fuzzyDifferentKind ??= s;
    }
    if (fuzzySameKind) {
      claimed.add(fuzzySameKind.id);
      merged.push({ localId: loc.id, serverId: fuzzySameKind.id, via: 'fuzzy' });
      continue;
    }
    if (fuzzyDifferentKind) {
      manual.push({ local: loc, server: fuzzyDifferentKind, reason: 'different-kind' });
    }
    // No candidate — genuinely new/distinct account, no entry needed.
  }

  return { merged, split, manual };
}

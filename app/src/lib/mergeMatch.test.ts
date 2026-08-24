import { describe, expect, it } from 'vitest';
import {
  isExactNameMatch,
  isFuzzyNameMatch,
  matchAccounts,
  matchCategories,
  normalizeName,
  resolveAccountRewrites,
  resolveCategoryRewrites,
} from './mergeMatch';
import type { Account, Category } from './types';

function cat(overrides: Partial<Category>): Category {
  return {
    id: 'c-1',
    name: 'Groceries',
    kind: 'expense',
    parentId: null,
    archived: false,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function acct(overrides: Partial<Account>): Account {
  return {
    id: 'a-1',
    institution: 'RBC',
    name: 'Mastercard',
    kind: 'credit',
    archived: false,
    ownerUserId: 'owner-1',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('normalizeName / isExactNameMatch', () => {
  it('is accent- and case-insensitive (bilingual pt-BR/en)', () => {
    expect(normalizeName('Café')).toBe(normalizeName('cafe'));
    expect(isExactNameMatch('Café', 'CAFE')).toBe(true);
  });

  it('collapses whitespace and trims', () => {
    expect(normalizeName('  Groceries   ')).toBe('groceries');
  });
});

describe('isFuzzyNameMatch — confirmed permissiveness (2026-08-23)', () => {
  it('merges a plain plural/singular pair', () => {
    expect(isFuzzyNameMatch('Grocery', 'Groceries')).toBe(true);
  });

  it('merges an edit-distance-1 typo', () => {
    expect(isFuzzyNameMatch('Cofee', 'Coffee')).toBe(true);
  });

  it('does not merge a semantically different, longer name', () => {
    expect(isFuzzyNameMatch('Restaurant', 'Restaurants & Bars')).toBe(false);
  });

  it('matches a known abbreviation pair', () => {
    expect(isFuzzyNameMatch('Restaurant', 'Rest')).toBe(true);
  });

  it('matches a general prefix abbreviation not in the built-in table', () => {
    expect(isFuzzyNameMatch('Groceries', 'Groc.')).toBe(true);
  });

  it('does not match unrelated names', () => {
    expect(isFuzzyNameMatch('Groceries', 'Rideshare')).toBe(false);
  });
});

describe('matchCategories', () => {
  it('merges an exact name match under different ids', () => {
    const local = [cat({ id: 'local-groceries', name: 'Groceries' })];
    const server = [cat({ id: 'cat-food-groceries', name: 'Groceries' })];
    const result = matchCategories(local, server);
    expect(result.merged).toEqual([{ localId: 'local-groceries', serverId: 'cat-food-groceries', via: 'exact' }]);
    expect(result.split).toEqual([]);
    expect(result.manual).toEqual([]);
  });

  it('splits when the same id has two different names', () => {
    const local = [cat({ id: 'cat-food-groceries', name: 'Mercado' })];
    const server = [cat({ id: 'cat-food-groceries', name: 'Groceries' })];
    const result = matchCategories(local, server);
    expect(result.merged).toEqual([]);
    expect(result.split).toHaveLength(1);
    expect(result.split[0].localId).toBe('cat-food-groceries');
    expect(result.split[0].newId).not.toBe('cat-food-groceries');
    expect(result.manual).toEqual([]);
  });

  it('treats the same id with the same name as a no-op (not split, not reported as merged)', () => {
    const local = [cat({ id: 'cat-food-groceries', name: 'Groceries' })];
    const server = [cat({ id: 'cat-food-groceries', name: 'Groceries' })];
    const result = matchCategories(local, server);
    expect(result.merged).toEqual([]);
    expect(result.split).toEqual([]);
    expect(result.manual).toEqual([]);
  });

  it('merges a fuzzy match under the same parent', () => {
    const local = [cat({ id: 'local-groc', name: 'Grocery', parentId: null })];
    const server = [cat({ id: 'cat-food', name: 'Groceries', parentId: null })];
    const result = matchCategories(local, server);
    expect(result.merged).toEqual([{ localId: 'local-groc', serverId: 'cat-food', via: 'fuzzy' }]);
  });

  it('does not auto-merge a fuzzy match under a different parent — surfaces it for manual review instead', () => {
    // "Gass" (typo, edit-distance-1 from "Gas") — deliberately not an
    // exact match, since exact matches are parent-agnostic by design
    // (see the comment in matchCategories) and wouldn't exercise this
    // branch at all.
    const local = [cat({ id: 'local-gas', name: 'Gass', parentId: 'local-transport' })];
    const server = [
      cat({ id: 'server-utilities', name: 'Utilities', parentId: null }),
      cat({ id: 'server-gas', name: 'Gas', parentId: 'server-utilities' }),
    ];
    // local's own parent has no server counterpart at all here, so its
    // effective parent stays 'local-transport' — definitely not
    // 'server-utilities'.
    const result = matchCategories(local, server);
    expect(result.merged).toEqual([]);
    expect(result.split).toEqual([]);
    expect(result.manual).toEqual([
      { local: local[0], server: server[1], reason: 'different-parent' },
    ]);
  });

  it('leaves a genuinely new category alone — no candidate means no entry in any bucket', () => {
    const local = [cat({ id: 'local-hobby', name: 'Hobbies' })];
    const server = [cat({ id: 'cat-food', name: 'Groceries' })];
    const result = matchCategories(local, server);
    expect(result.merged).toEqual([]);
    expect(result.split).toEqual([]);
    expect(result.manual).toEqual([]);
  });

  it('resolves a child against its parent\'s *effective* (already-merged) id, not the stale local one', () => {
    const local = [
      cat({ id: 'local-food', name: 'Food', parentId: null }),
      cat({ id: 'local-food-groc', name: 'Groceries', parentId: 'local-food' }),
    ];
    const server = [
      cat({ id: 'cat-food', name: 'Food', parentId: null }),
      cat({ id: 'cat-food-groc', name: 'Groceries', parentId: 'cat-food' }),
    ];
    const result = matchCategories(local, server);
    expect(result.merged).toEqual(
      expect.arrayContaining([
        { localId: 'local-food', serverId: 'cat-food', via: 'exact' },
        { localId: 'local-food-groc', serverId: 'cat-food-groc', via: 'exact' },
      ]),
    );
  });

  it('never claims the same server category twice', () => {
    const local = [
      cat({ id: 'local-1', name: 'Groceries' }),
      cat({ id: 'local-2', name: 'Groceries' }),
    ];
    const server = [cat({ id: 'cat-food', name: 'Groceries' })];
    const result = matchCategories(local, server);
    expect(result.merged).toHaveLength(1);
  });
});

describe('matchAccounts', () => {
  it('rejects a local list mixing owners', () => {
    const local = [acct({ id: 'a', ownerUserId: 'owner-1' }), acct({ id: 'b', ownerUserId: 'owner-2' })];
    expect(() => matchAccounts(local, [])).toThrow(/single owner/);
  });

  it('rejects comparing across two different owners — the household guard', () => {
    // The exact docs/46 scenario: husband and wife each created an
    // identically-named "RBC Bank — Mastercard — Credit" account. Calling
    // matchAccounts across their two owners must be structurally
    // impossible, not just discouraged.
    const husbandAccount = acct({ id: 'husband-acct', ownerUserId: 'husband' });
    const wifeAccount = acct({ id: 'wife-acct', ownerUserId: 'wife' });
    expect(() => matchAccounts([husbandAccount], [wifeAccount])).toThrow(/never compare across owners/);
  });

  it('merges an exact institution+name+kind match under different ids, same owner', () => {
    const local = [acct({ id: 'local-a', ownerUserId: 'owner-1' })];
    const server = [acct({ id: 'server-a', ownerUserId: 'owner-1' })];
    const result = matchAccounts(local, server);
    expect(result.merged).toEqual([{ localId: 'local-a', serverId: 'server-a', via: 'exact' }]);
  });

  it('splits when the same id disagrees on kind', () => {
    const local = [acct({ id: 'shared-id', kind: 'credit', ownerUserId: 'owner-1' })];
    const server = [acct({ id: 'shared-id', kind: 'checking', ownerUserId: 'owner-1' })];
    const result = matchAccounts(local, server);
    expect(result.split).toHaveLength(1);
    expect(result.split[0].localId).toBe('shared-id');
  });

  it('merges a fuzzy institution/name match with the same kind', () => {
    const local = [acct({ id: 'local-a', institution: 'RBC', name: 'Mastercard', kind: 'credit', ownerUserId: 'owner-1' })];
    const server = [acct({ id: 'server-a', institution: 'RBC', name: 'Master Card', kind: 'credit', ownerUserId: 'owner-1' })];
    const result = matchAccounts(local, server);
    expect(result.merged).toEqual([{ localId: 'local-a', serverId: 'server-a', via: 'fuzzy' }]);
  });

  it('does not auto-merge a fuzzy match with a different kind — manual review instead', () => {
    const local = [acct({ id: 'local-a', institution: 'RBC', name: 'Mastercard', kind: 'credit', ownerUserId: 'owner-1' })];
    const server = [acct({ id: 'server-a', institution: 'RBC', name: 'Mastercard', kind: 'checking', ownerUserId: 'owner-1' })];
    const result = matchAccounts(local, server);
    expect(result.merged).toEqual([]);
    expect(result.manual).toEqual([{ local: local[0], server: server[0], reason: 'different-kind' }]);
  });

  it('leaves two identically-named accounts under different owners entirely separate once properly scoped', () => {
    // The correct usage: call matchAccounts once per owner, never across
    // owners. Each call sees only its own owner's accounts, so the
    // identical name never even becomes a candidate for the other person.
    const husbandLocal = [acct({ id: 'husband-local', institution: 'RBC', name: 'Mastercard', ownerUserId: 'husband' })];
    const husbandServer: Account[] = [];
    const wifeLocal = [acct({ id: 'wife-local', institution: 'RBC', name: 'Mastercard', ownerUserId: 'wife' })];
    const wifeServer: Account[] = [];

    expect(matchAccounts(husbandLocal, husbandServer).merged).toEqual([]);
    expect(matchAccounts(wifeLocal, wifeServer).merged).toEqual([]);
    // Neither call ever saw the other's account — nothing to assert
    // beyond both resolving independently without throwing.
  });
});

describe('resolveCategoryRewrites', () => {
  it('a merge reinserts nothing — the server already has the row', () => {
    const local = [cat({ id: 'local-groceries', name: 'Groceries' })];
    const result = matchCategories(local, [cat({ id: 'cat-food-groceries', name: 'Groceries' })]);
    const rewrites = resolveCategoryRewrites(local, result, {});
    expect(rewrites).toEqual([{ oldId: 'local-groceries', newId: 'cat-food-groceries', reinsert: null }]);
  });

  it('a split reinserts the local row\'s own data at the new id — the real bug this caught before it shipped', () => {
    const local = [cat({ id: 'cat-food', name: 'Mercado', kind: 'expense' })];
    const result = matchCategories(local, [cat({ id: 'cat-food', name: 'Groceries' })]);
    const rewrites = resolveCategoryRewrites(local, result, {});
    expect(rewrites).toHaveLength(1);
    expect(rewrites[0].oldId).toBe('cat-food');
    expect(rewrites[0].reinsert).not.toBeNull();
    expect(rewrites[0].reinsert?.name).toBe('Mercado');
    expect(rewrites[0].reinsert?.id).toBe(rewrites[0].newId);
  });

  it('an unresolved manual conflict produces no rewrite at all', () => {
    const local = [cat({ id: 'local-gas', name: 'Gass', parentId: 'local-transport' })];
    const server = [
      cat({ id: 'server-utilities', name: 'Utilities', parentId: null }),
      cat({ id: 'server-gas', name: 'Gas', parentId: 'server-utilities' }),
    ];
    const result = matchCategories(local, server);
    expect(resolveCategoryRewrites(local, result, {})).toEqual([]);
  });

  it('"keep theirs" resolves like a merge; "keep mine" resolves like a split', () => {
    const local = [cat({ id: 'local-gas', name: 'Gass', parentId: 'local-transport' })];
    const server = [
      cat({ id: 'server-utilities', name: 'Utilities', parentId: null }),
      cat({ id: 'server-gas', name: 'Gas', parentId: 'server-utilities' }),
    ];
    const result = matchCategories(local, server);

    const keepTheirs = resolveCategoryRewrites(local, result, { 'local-gas': 'server' });
    expect(keepTheirs).toEqual([{ oldId: 'local-gas', newId: 'server-gas', reinsert: null }]);

    const keepMine = resolveCategoryRewrites(local, result, { 'local-gas': 'local' });
    expect(keepMine).toHaveLength(1);
    expect(keepMine[0].reinsert?.name).toBe('Gass');
    expect(keepMine[0].reinsert?.id).toBe(keepMine[0].newId);
    expect(keepMine[0].newId).not.toBe('local-gas');
  });
});

describe('resolveAccountRewrites', () => {
  it('a split reinserts the local account\'s own data at the new id', () => {
    const local = [acct({ id: 'shared-id', kind: 'credit', name: 'Mastercard', ownerUserId: 'owner-1' })];
    const server = [acct({ id: 'shared-id', kind: 'checking', name: 'Mastercard', ownerUserId: 'owner-1' })];
    const result = matchAccounts(local, server);
    const rewrites = resolveAccountRewrites(local, result, {});
    expect(rewrites).toHaveLength(1);
    expect(rewrites[0].reinsert?.kind).toBe('credit');
    expect(rewrites[0].reinsert?.id).toBe(rewrites[0].newId);
  });
});

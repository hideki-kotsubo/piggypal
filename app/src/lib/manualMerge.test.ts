import { describe, expect, it } from 'vitest';
import { canMergeCategoryIntoSurvivor, categoryMergeBlockedReason, crossOwnerLosers } from './manualMerge';
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

describe('categoryMergeBlockedReason — docs/14 D70 depth cap', () => {
  it('allows a top-level survivor absorbing a childless loser', () => {
    const survivor = cat({ id: 'food', parentId: null });
    const loser = cat({ id: 'groceries', parentId: null });
    expect(categoryMergeBlockedReason(survivor, loser, [survivor, loser])).toBeNull();
  });

  it('allows a top-level survivor absorbing a loser that has children — still 2 levels after reparenting', () => {
    const survivor = cat({ id: 'housing', parentId: null });
    const loser = cat({ id: 'transport', parentId: null });
    const child = cat({ id: 'fuel', parentId: 'transport' });
    expect(categoryMergeBlockedReason(survivor, loser, [survivor, loser, child])).toBeNull();
  });

  it('blocks a child survivor absorbing a loser with children — would nest 3 levels', () => {
    const survivor = cat({ id: 'groceries', parentId: 'food' });
    const loser = cat({ id: 'transport', parentId: null });
    const child = cat({ id: 'fuel', parentId: 'transport' });
    expect(categoryMergeBlockedReason(survivor, loser, [survivor, loser, child])).toMatch(/nest 3 levels/);
    expect(canMergeCategoryIntoSurvivor(survivor, loser, [survivor, loser, child])).toBe(false);
  });

  it('allows a child survivor absorbing a childless loser — collapsing two leaf subcategories', () => {
    const survivor = cat({ id: 'groceries', parentId: 'food' });
    const loser = cat({ id: 'snacks', parentId: 'food' });
    expect(categoryMergeBlockedReason(survivor, loser, [survivor, loser])).toBeNull();
  });

  it('blocks merging a category into its own parent', () => {
    const child = cat({ id: 'groceries', parentId: 'food-group' });
    const parent = cat({ id: 'food-group', parentId: null });
    expect(categoryMergeBlockedReason(child, parent, [child, parent])).toMatch(/own subcategory/);
  });

  it('allows a parent absorbing its own child — dissolving a subcategory, not nesting', () => {
    const parent = cat({ id: 'food-group', parentId: null });
    const child = cat({ id: 'groceries', parentId: 'food-group' });
    // survivor = parent, loser = child (the opposite direction from the
    // blocked case above) — parent.parentId stays null, untouched by the
    // cascade since it only rewrites rows whose parent_id equals loser.id.
    expect(categoryMergeBlockedReason(parent, child, [parent, child])).toBeNull();
  });

  it('ignores archived children when checking whether the loser has children', () => {
    const survivor = cat({ id: 'groceries', parentId: 'food' });
    const loser = cat({ id: 'transport', parentId: null });
    const archivedChild = cat({ id: 'fuel', parentId: 'transport', archived: true });
    expect(categoryMergeBlockedReason(survivor, loser, [survivor, loser, archivedChild])).toBeNull();
  });

  it('treats merging a row into itself as blocked', () => {
    const c = cat({ id: 'food' });
    expect(categoryMergeBlockedReason(c, c, [c])).toBe('Already the keeper.');
  });
});

describe('crossOwnerLosers', () => {
  it('returns an empty array when every loser shares the survivor\'s owner', () => {
    const survivor = acct({ id: 'a1', ownerUserId: 'owner-1' });
    const losers = [acct({ id: 'a2', ownerUserId: 'owner-1' }), acct({ id: 'a3', ownerUserId: 'owner-1' })];
    expect(crossOwnerLosers(survivor, losers)).toEqual([]);
  });

  it('returns only the losers owned by someone else', () => {
    const survivor = acct({ id: 'a1', ownerUserId: 'owner-1' });
    const sameOwner = acct({ id: 'a2', ownerUserId: 'owner-1' });
    const otherOwner = acct({ id: 'a3', ownerUserId: 'owner-2' });
    expect(crossOwnerLosers(survivor, [sameOwner, otherOwner])).toEqual([otherOwner]);
  });

  it('handles 3+ distinct owners among the losers', () => {
    const survivor = acct({ id: 'a1', ownerUserId: 'owner-1' });
    const losers = [
      acct({ id: 'a2', ownerUserId: 'owner-2' }),
      acct({ id: 'a3', ownerUserId: 'owner-3' }),
      acct({ id: 'a4', ownerUserId: 'owner-1' }),
    ];
    expect(crossOwnerLosers(survivor, losers)).toEqual([losers[0], losers[1]]);
  });
});

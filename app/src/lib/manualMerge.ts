import type { Account, Category } from './types';

// Backlog 2026-08-23 — the manual, user-triggered "merge duplicates" tool
// (AccountsScreen/CategoriesScreen). Pure validation only: the actual
// merge write lives in store.tsx (mergeCategories/mergeAccounts), which
// trusts its input — these functions are what keep the picker from ever
// offering an illegal combination in the first place.

// docs/14 D70's 2-level cap: categories are a parent or a child, never a
// grandchild. Merging survivor <- loser reparents every one of loser's
// own children onto survivor (mergeCategoryInto's cascade) — if survivor
// is itself a child, that would create a grandchild. Also guards the
// (impossible-in-practice but cheap to check) case of merging a category
// into its own parent, which would leave survivor.parentId pointing at a
// row that's about to be deleted.
export function categoryMergeBlockedReason(
  survivor: Category,
  loser: Category,
  categories: Category[],
): string | null {
  if (loser.id === survivor.id) return 'Already the keeper.';
  if (survivor.parentId === loser.id) return "Can't merge a group into its own subcategory.";
  const loserHasChildren = categories.some((c) => !c.archived && c.parentId === loser.id);
  if (loserHasChildren && survivor.parentId !== null) {
    return "Has subcategories — can't merge into a subcategory (would nest 3 levels deep).";
  }
  return null;
}

export function canMergeCategoryIntoSurvivor(survivor: Category, loser: Category, categories: Category[]): boolean {
  return categoryMergeBlockedReason(survivor, loser, categories) === null;
}

// Cross-owner account merges are allowed (household data reassignment can
// be a real, deliberate choice), never blocked — this just tells the
// confirmation UI which of the picked duplicates need the "owned by
// someone else" warning line.
export function crossOwnerLosers(survivor: Account, losers: Account[]): Account[] {
  return losers.filter((l) => l.ownerUserId !== survivor.ownerUserId);
}

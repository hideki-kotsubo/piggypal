import { useState } from 'react';
import { useStore } from '../lib/store';
import type { Category } from '../lib/types';

interface Props {
  selectedId: string | null;
  onPick: (categoryId: string) => void;
}

// Shared between EntryZone, InboxScreen, and TransactionEditForm — three
// call sites that previously each rendered store.rankedCategories() as
// their own flat chip row. This is chip-row rendering only: whether it's
// always visible (EntryZone/InboxScreen) or hidden behind a toggle pill
// (TransactionEditForm) stays each caller's own concern, same as before.
//
// docs/14 — unlike AccountCurrencyPicker's institution grouping (inferred
// from accounts sharing a name at scale), category grouping is authored:
// the user deliberately assigns a parent in CategoriesScreen. So there's
// no scale threshold or Grouped/Capped mode here — the picker just
// reflects whatever hierarchy exists. A category with children collapses
// to a tap-to-expand row; the group itself is selectable as the first
// chip inside its expanded body (D71), not on the collapsed row — that
// keeps the collapsed chip single-purpose (expand) like the account
// picker's, rather than inventing a two-target chip for this pass.
export function CategoryPicker({ selectedId, onPick }: Props) {
  const store = useStore();
  const [expandedGroups, setExpandedGroups] = useState<Set<string> | null>(null);

  const ranked = store.rankedCategories();

  const byParent = new Map<string, Category[]>();
  for (const c of ranked) {
    if (!c.parentId) continue;
    const arr = byParent.get(c.parentId) ?? [];
    arr.push(c);
    byParent.set(c.parentId, arr);
  }

  // Preserves rankedCategories' frequency order: a group's position is
  // wherever its first (most-used) member — itself or a child — appears.
  const groups: { category: Category; children: Category[] }[] = [];
  const plain: Category[] = [];
  const seenGroupIds = new Set<string>();
  for (const c of ranked) {
    const parentId = c.parentId;
    if (parentId) {
      if (!seenGroupIds.has(parentId)) {
        seenGroupIds.add(parentId);
        const parent = store.categories.find((p) => p.id === parentId);
        if (parent) groups.push({ category: parent, children: byParent.get(parentId) ?? [] });
      }
      continue;
    }
    const children = byParent.get(c.id) ?? [];
    if (children.length > 0) {
      if (!seenGroupIds.has(c.id)) {
        seenGroupIds.add(c.id);
        groups.push({ category: c, children });
      }
    } else {
      plain.push(c);
    }
  }

  // The group containing the current selection (or that IS the current
  // selection) starts expanded — same rule as AccountCurrencyPicker.
  const effectiveExpanded =
    expandedGroups ??
    new Set(
      groups
        .filter((g) => g.category.id === selectedId || g.children.some((c) => c.id === selectedId))
        .map((g) => g.category.id),
    );

  function toggleGroup(id: string) {
    const next = new Set(effectiveExpanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedGroups(next);
  }

  return (
    <div className="chip-row">
      {groups.map((g) => {
        const isOpen = effectiveExpanded.has(g.category.id);
        return isOpen ? (
          <div className="picker-group" key={g.category.id}>
            <button className="picker-group-head" onClick={() => toggleGroup(g.category.id)}>
              <span className="chev">▾</span> {g.category.name}
            </button>
            <div className="chip-row">
              <button
                className={`chip ${g.category.id === selectedId ? 'picked' : ''}`}
                onClick={() => onPick(g.category.id)}
              >
                {g.category.name}
              </button>
              {g.children.map((c) => (
                <button
                  key={c.id}
                  className={`chip ${c.id === selectedId ? 'picked' : ''}`}
                  onClick={() => onPick(c.id)}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <button className="chip" key={g.category.id} onClick={() => toggleGroup(g.category.id)}>
            {g.category.name} ▸ {g.children.length}
          </button>
        );
      })}
      {plain.map((c) => (
        <button
          key={c.id}
          className={`chip ${c.id === selectedId ? 'picked' : ''}`}
          onClick={() => onPick(c.id)}
        >
          {c.name}
        </button>
      ))}
    </div>
  );
}

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useStore } from '../lib/store';
import { uiLocale } from '../lib/i18n';
import { categoryLabel } from '../lib/starterLabels';
import { formatAmount, nowUtc } from '../lib/format';
import { canMergeCategoryIntoSurvivor, categoryMergeBlockedReason } from '../lib/manualMerge';
import { categoryMonthTotals, currentMonthKey, type CategoryMonth } from '../lib/activity';
import type { Budget, Category } from '../lib/types';

type CategoryKind = Category['kind'];
import { BottomSheet } from './BottomSheet';

// Local date construction, not toISOString() — that's UTC and would land
// on the wrong month for anyone in a positive-UTC-offset timezone.
const _now = new Date();
const currentMonth = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-01`;

type Sheet = { type: 'edit'; id: string } | { type: 'create'; parentId: string | null } | null;

// Backlog 2026-08-23's manual merge-duplicates tool — same shape as
// AccountsScreen's own MergeState.
type MergeState =
  | { step: 'off' }
  | { step: 'picking'; survivorId: string | null; loserIds: Set<string> }
  | { step: 'review'; survivorId: string; loserIds: string[] };

// docs/14: children sort right after their parent so the hierarchy is
// visible at a glance. A child whose parent got archived out from under it
// (archiving doesn't cascade) falls back to the end of the list rather
// than disappearing silently.
function orderedWithChildren(list: Category[]): Category[] {
  const ids = new Set(list.map((c) => c.id));
  const byParent = new Map<string, Category[]>();
  const orphans: Category[] = [];
  for (const c of list) {
    if (!c.parentId) continue;
    if (!ids.has(c.parentId)) {
      orphans.push(c);
      continue;
    }
    const arr = byParent.get(c.parentId) ?? [];
    arr.push(c);
    byParent.set(c.parentId, arr);
  }
  const result: Category[] = [];
  for (const c of list) {
    if (c.parentId) continue;
    result.push(c, ...(byParent.get(c.id) ?? []));
  }
  result.push(...orphans);
  return result;
}

// docs/79 C1 — a group with subcategories gets its own card; runs of
// categories without any share one card, keeping the list's order.
type Block = { type: 'group'; parent: Category; children: Category[] } | { type: 'singles'; items: Category[] };

function toBlocks(ordered: Category[]): Block[] {
  const blocks: Block[] = [];
  for (const c of ordered) {
    const group = c.parentId ? blocks.findLast((b) => b.type === 'group' && b.parent.id === c.parentId) : undefined;
    if (group?.type === 'group') {
      group.children.push(c);
      continue;
    }
    const hasChildren = ordered.some((o) => o.parentId === c.id);
    if (hasChildren) {
      blocks.push({ type: 'group', parent: c, children: [] });
      continue;
    }
    const last = blocks[blocks.length - 1];
    if (last?.type === 'singles') last.items.push(c);
    else blocks.push({ type: 'singles', items: [c] });
  }
  return blocks;
}

export function CategoriesScreen() {
  const store = useStore();
  const { t } = useTranslation();
  const [tab, setTab] = useState<CategoryKind>('expense');
  const [sheet, setSheet] = useState<Sheet>(null);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [mergeState, setMergeState] = useState<MergeState>({ step: 'off' });

  const active = store.categories.filter((c) => !c.archived);
  const archived = store.categories.filter((c) => c.archived);
  const ofKind = (kind: CategoryKind) => orderedWithChildren(active.filter((c) => c.kind === kind));
  const listed = ofKind(tab);
  const kindById = new Map(store.categories.map((c) => [c.id, c.kind]));
  const month = categoryMonthTotals(
    store.transactions.filter((tx) => !tx.deletedAt),
    (id) => kindById.get(id),
    currentMonthKey(),
  );
  const budgetsByCategory = new Map<string, Budget[]>();
  for (const b of store.budgets) {
    if (b.month !== currentMonth) continue;
    budgetsByCategory.set(b.categoryId, [...(budgetsByCategory.get(b.categoryId) ?? []), b]);
  }
  const monthName = new Intl.DateTimeFormat(uiLocale(), { month: 'long' }).format(_now);

  function toggleMergeMode() {
    setSheet(null);
    setMergeState((m) => (m.step === 'off' ? { step: 'picking', survivorId: null, loserIds: new Set() } : { step: 'off' }));
  }

  function handleMergeTap(category: Category) {
    if (mergeState.step !== 'picking') return;
    if (mergeState.survivorId === null) {
      setMergeState({ ...mergeState, survivorId: category.id });
      return;
    }
    if (category.id === mergeState.survivorId) return;
    const survivor = active.find((c) => c.id === mergeState.survivorId);
    if (!survivor || !canMergeCategoryIntoSurvivor(survivor, category, store.categories)) return;
    const next = new Set(mergeState.loserIds);
    if (next.has(category.id)) next.delete(category.id);
    else next.add(category.id);
    setMergeState({ ...mergeState, loserIds: next });
  }

  function changeKeeper() {
    setMergeState({ step: 'picking', survivorId: null, loserIds: new Set() });
  }

  function reviewMerge() {
    if (mergeState.step !== 'picking' || !mergeState.survivorId || mergeState.loserIds.size === 0) return;
    setMergeState({ step: 'review', survivorId: mergeState.survivorId, loserIds: [...mergeState.loserIds] });
  }

  async function confirmMerge() {
    if (mergeState.step !== 'review') return;
    await store.mergeCategories(mergeState.survivorId, mergeState.loserIds);
    setMergeState({ step: 'off' });
  }

  // docs/79 D308 — archiving only hides a category from pickers; past
  // transactions keep it. Restoring clears the flag, after asking.
  function restore(category: Category) {
    if (!window.confirm(t('categories.restoreConfirm', { name: categoryLabel(category) }))) return;
    store.updateCategory(category.id, { archived: false });
  }

  const txCountForCategory = (categoryId: string) =>
    store.transactions.filter((tx) => !tx.deletedAt && tx.categoryId === categoryId).length;
  const childCountForCategory = (categoryId: string) =>
    store.categories.filter((c) => !c.archived && c.parentId === categoryId).length;

  function renderMergeRow(category: Category) {
    const isSurvivor = mergeState.step === 'picking' && mergeState.survivorId === category.id;
    const isPicked = mergeState.step === 'picking' && mergeState.loserIds.has(category.id);
    const survivor = mergeState.step === 'picking' && mergeState.survivorId ? active.find((c) => c.id === mergeState.survivorId) : null;
    const blockedReason = survivor && !isSurvivor ? categoryMergeBlockedReason(survivor, category, store.categories) : null;
    return (
      <button
        key={category.id}
        className={`category-row ${category.parentId ? 'child' : ''} ${isSurvivor ? 'picked-survivor' : ''} ${isPicked ? 'picked-duplicate' : ''} ${blockedReason ? 'merge-disabled' : ''}`}
        disabled={isSurvivor || !!blockedReason}
        onClick={() => handleMergeTap(category)}
      >
        <span className="category-row-top">
          <span className="category-name">
            {isSurvivor && <span className="merge-badge">{t('duplicates.keeper')}</span>}
            {!isSurvivor && survivor && !blockedReason && <span className="merge-check">{isPicked ? '✓' : '○'}</span>}
            {category.parentId ? `↳ ${categoryLabel(category)}` : categoryLabel(category)}
          </span>
        </span>
        {blockedReason && <span className="merge-disabled-note">{blockedReason}</span>}
      </button>
    );
  }

  // docs/79 D307 — budgets only on categories without subcategories, so a
  // group row never gets a bar; these rows are always leaves.
  function renderLeaf(category: Category, isChild: boolean) {
    const totals = month.get(category.id)?.totals ?? new Map<string, number>();
    const budgets = category.kind === 'expense' ? (budgetsByCategory.get(category.id) ?? []) : [];
    const unbudgeted = [...totals.entries()].filter(([currency]) => !budgets.some((b) => b.currency === currency));
    return (
      <button key={category.id} className={`category-row ${isChild ? 'child' : ''}`} onClick={() => setSheet({ type: 'edit', id: category.id })}>
        <span className="category-row-top">
          <span className="category-name">{categoryLabel(category)}</span>
          {unbudgeted.length > 0 && (
            <span className="category-amounts">
              {unbudgeted.map(([currency, cents]) => formatAmount(cents, currency)).join(' · ')}
            </span>
          )}
        </span>
        {budgets.map((b) => {
          const spent = totals.get(b.currency) ?? 0;
          const over = spent > b.amountCents;
          const pct = b.amountCents > 0 ? Math.min(100, (spent / b.amountCents) * 100) : spent > 0 ? 100 : 0;
          return (
            <span className="category-budget" key={b.id}>
              <span className={`category-budget-amounts ${over ? 'over' : ''}`}>
                {t('categories.spentOf', { spent: formatAmount(spent, b.currency), budget: formatAmount(b.amountCents, b.currency) })}
              </span>
              <span className="track" aria-hidden="true">
                <span className={`fill ${over ? 'over' : ''}`} style={{ width: `${pct}%` }} />
              </span>
            </span>
          );
        })}
      </button>
    );
  }

  const sheetCategory = sheet?.type === 'edit' ? store.categories.find((c) => c.id === sheet.id) : undefined;
  const sheetParent = sheet?.type === 'create' && sheet.parentId ? store.categories.find((c) => c.id === sheet.parentId) : undefined;

  return (
    <main className="home">
      <div className="app-bar">
        <Link to="/settings" className="back-link">← {t('common.back')}</Link>
        <span className="wordmark">{t('categories.title')}</span>
        <div className="app-bar-actions">
          {mergeState.step === 'off' && active.length >= 2 && (
            <button className="icon-btn" aria-label={t('accounts.mergeDuplicates')} onClick={toggleMergeMode}>⇄</button>
          )}
          {mergeState.step === 'off' && (
            <button className="icon-btn" aria-label={t('categories.add')} onClick={() => setSheet({ type: 'create', parentId: null })}>
              +
            </button>
          )}
        </div>
      </div>

      {mergeState.step === 'picking' &&
        (() => {
          const survivor = mergeState.survivorId ? active.find((c) => c.id === mergeState.survivorId) : null;
          return (
            <div className="merge-toolbar">
              <span>
                {!survivor
                  ? t('accounts.pickKeeper')
                  : mergeState.loserIds.size === 0
                    ? t('accounts.pickDuplicates', { name: categoryLabel(survivor) })
                    : t('accounts.willMerge', { count: mergeState.loserIds.size, name: categoryLabel(survivor) })}
              </span>
              <div className="chip-row">
                {survivor && <button className="chip ghost" onClick={changeKeeper}>{t('accounts.changeKeeper')}</button>}
                {survivor && mergeState.loserIds.size > 0 && (
                  <button className="save-btn" onClick={reviewMerge}>{t('accounts.reviewMerge')}</button>
                )}
                <button className="chip ghost" onClick={() => setMergeState({ step: 'off' })}>{t('common.cancel')}</button>
              </div>
            </div>
          );
        })()}

      {mergeState.step === 'review' &&
        (() => {
          const survivor = store.categories.find((c) => c.id === mergeState.survivorId)!;
          const losers = mergeState.loserIds.map((id) => store.categories.find((c) => c.id === id)!).filter(Boolean);
          return (
            <div className="merge-review">
              <p className="section-label">{t('accounts.mergeInto', { count: losers.length, name: categoryLabel(survivor) })}</p>
              <div className="merge-conflicts">
                <div className="merge-conflict">
                  <p className="merge-conflict-title">{t('accounts.keeping', { name: categoryLabel(survivor) })}</p>
                  <p className="merge-conflict-detail">{t('accounts.nothingChanges')}</p>
                </div>
                {losers.map((loser) => {
                  const n = txCountForCategory(loser.id);
                  const childN = childCountForCategory(loser.id);
                  return (
                    <div className="merge-conflict" key={loser.id}>
                      <p className="merge-conflict-title">{t('accounts.foldingIn', { name: categoryLabel(loser) })}</p>
                      <p className="merge-conflict-detail">
                        {t('categories.movesTo', { transactions: t('transactions.count', { count: n }), name: categoryLabel(survivor) })}
                      </p>
                      {childN > 0 && (
                        <p className="merge-conflict-detail">
                          {t('categories.childrenMove', { count: childN, name: categoryLabel(survivor) })}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
              <button className="save-btn" onClick={() => void confirmMerge()}>{t('accounts.merge', { count: losers.length })}</button>
              <button className="chip ghost" onClick={() => setMergeState({ step: 'off' })}>{t('common.cancel')}</button>
            </div>
          );
        })()}

      {mergeState.step !== 'review' && (
        <>
          {/* A merge only works within one kind, so once a keeper is
              picked the switch follows it. */}
          <div className="segmented list-segmented" role="tablist" aria-label={t('categories.kind')}>
            {(['expense', 'income'] as const).map((kind) => {
              const keeperKind =
                mergeState.step === 'picking' && mergeState.survivorId ? kindById.get(mergeState.survivorId) : undefined;
              const selected = (keeperKind ?? tab) === kind;
              return (
                <button
                  key={kind}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  className={selected ? 'on' : ''}
                  disabled={keeperKind !== undefined && keeperKind !== kind}
                  onClick={() => setTab(kind)}
                >
                  {t(kind === 'expense' ? 'categories.expense' : 'categories.income')} · {ofKind(kind).length}
                </button>
              );
            })}
          </div>

          {mergeState.step === 'picking' ? (
            <div className="category-cards">
              <section className="category-card">
                {ofKind((mergeState.survivorId && kindById.get(mergeState.survivorId)) || tab).map(renderMergeRow)}
              </section>
            </div>
          ) : (
            <>
              <p className="category-month-note">
                {t(tab === 'expense' ? 'categories.spentIn' : 'categories.receivedIn', { month: monthName })}
              </p>
              <div className="category-cards">
                {listed.length === 0 && (
                  <p className="empty-note">{t(tab === 'expense' ? 'categories.noExpense' : 'categories.noIncome')}</p>
                )}
                {toBlocks(listed).map((block) =>
                  block.type === 'singles' ? (
                    <section className="category-card" key={block.items[0].id}>
                      {block.items.map((c) => renderLeaf(c, false))}
                    </section>
                  ) : (
                    <section className="category-card" key={block.parent.id} aria-label={categoryLabel(block.parent)}>
                      <button className="category-group-head" onClick={() => setSheet({ type: 'edit', id: block.parent.id })}>
                        <span className="category-name">{categoryLabel(block.parent)}</span>
                        <GroupTotal month={month.get(block.parent.id)} childMonths={block.children.map((c) => month.get(c.id))} />
                      </button>
                      <div className="category-children">
                        {block.children.map((c) => renderLeaf(c, true))}
                        <button className="category-add-sub" onClick={() => setSheet({ type: 'create', parentId: block.parent.id })}>
                          {t('categories.addTo', { name: categoryLabel(block.parent) })}
                        </button>
                      </div>
                    </section>
                  ),
                )}
              </div>
            </>
          )}
        </>
      )}

      {mergeState.step === 'off' && archived.length > 0 && (
        <div className="archived-section">
          <button className="group-header" aria-expanded={archivedOpen} onClick={() => setArchivedOpen((o) => !o)}>
            <span>{t('accounts.archived', { count: archived.length })}</span>
            <span className="group-count">{archivedOpen ? '▾' : '›'}</span>
          </button>
          {archivedOpen && (
            <section className="category-card">
              {archived.map((c) => (
                <div className="category-row archived-row" key={c.id}>
                  <span className="category-row-top">
                    <span className="category-archived-text">
                      <span className="category-name">{categoryLabel(c)}</span>
                      <span className="category-sub">{c.kind === 'expense' ? t('categories.expense') : t('categories.income')}</span>
                    </span>
                    <button type="button" className="chip restore-chip" onClick={() => restore(c)}>
                      {t('common.restore')}
                    </button>
                  </span>
                </div>
              ))}
            </section>
          )}
          {archivedOpen && <p className="category-month-note">{t('categories.archivedHint')}</p>}
        </div>
      )}

      {sheet?.type === 'edit' && sheetCategory && (
        <BottomSheet title={categoryLabel(sheetCategory)} eyebrow={t('categories.editing')} onClose={() => setSheet(null)}>
          <CategoryForm
            key={sheetCategory.id}
            category={sheetCategory}
            month={month.get(sheetCategory.id)}
            onDone={() => setSheet(null)}
            onAddSubcategory={(parentId) => setSheet({ type: 'create', parentId })}
          />
        </BottomSheet>
      )}

      {sheet?.type === 'create' && (
        <BottomSheet
          title={sheetParent ? t('categories.newSub', { name: categoryLabel(sheetParent) }) : t('categories.new')}
          onClose={() => setSheet(null)}
        >
          <CategoryForm
            key={`new:${sheet.parentId ?? ''}`}
            category={null}
            initialParentId={sheet.parentId}
            initialKind={tab}
            onDone={() => setSheet(null)}
          />
        </BottomSheet>
      )}
    </main>
  );
}

// A group's own row shows what its subcategories (and itself) spent this
// month, per currency — a plain total, not a budget (D307).
function GroupTotal({ month, childMonths }: { month: CategoryMonth | undefined; childMonths: (CategoryMonth | undefined)[] }) {
  const totals = new Map<string, number>();
  for (const m of [month, ...childMonths]) {
    for (const [currency, cents] of m?.totals ?? []) totals.set(currency, (totals.get(currency) ?? 0) + cents);
  }
  if (totals.size === 0) return null;
  return <span className="category-amounts">{[...totals.entries()].map(([c, cents]) => formatAmount(cents, c)).join(' · ')}</span>;
}

function CategoryForm({
  category,
  onDone,
  month,
  initialParentId = null,
  initialKind = 'expense',
  onAddSubcategory,
}: {
  category: Category | null;
  onDone: () => void;
  month?: CategoryMonth;
  initialParentId?: string | null;
  initialKind?: CategoryKind;
  onAddSubcategory?: (parentId: string) => void;
}) {
  const store = useStore();
  const { t } = useTranslation();
  const isNew = category === null;

  const [draft, setDraft] = useState<Category>(() => {
    if (category) return category;
    const parent = initialParentId ? store.categories.find((p) => p.id === initialParentId) : null;
    return {
      id: '',
      name: '',
      kind: parent?.kind ?? initialKind,
      parentId: initialParentId,
      archived: false,
      updatedAt: nowUtc(),
    };
  });
  const current: Category = category ?? draft;
  const [nameStr, setNameStr] = useState(() => (isNew ? current.name : categoryLabel(current)));

  const hasChildren = !isNew && store.categories.some((c) => !c.archived && c.parentId === current.id);
  const eligibleParents = store.categories.filter(
    (c) => !c.archived && !c.parentId && c.kind === current.kind && c.id !== current.id,
  );

  function commit(patch: Partial<Category>) {
    if (isNew) setDraft((d) => ({ ...d, ...patch }));
    else store.updateCategory(current.id, patch);
  }

  function saveNew() {
    if (!current.name.trim()) return;
    store.addCategory({ ...draft, id: crypto.randomUUID() });
    onDone();
  }

  function archive() {
    if (isNew) return;
    store.updateCategory(current.id, { archived: true });
    onDone();
  }

  return (
    <div className="account-form">
      {!isNew && (
        <div className="sheet-stat">
          <span>
            {month && month.totals.size > 0
              ? t('categories.monthStat', {
                  amount: [...month.totals.entries()].map(([c, cents]) => formatAmount(cents, c)).join(' · '),
                  entries: t('categories.entries', { count: month.count }),
                })
              : t('categories.monthStatNone')}
          </span>
          {month && month.count > 0 && (
            <Link to={`/transactions?category=${encodeURIComponent(current.id)}`} className="section-link">
              {t('categories.seeThem')}
            </Link>
          )}
        </div>
      )}

      <label className="field-label">
        {t('common.name')}
        <input
          className="text-input"
          placeholder={t('categories.namePlaceholder')}
          value={nameStr}
          onChange={(e) => {
            setNameStr(e.target.value);
            commit({ name: e.target.value });
          }}
        />
      </label>

      <div>
        <div className="field-label">{t('categories.kind')}</div>
        <div className="segmented" role="radiogroup" aria-label={t('categories.kind')}>
          {(['expense', 'income'] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={k === current.kind}
              className={k === current.kind ? 'on' : ''}
              onClick={() => {
                if (k !== current.kind) commit({ kind: k, parentId: null });
              }}
            >
              {k === 'expense' ? t('categories.expense') : t('categories.income')}
            </button>
          ))}
        </div>
      </div>

      {/* Only a category without subcategories can sit inside a group
          (D70's 2-level cap). */}
      {!hasChildren && (
        <div>
          <div className="field-label">{t('categories.group')}</div>
          <div className="chip-row">
            <button className={`chip ${current.parentId === null ? 'picked' : ''}`} onClick={() => commit({ parentId: null })}>
              {t('categories.topLevel')}
            </button>
            {eligibleParents.map((p) => (
              <button key={p.id} className={`chip ${current.parentId === p.id ? 'picked' : ''}`} onClick={() => commit({ parentId: p.id })}>
                {categoryLabel(p)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* D74/D307: hidden for a category with children — budgets live only
          on categories without subcategories. */}
      {!isNew && current.kind === 'expense' && !hasChildren && <BudgetsForCategory categoryId={current.id} />}

      {/* Only a top-level category can take children (D70's 2-level cap). */}
      {!isNew && !current.parentId && onAddSubcategory && (
        <button className="text-link" onClick={() => onAddSubcategory(current.id)}>
          {t('categories.addSub')}
        </button>
      )}

      {isNew ? (
        <div className="form-actions sheet-actions">
          <button className="chip ghost" onClick={onDone}>{t('common.cancelLower')}</button>
          <button className="save-btn" onClick={saveNew} disabled={!current.name.trim()}>{t('categories.add')}</button>
        </div>
      ) : (
        <div className="form-actions sheet-actions">
          <button className="text-link archive-link" onClick={archive}>{t('categories.archive')}</button>
        </div>
      )}
    </div>
  );
}

function BudgetsForCategory({ categoryId }: { categoryId: string }) {
  const store = useStore();
  const { t } = useTranslation();
  const [addOpen, setAddOpen] = useState(false);
  const [currencyPickerOpen, setCurrencyPickerOpen] = useState(false);
  const [newCurrency, setNewCurrency] = useState('CAD');
  const [newAmountStr, setNewAmountStr] = useState('');

  const budgets = store.budgets.filter((b) => b.categoryId === categoryId && b.month === currentMonth);
  // Accounts don't carry a currency (see Account) — offer whatever
  // currencies are actually in use across transactions/budgets, plus
  // sensible defaults, same pattern as the account/currency picker.
  const currencyOptions = [
    ...new Set([
      newCurrency,
      ...store.transactions.map((tx) => tx.currency),
      ...store.budgets.map((b) => b.currency),
      'CAD',
      'BRL',
      'USD',
    ]),
  ];

  function amountStrFor(b: Budget) {
    return String(b.amountCents / 100);
  }

  function updateAmount(b: Budget, str: string) {
    const n = parseFloat(str);
    if (Number.isFinite(n) && n >= 0) store.updateBudget(b.id, { amountCents: Math.round(n * 100) });
  }

  function addBudget() {
    const n = parseFloat(newAmountStr);
    if (!Number.isFinite(n) || n < 0) return;
    store.addBudget({
      id: crypto.randomUUID(),
      categoryId,
      month: currentMonth,
      currency: newCurrency,
      amountCents: Math.round(n * 100),
      updatedAt: nowUtc(),
    });
    setNewAmountStr('');
    setAddOpen(false);
  }

  return (
    <div className="goal-section">
      <div className="field-label">{t('categories.monthBudget')}</div>

      {budgets.map((b) => (
        <div className="goal-box" key={b.id}>
          <div className="goal-box-top">
            <span className="budget-currency-tag">{b.currency}</span>
            <input
              className="text-input budget-amount-input"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              defaultValue={amountStrFor(b)}
              onChange={(e) => updateAmount(b, e.target.value)}
            />
            <button className="text-link" onClick={() => store.removeBudget(b.id)}>{t('categories.removeLower')}</button>
          </div>
        </div>
      ))}

      {!addOpen && (
        <button className="text-link" onClick={() => setAddOpen(true)}>{t('categories.addBudget')}</button>
      )}

      {addOpen && (
        <div className="goal-fields">
          <button className="pill-tap" onClick={() => setCurrencyPickerOpen((o) => !o)}>
            {newCurrency} ▾
          </button>
          {currencyPickerOpen && (
            <div className="chip-row">
              {currencyOptions.map((c) => (
                <button
                  key={c}
                  className={`chip ${c === newCurrency ? 'picked' : ''}`}
                  onClick={() => {
                    setNewCurrency(c);
                    setCurrencyPickerOpen(false);
                  }}
                >
                  {c}
                </button>
              ))}
            </div>
          )}
          <input
            className="text-input"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            placeholder="0.00"
            value={newAmountStr}
            onChange={(e) => setNewAmountStr(e.target.value)}
          />
          <div className="form-actions">
            <button className="chip ghost" onClick={() => setAddOpen(false)}>{t('common.cancelLower')}</button>
            <button className="save-btn" onClick={addBudget}>{t('common.add')}</button>
          </div>
        </div>
      )}
    </div>
  );
}

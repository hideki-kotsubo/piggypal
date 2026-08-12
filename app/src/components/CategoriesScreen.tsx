import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../lib/store';
import type { Budget, Category } from '../lib/types';

// Local date construction, not toISOString() — that's UTC and would land
// on the wrong month for anyone in a positive-UTC-offset timezone.
const _now = new Date();
const currentMonth = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-01`;

type OpenPanel = { type: 'edit'; id: string } | { type: 'create'; parentId: string | null } | null;

// docs/14: no full collapse/expand grouping here (that solved the picker's
// crowding problem, docs/13-style) — this is a management list, not a
// quick-pick, so a lighter touch is enough: children sort right after
// their parent and get a "↳" prefix so the hierarchy is visible at a
// glance. A child whose parent got archived out from under it (archiving
// doesn't cascade) falls back to the end of the list rather than
// disappearing silently.
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

export function CategoriesScreen() {
  const store = useStore();
  const [openPanel, setOpenPanel] = useState<OpenPanel>(null);
  const [archivedOpen, setArchivedOpen] = useState(false);

  const active = store.categories.filter((c) => !c.archived);
  const archived = store.categories.filter((c) => c.archived);
  const expense = orderedWithChildren(active.filter((c) => c.kind === 'expense'));
  const income = orderedWithChildren(active.filter((c) => c.kind === 'income'));

  function toggleRow(id: string) {
    setOpenPanel((p) => (p?.type === 'edit' && p.id === id ? null : { type: 'edit', id }));
  }

  function renderRow(category: Category) {
    const isEditing = openPanel?.type === 'edit' && openPanel.id === category.id;
    return (
      <div className="account-block" key={category.id}>
        <button className="account-row" onClick={() => toggleRow(category.id)}>
          <div className="account-row-top">
            <span className="account-name">{category.parentId ? `↳ ${category.name}` : category.name}</span>
          </div>
        </button>
        {isEditing && (
          <div className="account-edit">
            <CategoryForm
              category={category}
              onDone={() => setOpenPanel(null)}
              onAddSubcategory={(parentId) => setOpenPanel({ type: 'create', parentId })}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <main className="home">
      <div className="app-bar">
        <Link to="/settings" className="back-link">← Back</Link>
        <span className="wordmark">Categories</span>
        <button
          className="icon-btn"
          aria-label="Add category"
          onClick={() => setOpenPanel((p) => (p?.type === 'create' ? null : { type: 'create', parentId: null }))}
        >
          +
        </button>
      </div>

      {openPanel?.type === 'create' && (
        <section className="account-create">
          <div className="section-label">
            {openPanel.parentId
              ? `New subcategory of ${store.categories.find((c) => c.id === openPanel.parentId)?.name ?? '…'}`
              : 'New category'}
          </div>
          <CategoryForm
            category={null}
            initialParentId={openPanel.parentId}
            onDone={() => setOpenPanel(null)}
          />
        </section>
      )}

      <div className="accounts-list">
        <div className="section-label">Expense</div>
        {expense.length === 0 && <p className="empty-note">No expense categories yet.</p>}
        {expense.map(renderRow)}

        <div className="section-label">Income</div>
        {income.length === 0 && <p className="empty-note">No income categories yet.</p>}
        {income.map(renderRow)}
      </div>

      {archived.length > 0 && (
        <div className="account-group">
          <button className="group-header" onClick={() => setArchivedOpen((o) => !o)}>
            <span>Archived ({archived.length})</span>
            <span className="group-count">{archivedOpen ? '▾' : '›'}</span>
          </button>
          {archivedOpen &&
            archived.map((c) => (
              <div className="account-row archived-row" key={c.id}>
                <div className="account-row-top">
                  <span className="account-name">{c.name}</span>
                  <span className="account-kind">{c.kind}</span>
                </div>
              </div>
            ))}
        </div>
      )}
    </main>
  );
}

function CategoryForm({
  category,
  onDone,
  initialParentId = null,
  onAddSubcategory,
}: {
  category: Category | null;
  onDone: () => void;
  // Set when opened via a parent's own "+ Add subcategory" (below) — lets
  // creating a subcategory skip hunting for its parent in the Group chip
  // row, matching how it's reached: from the parent itself.
  initialParentId?: string | null;
  onAddSubcategory?: (parentId: string) => void;
}) {
  const store = useStore();
  const isNew = category === null;

  const [draft, setDraft] = useState<Category>(() => {
    if (category) return category;
    // Subcategory inherits its parent's kind — a group and its children
    // are always the same kind (expense group, expense children).
    const parent = initialParentId ? store.categories.find((p) => p.id === initialParentId) : null;
    return { id: '', name: '', kind: parent?.kind ?? 'expense', parentId: initialParentId, archived: false };
  });
  const current: Category = category ?? draft;
  const [pickerOpen, setPickerOpen] = useState<'kind' | 'group' | null>(null);

  // docs/14 D70: exactly 2 levels, enforced app-side — a category that
  // already has children can't itself become a subcategory (no group
  // field offered), and an existing subcategory never appears as a
  // choice of parent for anyone else.
  const hasChildren = !isNew && store.categories.some((c) => !c.archived && c.parentId === current.id);
  const eligibleParents = store.categories.filter(
    (c) => !c.archived && !c.parentId && c.kind === current.kind && c.id !== current.id,
  );
  const parentCategory = current.parentId ? store.categories.find((c) => c.id === current.parentId) : null;

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
      <label className="field-label">
        Name
        <input
          className="text-input"
          placeholder="Mercado, Transporte, Salário…"
          value={current.name}
          onChange={(e) => commit({ name: e.target.value })}
        />
      </label>

      <div>
        <div className="field-label">Kind</div>
        <button className="pill-tap" onClick={() => setPickerOpen(pickerOpen === 'kind' ? null : 'kind')}>
          {current.kind === 'expense' ? 'Expense' : 'Income'} ▾
        </button>
        {pickerOpen === 'kind' && (
          <div className="chip-row">
            {(['expense', 'income'] as const).map((k) => (
              <button
                key={k}
                className={`chip ${k === current.kind ? 'picked' : ''}`}
                onClick={() => {
                  commit({ kind: k, parentId: null });
                  setPickerOpen(null);
                }}
              >
                {k === 'expense' ? 'Expense' : 'Income'}
              </button>
            ))}
          </div>
        )}
      </div>

      {!hasChildren && (
        <div>
          <div className="field-label">Group</div>
          <button className="pill-tap" onClick={() => setPickerOpen(pickerOpen === 'group' ? null : 'group')}>
            {parentCategory ? parentCategory.name : 'None (top-level)'} ▾
          </button>
          {pickerOpen === 'group' && (
            <div className="chip-row">
              <button
                className={`chip ${current.parentId === null ? 'picked' : ''}`}
                onClick={() => {
                  commit({ parentId: null });
                  setPickerOpen(null);
                }}
              >
                None (top-level)
              </button>
              {eligibleParents.map((p) => (
                <button
                  key={p.id}
                  className={`chip ${current.parentId === p.id ? 'picked' : ''}`}
                  onClick={() => {
                    commit({ parentId: p.id });
                    setPickerOpen(null);
                  }}
                >
                  {p.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* D74: hidden for a category with children — a group's budget would
          silently only count its own direct spend (no rollup this pass),
          which would look phantom/broken once it has subcategories. */}
      {!isNew && current.kind === 'expense' && !hasChildren && <BudgetsForCategory categoryId={current.id} />}

      {/* Only a top-level category can take children (D70's 2-level cap) —
          this is the direct "add from the parent" flow the Group field's
          own picker was the indirect alternative to. */}
      {!isNew && !current.parentId && onAddSubcategory && (
        <button className="text-link" onClick={() => onAddSubcategory(current.id)}>
          + Add subcategory
        </button>
      )}

      {isNew ? (
        <div className="form-actions">
          <button className="chip ghost" onClick={onDone}>cancel</button>
          <button className="save-btn" onClick={saveNew}>Add category</button>
        </div>
      ) : (
        <div className="form-actions">
          <button className="text-link archive-link" onClick={archive}>Archive category</button>
        </div>
      )}
    </div>
  );
}

function BudgetsForCategory({ categoryId }: { categoryId: string }) {
  const store = useStore();
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
      ...store.transactions.map((t) => t.currency),
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
    });
    setNewAmountStr('');
    setAddOpen(false);
  }

  return (
    <div className="goal-section">
      <div className="field-label">This month's budget</div>

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
            <button className="text-link" onClick={() => store.removeBudget(b.id)}>remove</button>
          </div>
        </div>
      ))}

      {!addOpen && (
        <button className="text-link" onClick={() => setAddOpen(true)}>+ Add a budget</button>
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
            <button className="chip ghost" onClick={() => setAddOpen(false)}>cancel</button>
            <button className="save-btn" onClick={addBudget}>Add</button>
          </div>
        </div>
      )}
    </div>
  );
}

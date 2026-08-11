import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../lib/store';
import type { Budget, Category } from '../lib/types';

// Local date construction, not toISOString() — that's UTC and would land
// on the wrong month for anyone in a positive-UTC-offset timezone.
const _now = new Date();
const currentMonth = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-01`;

type OpenPanel = { type: 'edit'; id: string } | { type: 'create' } | null;

export function CategoriesScreen() {
  const store = useStore();
  const [openPanel, setOpenPanel] = useState<OpenPanel>(null);
  const [archivedOpen, setArchivedOpen] = useState(false);

  const active = store.categories.filter((c) => !c.archived);
  const archived = store.categories.filter((c) => c.archived);
  const expense = active.filter((c) => c.kind === 'expense');
  const income = active.filter((c) => c.kind === 'income');

  function toggleRow(id: string) {
    setOpenPanel((p) => (p?.type === 'edit' && p.id === id ? null : { type: 'edit', id }));
  }

  function renderRow(category: Category) {
    const isEditing = openPanel?.type === 'edit' && openPanel.id === category.id;
    return (
      <div className="account-block" key={category.id}>
        <button className="account-row" onClick={() => toggleRow(category.id)}>
          <div className="account-row-top">
            <span className="account-name">{category.name}</span>
          </div>
        </button>
        {isEditing && (
          <div className="account-edit">
            <CategoryForm category={category} onDone={() => setOpenPanel(null)} />
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
          onClick={() => setOpenPanel((p) => (p?.type === 'create' ? null : { type: 'create' }))}
        >
          +
        </button>
      </div>

      {openPanel?.type === 'create' && (
        <section className="account-create">
          <div className="section-label">New category</div>
          <CategoryForm category={null} onDone={() => setOpenPanel(null)} />
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

function CategoryForm({ category, onDone }: { category: Category | null; onDone: () => void }) {
  const store = useStore();
  const isNew = category === null;

  const [draft, setDraft] = useState<Category>(
    () => category ?? { id: '', name: '', kind: 'expense', archived: false },
  );
  const current: Category = category ?? draft;
  const [pickerOpen, setPickerOpen] = useState(false);

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
        <button className="pill-tap" onClick={() => setPickerOpen((o) => !o)}>
          {current.kind === 'expense' ? 'Expense' : 'Income'} ▾
        </button>
        {pickerOpen && (
          <div className="chip-row">
            {(['expense', 'income'] as const).map((k) => (
              <button
                key={k}
                className={`chip ${k === current.kind ? 'picked' : ''}`}
                onClick={() => {
                  commit({ kind: k });
                  setPickerOpen(false);
                }}
              >
                {k === 'expense' ? 'Expense' : 'Income'}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Budgets are a spend-limit concept — doesn't apply to income categories */}
      {!isNew && current.kind === 'expense' && <BudgetsForCategory categoryId={current.id} />}

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

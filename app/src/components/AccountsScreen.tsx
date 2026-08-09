import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../lib/store';
import { accountLabel, formatAmount } from '../lib/format';
import type { Account, AccountKind } from '../lib/types';

// docs/12: name, kind, currency all read/write through the account fields
// directly — the kind list is fixed (D53's layout), not derived from usage.
const ACCOUNT_KINDS: AccountKind[] = ['checking', 'credit', 'cash', 'savings'];
const KIND_LABELS: Record<AccountKind, string> = {
  checking: 'Checking',
  credit: 'Credit',
  cash: 'Cash',
  savings: 'Savings',
};

function formatGoalDate(iso: string): string {
  const date = new Date(iso + 'T00:00:00');
  return new Intl.DateTimeFormat('en-CA', { month: 'short', year: 'numeric' }).format(date);
}

type OpenPanel = { type: 'edit'; id: string } | { type: 'create' } | null;

export function AccountsScreen() {
  const store = useStore();
  const [openPanel, setOpenPanel] = useState<OpenPanel>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string> | null>(null);
  const [archivedOpen, setArchivedOpen] = useState(false);

  const active = store.accounts.filter((a) => !a.archived);
  const archived = store.accounts.filter((a) => a.archived);

  // D59: list order is most-recently-used, derived from transaction history —
  // no stored sort_order. Same recency signal doc 07 derives for defaults.
  const recency = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of store.transactions) {
      if (t.deletedAt) continue;
      const cur = map.get(t.accountId);
      if (!cur || t.occurredOn > cur) map.set(t.accountId, t.occurredOn);
    }
    return map;
  }, [store.transactions]);

  const byRecency = (list: Account[]) =>
    [...list].sort((a, b) => (recency.get(b.id) ?? '').localeCompare(recency.get(a.id) ?? ''));

  // D60/D61: group by institution; ungrouped accounts list plainly, no header.
  const groups = useMemo(() => {
    const byInstitution = new Map<string, Account[]>();
    for (const a of active) {
      if (!a.institution) continue;
      const arr = byInstitution.get(a.institution) ?? [];
      arr.push(a);
      byInstitution.set(a.institution, arr);
    }
    const sortByRecency = (list: Account[]) =>
      [...list].sort((a, b) => (recency.get(b.id) ?? '').localeCompare(recency.get(a.id) ?? ''));
    return [...byInstitution.entries()]
      .map(([institution, accounts]) => ({ institution, accounts: sortByRecency(accounts) }))
      .sort((a, b) => (recency.get(b.accounts[0].id) ?? '').localeCompare(recency.get(a.accounts[0].id) ?? ''));
  }, [active, recency]);

  const ungrouped = byRecency(active.filter((a) => !a.institution));

  // Most-recently-used group expanded by default, others collapsed — a single
  // computed default, not re-derived after the user starts toggling groups.
  const effectiveExpandedGroups = expandedGroups ?? new Set(groups[0] ? [groups[0].institution] : []);

  function toggleGroup(institution: string) {
    const next = new Set(effectiveExpandedGroups);
    if (next.has(institution)) next.delete(institution);
    else next.add(institution);
    setExpandedGroups(next);
  }

  function toggleRow(id: string) {
    setOpenPanel((p) => (p?.type === 'edit' && p.id === id ? null : { type: 'edit', id }));
  }

  function renderRow(account: Account, showInstitutionInLabel: boolean) {
    const isEditing = openPanel?.type === 'edit' && openPanel.id === account.id;
    const balances = store.balancesFor(account.id);
    const label = showInstitutionInLabel ? accountLabel(account) : account.name;
    return (
      <div className="account-block" key={account.id}>
        <button className="account-row" onClick={() => toggleRow(account.id)}>
          <div className="account-row-top">
            <span className="account-name">{label}</span>
            <span className="account-kind">{KIND_LABELS[account.kind]}</span>
          </div>
          <div className="account-balances">
            {balances.length === 0 ? (
              <span className="balance-line empty">no activity yet</span>
            ) : (
              balances.map((b) => (
                <span className="balance-line" key={b.currency}>
                  {formatAmount(b.cents, b.currency)}
                </span>
              ))
            )}
          </div>
          {account.goalAmountCents != null && <GoalProgress account={account} balances={balances} />}
        </button>
        {isEditing && (
          <div className="account-edit">
            <AccountForm account={account} onDone={() => setOpenPanel(null)} />
          </div>
        )}
      </div>
    );
  }

  return (
    <main className="home">
      <div className="app-bar">
        <Link to="/settings" className="back-link">← Back</Link>
        <span className="wordmark">Accounts</span>
        <button
          className="icon-btn"
          aria-label="Add account"
          onClick={() => setOpenPanel((p) => (p?.type === 'create' ? null : { type: 'create' }))}
        >
          +
        </button>
      </div>

      {openPanel?.type === 'create' && (
        <section className="account-create">
          <div className="section-label">New account</div>
          <AccountForm account={null} onDone={() => setOpenPanel(null)} />
        </section>
      )}

      <div className="accounts-list">
        {groups.map((g) => {
          const isOpen = effectiveExpandedGroups.has(g.institution);
          return (
            <div className="account-group" key={g.institution}>
              <button className="group-header" onClick={() => toggleGroup(g.institution)}>
                <span>{isOpen ? '▾' : '▸'} {g.institution}</span>
                <span className="group-count">({g.accounts.length})</span>
              </button>
              {isOpen && g.accounts.map((a) => renderRow(a, false))}
            </div>
          );
        })}

        {ungrouped.map((a) => renderRow(a, true))}

        {active.length === 0 && !openPanel && (
          <p className="empty-note">No accounts yet — tap + to add one.</p>
        )}
      </div>

      {archived.length > 0 && (
        <div className="account-group">
          <button className="group-header" onClick={() => setArchivedOpen((o) => !o)}>
            <span>Archived ({archived.length})</span>
            <span className="group-count">{archivedOpen ? '▾' : '›'}</span>
          </button>
          {archivedOpen &&
            archived.map((a) => (
              <div className="account-row archived-row" key={a.id}>
                <div className="account-row-top">
                  <span className="account-name">{accountLabel(a)}</span>
                  <span className="account-kind">{KIND_LABELS[a.kind]}</span>
                </div>
                <div className="account-balances">
                  {store.balancesFor(a.id).map((b) => (
                    <span className="balance-line" key={b.currency}>
                      {formatAmount(b.cents, b.currency)}
                    </span>
                  ))}
                </div>
              </div>
            ))}
        </div>
      )}
    </main>
  );
}

function GoalProgress({
  account,
  balances,
}: {
  account: Account;
  balances: { currency: string; cents: number }[];
}) {
  const ownBalance = balances.find((b) => b.currency === account.currency)?.cents ?? 0;
  const goal = account.goalAmountCents ?? 0;
  const pct = goal > 0 ? Math.min(100, Math.max(0, (ownBalance / goal) * 100)) : 0;
  return (
    <div className="goal-progress">
      <div className="goal-progress-labels">
        <span>
          {formatAmount(ownBalance, account.currency)} / {formatAmount(goal, account.currency)}
        </span>
        <span>{Math.round(pct)}%</span>
      </div>
      <div className="track">
        <div className="fill" style={{ width: `${pct}%` }} />
      </div>
      {account.goalTargetDate && <span className="goal-due">due {formatGoalDate(account.goalTargetDate)}</span>}
    </div>
  );
}

// D54: tapping a row expands this inline, no separate screen, for both
// editing an existing account (account set) and creating one (account null).
function AccountForm({ account, onDone }: { account: Account | null; onDone: () => void }) {
  const store = useStore();
  const isNew = account === null;

  const [draft, setDraft] = useState<Account>(
    () =>
      account ?? {
        id: '',
        institution: null,
        name: '',
        kind: 'checking',
        currency: 'CAD',
        goalAmountCents: null,
        goalTargetDate: null,
        archived: false,
      },
  );
  const current: Account = account ?? draft;

  const [pickerOpen, setPickerOpen] = useState<'kind' | 'currency' | null>(null);
  // D55: goal fields collapse behind "+ Add a savings goal" unless already set.
  const [goalExpanded, setGoalExpanded] = useState(() => current.goalAmountCents != null);
  const [goalAmountStr, setGoalAmountStr] = useState(() =>
    current.goalAmountCents != null ? String(current.goalAmountCents / 100) : '',
  );

  function commit(patch: Partial<Account>) {
    if (isNew) setDraft((d) => ({ ...d, ...patch }));
    else store.updateAccount(current.id, patch);
  }

  // D57: currency chips are the same frequency-ranked pattern as everywhere
  // else — for an existing account that's its own transaction history; a
  // brand-new account has none yet, so fall back to currencies already in
  // use across other accounts.
  const currencyOptions = isNew
    ? [...new Set([current.currency, ...store.accounts.map((a) => a.currency), 'CAD'])]
    : store.rankedCurrencies(current.id);

  function saveNew() {
    if (!current.name.trim()) return;
    store.addAccount({ ...draft, id: crypto.randomUUID() });
    onDone();
  }

  function removeGoal() {
    commit({ goalAmountCents: null, goalTargetDate: null });
    setGoalAmountStr('');
    setGoalExpanded(false);
  }

  function archive() {
    if (isNew) return;
    store.updateAccount(current.id, { archived: true });
    onDone();
  }

  return (
    <div className="account-form">
      <label className="field-label">
        Institution
        <input
          className="text-input"
          placeholder="TD, Itaú, Wise…"
          value={current.institution ?? ''}
          onChange={(e) => commit({ institution: e.target.value || null })}
        />
      </label>

      <label className="field-label">
        Name
        <input
          className="text-input"
          placeholder="Visa, Checking, Trip Fund…"
          value={current.name}
          onChange={(e) => commit({ name: e.target.value })}
        />
      </label>

      <div>
        <div className="field-label">Kind</div>
        <button
          className="pill-tap"
          onClick={() => setPickerOpen(pickerOpen === 'kind' ? null : 'kind')}
        >
          {KIND_LABELS[current.kind]} ▾
        </button>
        {pickerOpen === 'kind' && (
          <div className="chip-row">
            {ACCOUNT_KINDS.map((k) => (
              <button
                key={k}
                className={`chip ${k === current.kind ? 'picked' : ''}`}
                onClick={() => {
                  commit({ kind: k });
                  setPickerOpen(null);
                }}
              >
                {KIND_LABELS[k]}
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="field-label">Currency</div>
        <button
          className="pill-tap"
          onClick={() => setPickerOpen(pickerOpen === 'currency' ? null : 'currency')}
        >
          {current.currency} ▾
        </button>
        {pickerOpen === 'currency' && (
          <div className="chip-row">
            {currencyOptions.map((c) => (
              <button
                key={c}
                className={`chip ${c === current.currency ? 'picked' : ''}`}
                onClick={() => {
                  commit({ currency: c });
                  setPickerOpen(null);
                }}
              >
                {c}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="goal-section">
        {!goalExpanded && (
          <button className="text-link" onClick={() => setGoalExpanded(true)}>
            + Add a savings goal
          </button>
        )}
        {goalExpanded && (
          <div className="goal-fields">
            <label className="field-label">
              Goal amount ({current.currency})
              <input
                className="text-input"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={goalAmountStr}
                onChange={(e) => {
                  const v = e.target.value;
                  setGoalAmountStr(v);
                  if (v.trim() === '') {
                    commit({ goalAmountCents: null });
                    return;
                  }
                  const n = parseFloat(v);
                  if (Number.isFinite(n) && n >= 0) commit({ goalAmountCents: Math.round(n * 100) });
                }}
              />
            </label>
            <label className="field-label">
              Target date
              <input
                className="text-input"
                type="date"
                value={current.goalTargetDate ?? ''}
                onChange={(e) => commit({ goalTargetDate: e.target.value || null })}
              />
            </label>
            {current.goalAmountCents != null && (
              <button className="text-link" onClick={removeGoal}>
                remove goal
              </button>
            )}
          </div>
        )}
      </div>

      <div className="form-actions">
        {isNew ? (
          <>
            <button className="chip ghost" onClick={onDone}>
              cancel
            </button>
            <button className="save-btn" onClick={saveNew}>
              Add account
            </button>
          </>
        ) : (
          <button className="text-link archive-link" onClick={archive}>
            Archive account
          </button>
        )}
      </div>
    </div>
  );
}

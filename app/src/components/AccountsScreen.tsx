import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../lib/store';
import { accountLabel, formatAmount } from '../lib/format';
import { getLocalUserId } from '../lib/identity';
import { hasHousehold, personLabel } from '../lib/household';
import { usePairedPeers } from '../lib/peers';
import type { Account, AccountKind } from '../lib/types';

// docs/12: name, kind, institution all read/write through the account
// fields directly — the kind list is fixed (D53's layout), not derived
// from usage. No currency, no savings goal — see Account.
const ACCOUNT_KINDS: AccountKind[] = ['checking', 'credit', 'cash', 'savings'];
const KIND_LABELS: Record<AccountKind, string> = {
  checking: 'Checking',
  credit: 'Credit',
  cash: 'Cash',
  savings: 'Savings',
};

// institutionSnapshot freezes the editing row's grouping key for the
// duration of the edit session (see effectiveInstitution below) — without
// it, typing in the Institution field (the live grouping key) reparents
// the row into a different/new group on every keystroke, remounting
// AccountForm and losing focus mid-edit.
type OpenPanel = { type: 'edit'; id: string; institutionSnapshot: string | null } | { type: 'create' } | null;

export function AccountsScreen() {
  const store = useStore();
  const [openPanel, setOpenPanel] = useState<OpenPanel>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string> | null>(null);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [peers] = usePairedPeers();
  // docs/26 D123 — owner_user_id renders as a name prefix in the row's
  // existing name slot, but only once a household actually has 2+
  // members (D110); a solo household must render exactly as it always
  // has, no layout change.
  const showOwner = hasHousehold(peers);
  const ownerPrefix = (a: Account) => (showOwner ? personLabel(a.ownerUserId, peers) : null);

  const active = store.accounts.filter((a) => !a.archived);
  const archived = store.accounts.filter((a) => a.archived);

  // D59: list order is most-recently-used, derived from transaction history —
  // no stored sort_order. Same recency signal doc 07 derives for defaults.
  const recency = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of store.transactions) {
      if (t.deletedAt) continue;
      const cur = map.get(t.accountId);
      if (!cur || t.occurredAt > cur) map.set(t.accountId, t.occurredAt);
    }
    return map;
  }, [store.transactions]);

  const byRecency = (list: Account[]) =>
    [...list].sort((a, b) => (recency.get(b.id) ?? '').localeCompare(recency.get(a.id) ?? ''));

  // The row currently being edited keeps the institution it had when
  // editing started, regardless of what's been typed since — see the
  // OpenPanel comment above. Everything else uses its live value.
  const effectiveInstitution = useCallback(
    (a: Account): string | null => {
      if (openPanel?.type === 'edit' && openPanel.id === a.id) return openPanel.institutionSnapshot;
      return a.institution;
    },
    [openPanel],
  );

  // D60/D61: group by institution; ungrouped accounts list plainly, no header.
  const groups = useMemo(() => {
    const byInstitution = new Map<string, Account[]>();
    for (const a of active) {
      const institution = effectiveInstitution(a);
      if (!institution) continue;
      const arr = byInstitution.get(institution) ?? [];
      arr.push(a);
      byInstitution.set(institution, arr);
    }
    const sortByRecency = (list: Account[]) =>
      [...list].sort((a, b) => (recency.get(b.id) ?? '').localeCompare(recency.get(a.id) ?? ''));
    return [...byInstitution.entries()]
      .map(([institution, accounts]) => ({ institution, accounts: sortByRecency(accounts) }))
      .sort((a, b) => (recency.get(b.accounts[0].id) ?? '').localeCompare(recency.get(a.accounts[0].id) ?? ''));
  }, [active, recency, effectiveInstitution]);

  const ungrouped = byRecency(active.filter((a) => !effectiveInstitution(a)));

  // Most-recently-used group expanded by default, others collapsed — a single
  // computed default, not re-derived after the user starts toggling groups.
  const effectiveExpandedGroups = expandedGroups ?? new Set(groups[0] ? [groups[0].institution] : []);

  function toggleGroup(institution: string) {
    const next = new Set(effectiveExpandedGroups);
    if (next.has(institution)) next.delete(institution);
    else next.add(institution);
    setExpandedGroups(next);
  }

  function toggleRow(account: Account) {
    setOpenPanel((p) =>
      p?.type === 'edit' && p.id === account.id
        ? null
        : { type: 'edit', id: account.id, institutionSnapshot: account.institution },
    );
  }

  function renderRow(account: Account, showInstitutionInLabel: boolean) {
    const isEditing = openPanel?.type === 'edit' && openPanel.id === account.id;
    const balances = store.balancesFor(account.id);
    const label = showInstitutionInLabel ? accountLabel(account) : account.name;
    const owner = ownerPrefix(account);
    return (
      <div className="account-block" key={account.id}>
        <button className="account-row" onClick={() => toggleRow(account)}>
          <div className="account-row-top">
            <span className="account-name">
              {owner && <span className="owner-prefix">{owner} — </span>}
              {label}
            </span>
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
                  <span className="account-name">
                    {ownerPrefix(a) && <span className="owner-prefix">{ownerPrefix(a)} — </span>}
                    {accountLabel(a)}
                  </span>
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
        archived: false,
        ownerUserId: getLocalUserId(),
      },
  );
  const current: Account = account ?? draft;

  const [pickerOpen, setPickerOpen] = useState<'kind' | null>(null);
  // Local mirrors of the free-text fields — `current.name`/`current.institution`
  // for an existing account come straight from the store, and commit() writes
  // through an async DB round-trip (PowerSync live query), so binding the
  // input's value directly to them snaps the cursor to the end on every
  // keystroke once that round-trip resolves.
  const [nameStr, setNameStr] = useState(() => current.name);
  const [institutionStr, setInstitutionStr] = useState(() => current.institution ?? '');

  function commit(patch: Partial<Account>) {
    if (isNew) setDraft((d) => ({ ...d, ...patch }));
    else store.updateAccount(current.id, patch);
  }

  function saveNew() {
    if (!current.name.trim()) return;
    store.addAccount({ ...draft, id: crypto.randomUUID() });
    onDone();
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
          value={institutionStr}
          onChange={(e) => {
            const v = e.target.value;
            setInstitutionStr(v);
            commit({ institution: v || null });
          }}
        />
      </label>

      <label className="field-label">
        Name
        <input
          className="text-input"
          placeholder="Visa, Checking, Trip Fund…"
          value={nameStr}
          onChange={(e) => {
            const v = e.target.value;
            setNameStr(v);
            commit({ name: v });
          }}
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

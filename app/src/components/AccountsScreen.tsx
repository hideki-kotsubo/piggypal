import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../lib/i18n';
import { Link, useLocation } from 'react-router-dom';
import { useStore } from '../lib/store';
import { accountName } from '../lib/starterLabels';
import { accountLabel, formatAmount, nowUtc } from '../lib/format';
import { getLocalUserId } from '../lib/identity';
import { hasHousehold, personLabel, useHouseholdPeers } from '../lib/household';
import { crossOwnerLosers } from '../lib/manualMerge';
import type { Account, AccountKind } from '../lib/types';

// docs/12: name, kind, institution all read/write through the account
// fields directly — the kind list is fixed (D53's layout), not derived
// from usage. No currency, no savings goal — see Account.
const ACCOUNT_KINDS: AccountKind[] = ['checking', 'credit', 'cash', 'savings'];
const kindLabel = (kind: AccountKind) => i18n.t(`accountKind.${kind}`);

// institutionSnapshot freezes the editing row's grouping key for the
// duration of the edit session (see effectiveInstitution below) — without
// it, typing in the Institution field (the live grouping key) reparents
// the row into a different/new group on every keystroke, remounting
// AccountForm and losing focus mid-edit.
type OpenPanel = { type: 'edit'; id: string; institutionSnapshot: string | null } | { type: 'create' } | null;

// Backlog 2026-08-23's manual merge-duplicates tool. 'picking' collects a
// survivor first (tap any row), then any number of duplicates to fold
// into it; 'review' is the confirm-with-consequences step before the
// actual write (store.mergeAccounts).
type MergeState =
  | { step: 'off' }
  | { step: 'picking'; survivorId: string | null; loserIds: Set<string> }
  | { step: 'review'; survivorId: string; loserIds: string[] };

export function AccountsScreen() {
  const store = useStore();
  const { t } = useTranslation();
  const location = useLocation();
  // EntryZone routes here with this when a real zero-accounts user tries
  // to log a transaction before adding their first account — jumps
  // straight to the create form instead of an empty list they'd still
  // have to find "+" on.
  const redirectState = location.state as { openCreate?: boolean; reason?: string } | null;
  const [openPanel, setOpenPanel] = useState<OpenPanel>(redirectState?.openCreate ? { type: 'create' } : null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string> | null>(null);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [mergeState, setMergeState] = useState<MergeState>({ step: 'off' });
  const peers = useHouseholdPeers();
  // docs/26 D123 — owner_user_id renders as a name prefix in the row's
  // existing name slot, but only once a household actually has 2+
  // members (D110); a solo household must render exactly as it always
  // has, no layout change.
  const showOwner = hasHousehold(peers);
  const ownerPrefix = (a: Account) =>
    showOwner ? (a.ownerUserId ? personLabel(a.ownerUserId, peers, store.profiles) : t('accounts.shared')) : null;

  const active = store.accounts.filter((a) => !a.archived);
  const archived = store.accounts.filter((a) => a.archived);

  // D59: list order is most-recently-used, derived from transaction history —
  // no stored sort_order. Same recency signal doc 07 derives for defaults.
  // docs/50: a split transaction has no single accountId (null) — its
  // legs (transaction_splits) count toward each of *their* accounts'
  // recency instead, using the parent's own occurredAt.
  const recency = useMemo(() => {
    const map = new Map<string, string>();
    const bump = (accountId: string, occurredAt: string) => {
      const cur = map.get(accountId);
      if (!cur || occurredAt > cur) map.set(accountId, occurredAt);
    };
    const activeById = new Map<string, string>();
    for (const tx of store.transactions) {
      if (tx.deletedAt) continue;
      activeById.set(tx.id, tx.occurredAt);
      if (tx.accountId !== null) bump(tx.accountId, tx.occurredAt);
    }
    for (const s of store.transactionSplits) {
      const occurredAt = activeById.get(s.transactionId);
      if (occurredAt) bump(s.accountId, occurredAt);
    }
    return map;
  }, [store.transactions, store.transactionSplits]);

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
  // While merging, every group is forced open instead — a duplicate
  // sitting in a collapsed group would otherwise be impossible to pick.
  const effectiveExpandedGroups =
    mergeState.step !== 'off'
      ? new Set(groups.map((g) => g.institution))
      : (expandedGroups ?? new Set(groups[0] ? [groups[0].institution] : []));

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

  function toggleMergeMode() {
    setOpenPanel(null);
    setMergeState((m) => (m.step === 'off' ? { step: 'picking', survivorId: null, loserIds: new Set() } : { step: 'off' }));
  }

  function handleMergeTap(account: Account) {
    if (mergeState.step !== 'picking') return;
    if (mergeState.survivorId === null) {
      setMergeState({ ...mergeState, survivorId: account.id });
      return;
    }
    if (account.id === mergeState.survivorId) return;
    const next = new Set(mergeState.loserIds);
    if (next.has(account.id)) next.delete(account.id);
    else next.add(account.id);
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
    await store.mergeAccounts(mergeState.survivorId, mergeState.loserIds);
    setMergeState({ step: 'off' });
  }

  const txCountForAccount = (accountId: string) =>
    store.transactions.filter((tx) => !tx.deletedAt && tx.accountId === accountId).length;

  function renderRow(account: Account, showInstitutionInLabel: boolean) {
    const isEditing = openPanel?.type === 'edit' && openPanel.id === account.id;
    const balances = store.balancesFor(account.id);
    const label = showInstitutionInLabel ? accountLabel(account) : accountName(account);
    const owner = ownerPrefix(account);

    if (mergeState.step === 'picking') {
      const isSurvivor = mergeState.survivorId === account.id;
      const isPicked = mergeState.loserIds.has(account.id);
      return (
        <button
          key={account.id}
          className={`account-row ${isSurvivor ? 'picked-survivor' : ''} ${isPicked ? 'picked-duplicate' : ''}`}
          disabled={isSurvivor}
          onClick={() => handleMergeTap(account)}
        >
          <div className="account-row-top">
            <span className="account-name">
              {isSurvivor && <span className="merge-badge">{t('duplicates.keeper')}</span>}
              {!isSurvivor && mergeState.survivorId !== null && (
                <span className="merge-check">{isPicked ? '✓' : '○'}</span>
              )}
              {owner && <span className="owner-prefix">{owner} — </span>}
              {label}
            </span>
            <span className="account-kind">{kindLabel(account.kind)}</span>
          </div>
          <div className="account-balances">
            {balances.length === 0 ? (
              <span className="balance-line empty">{t('accounts.noActivity')}</span>
            ) : (
              balances.map((b) => (
                <span className="balance-line" key={b.currency}>
                  {formatAmount(b.cents, b.currency)}
                </span>
              ))
            )}
          </div>
        </button>
      );
    }

    return (
      <div className="account-block" key={account.id}>
        <button className="account-row" onClick={() => toggleRow(account)}>
          <div className="account-row-top">
            <span className="account-name">
              {owner && <span className="owner-prefix">{owner} — </span>}
              {label}
            </span>
            <span className="account-kind">{kindLabel(account.kind)}</span>
          </div>
          <div className="account-balances">
            {balances.length === 0 ? (
              <span className="balance-line empty">{t('accounts.noActivity')}</span>
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
        <Link to="/settings" className="back-link">← {t('common.back')}</Link>
        <span className="wordmark">{t('accounts.title')}</span>
        <div className="app-bar-actions">
          {mergeState.step === 'off' && active.length >= 2 && (
            <button className="icon-btn" aria-label={t('accounts.mergeDuplicates')} onClick={toggleMergeMode}>⇄</button>
          )}
          {mergeState.step === 'off' && (
            <button
              className="icon-btn"
              aria-label={t('accounts.add')}
              onClick={() => setOpenPanel((p) => (p?.type === 'create' ? null : { type: 'create' }))}
            >
              +
            </button>
          )}
        </div>
      </div>

      {mergeState.step === 'picking' &&
        (() => {
          const survivor = mergeState.survivorId ? store.accounts.find((a) => a.id === mergeState.survivorId) : null;
          return (
            <div className="merge-toolbar">
              <span>
                {!survivor
                  ? t('accounts.pickKeeper')
                  : mergeState.loserIds.size === 0
                    ? t('accounts.pickDuplicates', { name: accountLabel(survivor) })
                    : t('accounts.willMerge', { count: mergeState.loserIds.size, name: accountLabel(survivor) })}
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
          const survivor = store.accounts.find((a) => a.id === mergeState.survivorId)!;
          const losers = mergeState.loserIds.map((id) => store.accounts.find((a) => a.id === id)!).filter(Boolean);
          const flagged = new Set(crossOwnerLosers(survivor, losers).map((a) => a.id));
          return (
            <div className="merge-review">
              <p className="section-label">{t('accounts.mergeInto', { count: losers.length, name: accountLabel(survivor) })}</p>
              <div className="merge-conflicts">
                <div className="merge-conflict">
                  <p className="merge-conflict-title">{t('accounts.keeping', { name: accountLabel(survivor) })}</p>
                  <p className="merge-conflict-detail">{t('accounts.nothingChanges')}</p>
                </div>
                {losers.map((loser) => {
                  const n = txCountForAccount(loser.id);
                  return (
                    <div className="merge-conflict" key={loser.id}>
                      <p className="merge-conflict-title">{t('accounts.foldingIn', { name: accountLabel(loser) })}</p>
                      <p className="merge-conflict-detail">
                        {t('accounts.movesTo', { transactions: t('transactions.count', { count: n }), name: accountLabel(survivor) })}
                      </p>
                      {flagged.has(loser.id) && (
                        <p className="merge-conflict-detail merge-conflict-warning">
                          {t('accounts.ownerWarning', {
                            from: loser.ownerUserId ? personLabel(loser.ownerUserId, peers, store.profiles) : t('accounts.shared'),
                            to: survivor.ownerUserId ? personLabel(survivor.ownerUserId, peers, store.profiles) : t('accounts.shared'),
                          })}
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

      {openPanel?.type === 'create' && (
        <section className="account-create">
          <div className="section-label">{t('accounts.new')}</div>
          {redirectState?.reason && <p className="empty-note">{redirectState.reason}</p>}
          <AccountForm account={null} onDone={() => setOpenPanel(null)} />
        </section>
      )}

      {mergeState.step !== 'review' && (
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
            <p className="empty-note">{t('accounts.empty')}</p>
          )}
        </div>
      )}

      {mergeState.step === 'off' && archived.length > 0 && (
        <div className="account-group">
          <button className="group-header" onClick={() => setArchivedOpen((o) => !o)}>
            <span>{t('accounts.archived', { count: archived.length })}</span>
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
                  <span className="account-kind">{kindLabel(a.kind)}</span>
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
  const { t } = useTranslation();
  const peers = useHouseholdPeers();
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
        updatedAt: nowUtc(),
      },
  );
  const current: Account = account ?? draft;

  const [pickerOpen, setPickerOpen] = useState<'kind' | 'owner' | null>(null);
  // Local mirrors of the free-text fields — `current.name`/`current.institution`
  // for an existing account come straight from the store, and commit() writes
  // through an async DB round-trip (PowerSync live query), so binding the
  // input's value directly to them snaps the cursor to the end on every
  // keystroke once that round-trip resolves.
  const [nameStr, setNameStr] = useState(() => (isNew ? current.name : accountName(current)));
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
        {t('accounts.institution')}
        <input
          className="text-input"
          placeholder={t('accounts.institutionPlaceholder')}
          value={institutionStr}
          onChange={(e) => {
            const v = e.target.value;
            setInstitutionStr(v);
            commit({ institution: v || null });
          }}
        />
      </label>

      <label className="field-label">
        {t('common.name')}
        <input
          className="text-input"
          placeholder={t('accounts.namePlaceholder')}
          value={nameStr}
          onChange={(e) => {
            const v = e.target.value;
            setNameStr(v);
            commit({ name: v });
          }}
        />
      </label>

      <div>
        <div className="field-label">{t('accounts.kind')}</div>
        <button
          className="pill-tap"
          onClick={() => setPickerOpen(pickerOpen === 'kind' ? null : 'kind')}
        >
          {kindLabel(current.kind)} ▾
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
                {kindLabel(k)}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* A new feature request: an account can optionally be linked to a
          real profile as its owner, so a transaction on it can default
          its payer automatically instead of asking every time
          (EntryZone.tsx's startBlank/confirmPreview). Only shown once
          there's actually more than one profile to choose between —
          identical to a solo account, this has nothing to offer. */}
      {/* docs/71 D252 — removed people aren't offered as a new owner; an
          account they already own keeps showing their name, marked. */}
      {store.profiles.filter((p) => !p.deletedAt).length > 1 && (
        <div>
          <div className="field-label">{t('accounts.owner')}</div>
          <button className="pill-tap" onClick={() => setPickerOpen(pickerOpen === 'owner' ? null : 'owner')}>
            {current.ownerUserId ? personLabel(current.ownerUserId, peers, store.profiles) : t('accounts.shared')} ▾
          </button>
          {pickerOpen === 'owner' && (
            <div className="chip-row">
              <button
                className={`chip ${current.ownerUserId === null ? 'picked' : ''}`}
                onClick={() => {
                  commit({ ownerUserId: null });
                  setPickerOpen(null);
                }}
              >
                {t('accounts.shared')}
              </button>
              {store.profiles
                .filter((p) => !p.deletedAt)
                .map((p) => (
                <button
                  key={p.id}
                  className={`chip ${p.id === current.ownerUserId ? 'picked' : ''}`}
                  onClick={() => {
                    commit({ ownerUserId: p.id });
                    setPickerOpen(null);
                  }}
                >
                  {p.displayName}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="form-actions">
        {isNew ? (
          <>
            <button className="chip ghost" onClick={onDone}>
              {t('common.cancelLower')}
            </button>
            <button className="save-btn" onClick={saveNew}>
              {t('accounts.add')}
            </button>
          </>
        ) : (
          <button className="text-link archive-link" onClick={archive}>
            {t('accounts.archive')}
          </button>
        )}
      </div>
    </div>
  );
}

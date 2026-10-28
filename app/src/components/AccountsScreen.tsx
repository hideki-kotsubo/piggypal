import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
import { useStore } from '../lib/store';
import { accountName } from '../lib/starterLabels';
import { accountLabel, formatAmount, kindLabel } from '../lib/format';
import { hasHousehold, personLabel, useHouseholdPeers } from '../lib/household';
import { crossOwnerLosers } from '../lib/manualMerge';
import { ACCOUNT_PICKER_SCALE_THRESHOLD } from '../lib/settings';
import type { Account } from '../lib/types';
import { AccountForm } from './AccountForm';
import { BottomSheet } from './BottomSheet';

// Backlog 2026-08-23's manual merge-duplicates tool. 'picking' collects a
// survivor first (tap any row), then any number of duplicates to fold
// into it; 'review' is the confirm-with-consequences step before the
// actual write (store.mergeAccounts).
type MergeState =
  | { step: 'off' }
  | { step: 'picking'; survivorId: string | null; loserIds: Set<string> }
  | { step: 'review'; survivorId: string; loserIds: string[] };

// 'all', a profile id, or accounts with no owner.
type PersonFilter = 'all' | 'shared' | string;

// docs/79 A1 — institution cards, search and per-person filters at the
// real 15-20+ account scale (docs/12). A row opens the account's own page
// (D309); editing happens there, never from the list. "+" opens the
// create sheet (D311).
export function AccountsScreen() {
  const store = useStore();
  const { t } = useTranslation();
  const location = useLocation();
  // EntryZone routes here with this when a real zero-accounts user tries
  // to log a transaction before adding their first account — jumps
  // straight to the create form instead of an empty list they'd still
  // have to find "+" on.
  const redirectState = location.state as { openCreate?: boolean; reason?: string } | null;
  const [creating, setCreating] = useState(!!redirectState?.openCreate);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [mergeState, setMergeState] = useState<MergeState>({ step: 'off' });
  const [query, setQuery] = useState('');
  const [person, setPerson] = useState<PersonFilter>('all');
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
  const showSearch = active.length > ACCOUNT_PICKER_SCALE_THRESHOLD;
  const people = store.profiles.filter((p) => !p.deletedAt);

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

  // Merging needs every account in reach, so filters don't apply then.
  const filtering = mergeState.step === 'off';
  const q = query.trim().toLowerCase();
  const visible = active.filter((a) => {
    if (!filtering) return true;
    if (person === 'shared' && a.ownerUserId !== null) return false;
    if (person !== 'all' && person !== 'shared' && a.ownerUserId !== person) return false;
    if (q && !`${accountLabel(a)} ${a.institution ?? ''} ${kindLabel(a.kind)}`.toLowerCase().includes(q)) return false;
    return true;
  });

  // D60/D61: group by institution; ungrouped accounts sit in their own
  // card with no header.
  const groups = (() => {
    const byInstitution = new Map<string, Account[]>();
    for (const a of visible) {
      if (!a.institution) continue;
      const arr = byInstitution.get(a.institution) ?? [];
      arr.push(a);
      byInstitution.set(a.institution, arr);
    }
    return [...byInstitution.entries()]
      .map(([institution, accounts]) => ({ institution, accounts: byRecency(accounts) }))
      .sort((a, b) => (recency.get(b.accounts[0].id) ?? '').localeCompare(recency.get(a.accounts[0].id) ?? ''));
  })();
  const ungrouped = byRecency(visible.filter((a) => !a.institution));

  // docs/10 — one total per currency across what's shown, never blended.
  const totals = new Map<string, number>();
  for (const a of visible) {
    for (const b of store.balancesFor(a.id)) totals.set(b.currency, (totals.get(b.currency) ?? 0) + b.cents);
  }

  function toggleMergeMode() {
    setCreating(false);
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

  // docs/79 D308, applied to accounts too — archiving only hides an
  // account, so restoring just clears the flag. Asks first.
  function restore(account: Account) {
    if (!window.confirm(t('accounts.restoreConfirm', { name: accountLabel(account) }))) return;
    store.updateAccount(account.id, { archived: false });
  }

  const txCountForAccount = (accountId: string) =>
    store.transactions.filter((tx) => !tx.deletedAt && tx.accountId === accountId).length;

  function renderBalances(account: Account) {
    const balances = store.balancesFor(account.id);
    if (balances.length === 0) return <span className="balance-line empty">{t('accounts.noActivity')}</span>;
    return balances.map((b) => (
      <span className={`balance-line ${b.cents < 0 ? 'neg' : ''}`} key={b.currency}>
        {formatAmount(b.cents, b.currency)}
      </span>
    ));
  }

  function renderRow(account: Account, showInstitutionInLabel: boolean) {
    const label = showInstitutionInLabel ? accountLabel(account) : accountName(account);
    const owner = ownerPrefix(account);

    if (mergeState.step === 'picking') {
      const isSurvivor = mergeState.survivorId === account.id;
      const isPicked = mergeState.loserIds.has(account.id);
      return (
        <button
          key={account.id}
          className={`account-card-row ${isSurvivor ? 'picked-survivor' : ''} ${isPicked ? 'picked-duplicate' : ''}`}
          disabled={isSurvivor}
          onClick={() => handleMergeTap(account)}
        >
          <span className="account-card-main">
            <span className="account-name">
              {isSurvivor && <span className="merge-badge">{t('duplicates.keeper')}</span>}
              {!isSurvivor && mergeState.survivorId !== null && (
                <span className="merge-check">{isPicked ? '✓' : '○'}</span>
              )}
              {label}
            </span>
            <span className="account-card-sub">{kindLabel(account.kind)}</span>
          </span>
          <span className="account-balances">{renderBalances(account)}</span>
        </button>
      );
    }

    return (
      <Link key={account.id} to={`/accounts/${account.id}`} className="account-card-row">
        <span className="account-card-main">
          <span className="account-name">{label}</span>
          <span className="account-card-sub">
            {kindLabel(account.kind)}
            {owner && <span className="owner-tag">{owner}</span>}
          </span>
        </span>
        <span className="account-balances">{renderBalances(account)}</span>
      </Link>
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
            <button className="icon-btn" aria-label={t('accounts.add')} onClick={() => setCreating(true)}>
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

      {mergeState.step === 'off' && showSearch && (
        <label className="list-search">
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            value={query}
            placeholder={t('accounts.searchPlaceholder', { count: active.length })}
            aria-label={t('accounts.search')}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      )}

      {mergeState.step === 'off' && showOwner && people.length > 1 && (
        <div className="chip-row list-filters">
          <button className={`chip ${person === 'all' ? 'picked' : ''}`} onClick={() => setPerson('all')}>
            {t('accounts.everyone')}
          </button>
          {people.map((p) => (
            <button key={p.id} className={`chip ${person === p.id ? 'picked' : ''}`} onClick={() => setPerson(p.id)}>
              {p.displayName}
            </button>
          ))}
          <button className={`chip ${person === 'shared' ? 'picked' : ''}`} onClick={() => setPerson('shared')}>
            {t('accounts.shared')}
          </button>
        </div>
      )}

      {mergeState.step === 'off' && totals.size > 0 && (
        <div className="currency-totals" aria-label={t('accounts.totals')}>
          {[...totals.entries()].map(([currency, cents]) => (
            <div className="currency-total" key={currency}>
              <span className="currency-total-code">{currency}</span>
              <span className={`currency-total-amount ${cents < 0 ? 'neg' : ''}`}>{formatAmount(cents, currency)}</span>
            </div>
          ))}
        </div>
      )}

      {mergeState.step !== 'review' && (
        <div className="account-cards">
          {groups.map((g) => (
            <section className="account-card" key={g.institution} aria-label={g.institution}>
              <div className="account-card-head">
                <span className="institution-badge" aria-hidden="true">{g.institution.trim()[0]?.toUpperCase()}</span>
                <span className="account-card-title">{g.institution}</span>
                <span className="group-count">{t('accounts.count', { count: g.accounts.length })}</span>
              </div>
              {g.accounts.map((a) => renderRow(a, false))}
            </section>
          ))}

          {ungrouped.length > 0 && <section className="account-card">{ungrouped.map((a) => renderRow(a, true))}</section>}

          {active.length === 0 && <p className="empty-note">{t('accounts.empty')}</p>}
          {active.length > 0 && visible.length === 0 && <p className="empty-note">{t('accounts.noMatch')}</p>}
        </div>
      )}

      {mergeState.step === 'off' && archived.length > 0 && (
        <div className="archived-section">
          <button className="group-header" aria-expanded={archivedOpen} onClick={() => setArchivedOpen((o) => !o)}>
            <span>{t('accounts.archived', { count: archived.length })}</span>
            <span className="group-count">{archivedOpen ? '▾' : '›'}</span>
          </button>
          {archivedOpen && (
            <section className="account-card">
              {archived.map((a) => (
                <div className="account-card-row archived-row" key={a.id}>
                  <Link to={`/accounts/${a.id}`} className="account-card-main">
                    <span className="account-name">
                      {ownerPrefix(a) && <span className="owner-prefix">{ownerPrefix(a)} — </span>}
                      {accountLabel(a)}
                    </span>
                    <span className="account-card-sub">{kindLabel(a.kind)}</span>
                  </Link>
                  <button type="button" className="chip restore-chip" onClick={() => restore(a)}>
                    {t('common.restore')}
                  </button>
                </div>
              ))}
            </section>
          )}
        </div>
      )}

      {creating && (
        <BottomSheet title={t('accounts.new')} onClose={() => setCreating(false)}>
          {redirectState?.reason && <p className="empty-note sheet-note">{redirectState.reason}</p>}
          <AccountForm account={null} onDone={() => setCreating(false)} />
        </BottomSheet>
      )}
    </main>
  );
}

import { Fragment, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useStore } from '../lib/store';
import { accountLabel, formatAmount, formatTime, groupByDay, transactionTitle } from '../lib/format';
import {
  filterTransactions,
  hasActiveFilters,
  presetRange,
  totalsByCurrency,
  type DatePreset,
  type TransactionFilters,
} from '../lib/filterTransactions';
import { CategoryPicker } from './CategoryPicker';
import { getLocalUserId } from '../lib/identity';
import { hasHousehold, personLabel } from '../lib/household';
import { usePairedPeers } from '../lib/peers';
import { PayerBadge } from './PayerBadge';

const MERCHANT_CAP = 8;
const DATE_PRESETS: { id: DatePreset; label: string }[] = [
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
  { id: 'lastMonth', label: 'Last month' },
];

type FilterKey = 'category' | 'account' | 'merchant' | 'date';

export function TransactionList() {
  const store = useStore();
  const [peers] = usePairedPeers();
  const showPayerBadge = hasHousehold(peers);
  const [searchParams, setSearchParams] = useSearchParams();
  const [openFilter, setOpenFilter] = useState<FilterKey | null>(null);
  const [merchantExpanded, setMerchantExpanded] = useState(false);
  const [customDateOpen, setCustomDateOpen] = useState(false);

  const filters: TransactionFilters = {
    q: searchParams.get('q') ?? '',
    categoryId: searchParams.get('category'),
    accountId: searchParams.get('account'),
    merchant: searchParams.get('merchant'),
    dateFrom: searchParams.get('from'),
    dateTo: searchParams.get('to'),
  };

  // docs/18 D85: filter state lives in the URL, not local useState — a
  // filtered result links to /transactions/:id (docs/17), and hitting Back
  // from there unmounts this component entirely, which would silently
  // drop local state on every such round-trip. replace:true keeps every
  // keystroke in the search box from polluting browser history.
  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(searchParams);
    if (value === null || value === '') next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  }

  function toggleFilter(key: FilterKey) {
    setOpenFilter((open) => (open === key ? null : key));
  }

  const all = [...store.transactions]
    .filter((t) => !t.deletedAt)
    .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));
  const filtered = filterTransactions(all, filters);
  const totals = totalsByCurrency(filtered);
  const filtersActive = hasActiveFilters(filters);

  const rankedMerchants = store.rankedMerchants();
  const merchantChips = merchantExpanded ? rankedMerchants : rankedMerchants.slice(0, MERCHANT_CAP);
  const merchantHiddenCount = rankedMerchants.length - merchantChips.length;

  function pickPreset(preset: DatePreset) {
    const r = presetRange(preset);
    const next = new URLSearchParams(searchParams);
    next.set('from', r.from);
    next.set('to', r.to);
    setSearchParams(next, { replace: true });
    setCustomDateOpen(false);
    setOpenFilter(null);
  }
  function isPresetActive(preset: DatePreset): boolean {
    const r = presetRange(preset);
    return filters.dateFrom === r.from && filters.dateTo === r.to;
  }
  function clearDateRange() {
    const next = new URLSearchParams(searchParams);
    next.delete('from');
    next.delete('to');
    setSearchParams(next, { replace: true });
    setCustomDateOpen(false);
    setOpenFilter(null);
  }
  const matchesPreset = DATE_PRESETS.some((p) => isPresetActive(p.id));
  const activePreset = DATE_PRESETS.find((p) => isPresetActive(p.id));
  const showCustomInputs = customDateOpen || (Boolean(filters.dateFrom || filters.dateTo) && !matchesPreset);

  const selectedCategory = filters.categoryId ? store.categories.find((c) => c.id === filters.categoryId) : undefined;
  const selectedAccount = filters.accountId ? store.accounts.find((a) => a.id === filters.accountId) : undefined;
  const dateTriggerLabel = activePreset ? activePreset.label : filters.dateFrom || filters.dateTo ? 'Custom' : 'Date range';

  return (
    <main className="home">
      <div className="app-bar">
        <Link to="/" className="back-link">← Back</Link>
        <span className="wordmark">Transactions</span>
        <span style={{ width: '3rem' }} />
      </div>

      <div className="tx-filters">
        <div className="search-input-row">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <circle cx="5.5" cy="5.5" r="4.5" stroke="currentColor" strokeWidth="1.3" />
            <path d="M9 9L12 12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          <input
            placeholder="search notes & locations…"
            value={filters.q}
            onChange={(e) => setParam('q', e.target.value)}
          />
        </div>

        {/* docs/18: collapsed trigger chips, same convention as
            AccountCurrencyPicker's account/currency pills — tap to reveal
            one filter's options at a time, picking a value both sets it
            and closes the panel. The trigger itself shows the picked
            value and turns accent-colored when active, rather than also
            duplicating it as a separate removable pill underneath — the
            same value showing twice read as redundant. Clearing a filter
            happens by reopening its panel and tapping "All
            categories"/"Any location"/etc, already the first option there. */}
        <div className="pill-row filter-trigger-row">
          <button className={`pill-tap ${selectedCategory ? 'active' : ''}`} onClick={() => toggleFilter('category')}>
            {selectedCategory?.name ?? 'Category'} ▾
          </button>
          <button className={`pill-tap ${selectedAccount ? 'active' : ''}`} onClick={() => toggleFilter('account')}>
            {selectedAccount ? accountLabel(selectedAccount) : 'Account'} ▾
          </button>
          {rankedMerchants.length > 0 && (
            <button className={`pill-tap ${filters.merchant ? 'active' : ''}`} onClick={() => toggleFilter('merchant')}>
              {filters.merchant ?? 'Location'} ▾
            </button>
          )}
          <button className={`pill-tap ${filters.dateFrom || filters.dateTo ? 'active' : ''}`} onClick={() => toggleFilter('date')}>
            {dateTriggerLabel} ▾
          </button>
        </div>

        {openFilter === 'category' && (
          <div className="chip-row">
            <button className={`chip ${!filters.categoryId ? 'picked' : ''}`} onClick={() => { setParam('category', null); setOpenFilter(null); }}>
              All categories
            </button>
          </div>
        )}
        {openFilter === 'category' && (
          <CategoryPicker selectedId={filters.categoryId} onPick={(id) => { setParam('category', id); setOpenFilter(null); }} />
        )}

        {openFilter === 'account' && (
          <div className="chip-row">
            <button className={`chip ${!filters.accountId ? 'picked' : ''}`} onClick={() => { setParam('account', null); setOpenFilter(null); }}>
              All accounts
            </button>
            {store.rankedAccounts().map((a) => (
              <button
                key={a.id}
                className={`chip ${a.id === filters.accountId ? 'picked' : ''}`}
                onClick={() => { setParam('account', a.id); setOpenFilter(null); }}
              >
                {accountLabel(a)}
              </button>
            ))}
          </div>
        )}

        {openFilter === 'merchant' && (
          <div className="chip-row">
            <button className={`chip ${!filters.merchant ? 'picked' : ''}`} onClick={() => { setParam('merchant', null); setOpenFilter(null); }}>
              Any location
            </button>
            {merchantChips.map((m) => (
              <button
                key={m}
                className={`chip ${m === filters.merchant ? 'picked' : ''}`}
                onClick={() => { setParam('merchant', m); setOpenFilter(null); }}
              >
                {m}
              </button>
            ))}
            {merchantHiddenCount > 0 && (
              <button className="chip ghost" onClick={() => setMerchantExpanded(true)}>
                + {merchantHiddenCount} more
              </button>
            )}
          </div>
        )}

        {openFilter === 'date' && (
          <>
            <div className="chip-row">
              <button className={`chip ${!filters.dateFrom && !filters.dateTo ? 'picked' : ''}`} onClick={clearDateRange}>
                All dates
              </button>
              {DATE_PRESETS.map((p) => (
                <button key={p.id} className={`chip ${isPresetActive(p.id) ? 'picked' : ''}`} onClick={() => pickPreset(p.id)}>
                  {p.label}
                </button>
              ))}
              <button className={`chip ${showCustomInputs ? 'picked' : ''}`} onClick={() => setCustomDateOpen((o) => !o)}>
                Custom
              </button>
            </div>
            {showCustomInputs && (
              <div className="field-pair">
                <label className="field-label">
                  From
                  <input
                    className="text-input"
                    type="date"
                    value={filters.dateFrom ?? ''}
                    onChange={(e) => setParam('from', e.target.value)}
                  />
                </label>
                <label className="field-label">
                  To
                  <input
                    className="text-input"
                    type="date"
                    value={filters.dateTo ?? ''}
                    onChange={(e) => setParam('to', e.target.value)}
                  />
                </label>
              </div>
            )}
          </>
        )}
      </div>

      {filtered.length > 0 && (
        <div className="totals-row">
          <span>{filtered.length} transaction{filtered.length === 1 ? '' : 's'}</span>
          {totals.map((t) => (
            <b key={t.currency}>{formatAmount(t.cents, t.currency)}</b>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="empty-note">{filtersActive ? 'No transactions match these filters.' : 'Nothing logged yet.'}</p>
      ) : (
        <div className="recent" style={{ marginTop: '0.5rem' }}>
          {groupByDay(filtered).map((group) => (
            <Fragment key={group.label}>
              <div className="day-label">
                <span>{group.label}</span>
                <span className="day-subtotal">
                  {totalsByCurrency(group.items).map((t, i) => (
                    <span key={t.currency}>{i > 0 && ' · '}{formatAmount(t.cents, t.currency)}</span>
                  ))}
                </span>
              </div>
              <div className="day-card">
                {group.items.map((t) => {
                  const category = store.categories.find((c) => c.id === t.categoryId);
                  const account = store.accounts.find((a) => a.id === t.accountId);
                  return (
                    <Link key={t.id} to={`/transactions/${t.id}`} className="tx-row tx-row-tappable">
                      <div className="tx-left">
                        {showPayerBadge && (
                          <PayerBadge label={personLabel(t.paidByUserId, peers)} mine={t.paidByUserId === getLocalUserId()} />
                        )}
                        <div className="tx-main">
                          <span className="tx-note">{transactionTitle(t, category)}</span>
                          {/* day-label above already carries the date — just time here, still genuinely new info */}
                          <span className="tx-meta">
                            {category?.name ?? 'Uncategorized'} · {formatTime(t.occurredAt)} · {account ? accountLabel(account) : '—'}
                          </span>
                        </div>
                      </div>
                      <span className={`tx-amt ${t.amountCents < 0 ? 'out' : 'in'}`}>
                        {formatAmount(t.amountCents, t.currency)}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </Fragment>
          ))}
        </div>
      )}
    </main>
  );
}

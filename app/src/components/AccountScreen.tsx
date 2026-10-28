import { Fragment, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useStore } from '../lib/store';
import { accountName } from '../lib/starterLabels';
import { accountLabel, formatAmount, formatOccurrenceDate, groupByDay, kindLabel, transactionTitle } from '../lib/format';
import { hasHousehold, personLabel, useHouseholdPeers } from '../lib/household';
import { accountMonthFlow, currentMonthKey } from '../lib/activity';
import { accountShares } from '../lib/filterTransactions';
import { dueOccurrences, postedKeys, todayLocal, upcomingOccurrences } from '../lib/schedules';
import { AccountForm } from './AccountForm';
import { BottomSheet } from './BottomSheet';
import { PrivateMark } from './PrivateMark';

const RECENT_COUNT = 5;
const UPCOMING_DAYS = 30;

// docs/79 D309 — an account's own page: balance per currency (never
// blended, docs/10), money in/out this month, scheduled payments coming
// up from it, and its latest transactions. The only way into editing an
// account: its Edit button opens the sheet (D311).
export function AccountScreen() {
  const { id } = useParams<{ id: string }>();
  const store = useStore();
  const { t } = useTranslation();
  const peers = useHouseholdPeers();
  const [editing, setEditing] = useState(false);
  const account = store.accounts.find((a) => a.id === id);

  if (!account) {
    return (
      <main className="home">
        <div className="app-bar">
          <Link to="/accounts" className="back-link">← {t('common.back')}</Link>
          <span className="wordmark">{t('accounts.title')}</span>
          <span style={{ width: '3rem' }} />
        </div>
        <p className="empty-note">{t('accounts.notFound')}</p>
      </main>
    );
  }

  const balances = store.balancesFor(account.id);
  const active = store.transactions.filter((tx) => !tx.deletedAt);
  const flows = accountMonthFlow(active, store.transactionSplits, account.id, currentMonthKey());
  const owner = hasHousehold(peers)
    ? account.ownerUserId
      ? personLabel(account.ownerUserId, peers, store.profiles)
      : t('accounts.shared')
    : null;

  // docs/57 — open occurrences of this account's rules: anything overdue
  // first, then what's due in the next 30 days.
  const today = todayLocal();
  const rules = store.scheduledPayments.filter((r) => r.accountId === account.id && !r.deletedAt && !r.archived && !r.paused);
  const posted = postedKeys(store.transactions);
  const ruleById = new Map(rules.map((r) => [r.id, r]));
  const due = dueOccurrences(rules, posted, today);
  const upcoming = [...due, ...upcomingOccurrences(rules, posted, today, UPCOMING_DAYS)];

  // docs/50 — a split purchase shows here with this account's own leg.
  const legs = accountShares(store.transactionSplits, account.id);
  const recent = active
    .filter((tx) => tx.accountId === account.id || legs.has(tx.id))
    .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1))
    .slice(0, RECENT_COUNT);

  function restore() {
    if (!account || !window.confirm(t('accounts.restoreConfirm', { name: accountLabel(account) }))) return;
    store.updateAccount(account.id, { archived: false });
  }

  return (
    <main className="home">
      <div className="app-bar">
        <Link to="/accounts" className="back-link">← {t('common.back')}</Link>
        <span className="wordmark">{t('accounts.title')}</span>
        <div className="app-bar-actions">
          <button type="button" className="chip" onClick={() => setEditing(true)}>
            {t('common.edit')}
          </button>
        </div>
      </div>

      <section className="account-hero">
        <div className="account-hero-meta">
          {[account.institution, kindLabel(account.kind), owner].filter(Boolean).join(' · ')}
        </div>
        <h1 className="account-hero-name">{accountName(account)}</h1>
        {balances.length === 0 ? (
          <p className="account-hero-empty">{t('accounts.noActivity')}</p>
        ) : (
          <div className="account-hero-balances">
            {balances.map((b) => (
              <span key={b.currency} className={`account-hero-balance ${b.cents < 0 ? 'neg' : ''}`}>
                {formatAmount(b.cents, b.currency)}
              </span>
            ))}
          </div>
        )}
        {account.archived && (
          <div className="account-hero-archived">
            <span>{t('accounts.isArchived')}</span>
            <button type="button" className="chip restore-chip" onClick={restore}>
              {t('common.restore')}
            </button>
          </div>
        )}
      </section>

      <div className="section-label">{t('accounts.thisMonth')}</div>
      {flows.length === 0 ? (
        <p className="empty-note">{t('accounts.noActivityMonth')}</p>
      ) : (
        <div className="flow-grid">
          {flows.map((f) => (
            <Fragment key={f.currency}>
              <div className="flow-tile">
                <span className="flow-label">{t('accounts.moneyIn', { currency: f.currency })}</span>
                <span className="flow-amount in">{formatAmount(f.inCents, f.currency)}</span>
              </div>
              <div className="flow-tile">
                <span className="flow-label">{t('accounts.moneyOut', { currency: f.currency })}</span>
                <span className="flow-amount">{formatAmount(-f.outCents, f.currency)}</span>
              </div>
            </Fragment>
          ))}
        </div>
      )}

      {upcoming.length > 0 && (
        <>
          <div className="section-label">{t('accounts.comingUp')}</div>
          <div className="day-card account-page-card">
            {upcoming.map((o) => {
              const rule = ruleById.get(o.scheduleId)!;
              const overdue = o.date <= today;
              return (
                <Link key={`${o.scheduleId}:${o.date}`} to={`/schedules/${rule.id}`} className="tx-row tx-row-tappable">
                  <div className="tx-left">
                    <div className="tx-main">
                      <span className="tx-note">{rule.name}</span>
                      <span className="tx-meta">
                        {overdue && <span className="due-tag">{t('accounts.due')}</span>}
                        {formatOccurrenceDate(o.date, today)}
                      </span>
                    </div>
                  </div>
                  <span className={`tx-amt ${o.amountCents < 0 ? 'out' : 'in'}`}>{formatAmount(o.amountCents, rule.currency)}</span>
                </Link>
              );
            })}
          </div>
        </>
      )}

      <div className="section-label section-label-row">
        <span>{t('home.recent')}</span>
        {recent.length > 0 && (
          <Link to={`/transactions?account=${encodeURIComponent(account.id)}`} className="section-link">
            {t('home.seeAll')}
          </Link>
        )}
      </div>
      {recent.length === 0 ? (
        <p className="empty-note">{t('accounts.noTransactions')}</p>
      ) : (
        <div className="recent">
          {groupByDay(recent).map((group) => (
            <Fragment key={group.label}>
              <div className="day-label">
                <span>{group.label}</span>
              </div>
              <div className="day-card">
                {group.items.map((tx) => {
                  const category = store.categories.find((c) => c.id === tx.categoryId);
                  const leg = legs.get(tx.id);
                  const amount = leg ?? tx.amountCents;
                  return (
                    <Link key={tx.id} to={`/transactions/${tx.id}`} className="tx-row tx-row-tappable">
                      <div className="tx-left">
                        <div className="tx-main">
                          <span className="tx-note">
                            {tx.privateToProfileId && <PrivateMark />}
                            {transactionTitle(tx, category)}
                          </span>
                          {leg !== undefined && (
                            <span className="tx-meta">{t('accounts.splitLeg', { total: formatAmount(tx.amountCents, tx.currency) })}</span>
                          )}
                        </div>
                      </div>
                      <span className={`tx-amt ${amount < 0 ? 'out' : 'in'}`}>{formatAmount(amount, tx.currency)}</span>
                    </Link>
                  );
                })}
              </div>
            </Fragment>
          ))}
        </div>
      )}

      {editing && (
        <BottomSheet title={accountLabel(account)} eyebrow={t('accounts.editing')} onClose={() => setEditing(false)}>
          <AccountForm account={account} onDone={() => setEditing(false)} />
        </BottomSheet>
      )}
    </main>
  );
}

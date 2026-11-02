import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useStore } from '../lib/store';
import { accountLabel, formatAmount, groupByDay, transactionTitle } from '../lib/format';
import { totalsByCurrency } from '../lib/filterTransactions';
import { getLocalUserId } from '../lib/identity';
import { hasHousehold, personLabel, useHouseholdPeers } from '../lib/household';
import { PayerBadge } from './PayerBadge';
import { PrivateMark } from './PrivateMark';
import { useWidthClass } from '../lib/layout';

const PREVIEW_COUNT = 5;

export function RecentList() {
  const store = useStore();
  const { t } = useTranslation();
  const peers = useHouseholdPeers();
  const showPayerBadge = hasHousehold(peers);
  // Phones dock the entry box at the bottom of Home (docs/31); wider
  // windows put it in the top bar (docs/80 D312) — same check as App.tsx.
  const entryBelow = useWidthClass() === 'compact';
  const active = [...store.transactions]
    .filter((tx) => !tx.deletedAt)
    .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));
  const recent = active.slice(0, PREVIEW_COUNT);

  // docs/35 — a day's subtotal must reflect every transaction on that
  // calendar day, not just the ones that made it into this PREVIEW_COUNT
  // slice: the boundary day at the cutoff could be split across it, and a
  // partial sum under a "Today"/"Yesterday" header would misrepresent the
  // whole day. formatRelativeDate's label is a stable per-day string (the
  // same property groupByDay itself relies on for its own grouping), so
  // it doubles as a safe join key between the full and the capped list.
  const fullDayTotals = new Map(groupByDay(active).map((g) => [g.label, totalsByCurrency(g.items)]));

  if (recent.length === 0) {
    return (
      <section>
        <div className="section-label">{t('home.recent')}</div>
        <p className="empty-note">{t(entryBelow ? 'home.emptyBelow' : 'home.empty')}</p>
      </section>
    );
  }

  return (
    <section>
      <div className="section-label">{t('home.recent')}</div>
      <div className="recent">
        {groupByDay(recent).map((group) => (
          <Fragment key={group.label}>
            <div className="day-label">
              <span>{group.label}</span>
              <span className="day-subtotal">
                {(fullDayTotals.get(group.label) ?? []).map((total, i) => (
                  <span key={total.currency}>{i > 0 && ' · '}{formatAmount(total.cents, total.currency)}</span>
                ))}
              </span>
            </div>
            <div className="day-card">
              {group.items.map((tx) => {
                const account = store.accounts.find((a) => a.id === tx.accountId);
                const category = store.categories.find((c) => c.id === tx.categoryId);
                // docs/50 — a split transaction has no single account; show
                // how many legs it's split across instead of the
                // misleading '—' fallback (it has 2+ accounts, not zero).
                const accountSegment =
                  tx.accountId === null
                    ? t('transaction.splitCount', { count: store.transactionSplits.filter((s) => s.transactionId === tx.id).length })
                    : account
                      ? accountLabel(account)
                      : '—';
                return (
                  <Link key={tx.id} to={`/transactions/${tx.id}`} className="tx-row tx-row-tappable">
                    <div className="tx-left">
                      {showPayerBadge && (
                        <PayerBadge label={personLabel(tx.paidByUserId, peers, store.profiles)} mine={tx.paidByUserId === getLocalUserId()} />
                      )}
                      <div className="tx-main">
                        <span className="tx-note">
                          {tx.privateToProfileId && <PrivateMark />}
                          {transactionTitle(tx, category)}
                        </span>
                        {/* day-label above already carries the date — just the account here */}
                        <span className="tx-meta">{accountSegment}</span>
                      </div>
                    </div>
                    <span className={`tx-amt ${tx.amountCents < 0 ? 'out' : 'in'}`}>
                      {formatAmount(tx.amountCents, tx.currency)}
                    </span>
                  </Link>
                );
              })}
            </div>
          </Fragment>
        ))}
      </div>
      {active.length > PREVIEW_COUNT && (
        <Link to="/transactions" className="see-all">{t('home.seeAll')}</Link>
      )}
    </section>
  );
}

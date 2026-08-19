import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../lib/store';
import { accountLabel, formatAmount, groupByDay, transactionTitle } from '../lib/format';
import { totalsByCurrency } from '../lib/filterTransactions';

const PREVIEW_COUNT = 5;

export function RecentList() {
  const store = useStore();
  const active = [...store.transactions]
    .filter((t) => !t.deletedAt)
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
        <div className="section-label">Recent</div>
        <p className="empty-note">Nothing logged yet — try the entry box above.</p>
      </section>
    );
  }

  return (
    <section>
      <div className="section-label">Recent</div>
      <div className="recent">
        {groupByDay(recent).map((group) => (
          <Fragment key={group.label}>
            <div className="day-label">
              <span>{group.label}</span>
              <span className="day-subtotal">
                {(fullDayTotals.get(group.label) ?? []).map((t, i) => (
                  <span key={t.currency}>{i > 0 && ' · '}{formatAmount(t.cents, t.currency)}</span>
                ))}
              </span>
            </div>
            {group.items.map((t) => {
              const account = store.accounts.find((a) => a.id === t.accountId);
              const category = store.categories.find((c) => c.id === t.categoryId);
              return (
                <Link key={t.id} to={`/transactions/${t.id}`} className="tx-row tx-row-tappable">
                  <div className="tx-main">
                    <span className="tx-note">{transactionTitle(t, category)}</span>
                    {/* day-label above already carries the date — just the account here */}
                    <span className="tx-meta">{account ? accountLabel(account) : '—'}</span>
                  </div>
                  <span className={`tx-amt ${t.amountCents < 0 ? 'out' : 'in'}`}>
                    {formatAmount(t.amountCents, t.currency)}
                  </span>
                </Link>
              );
            })}
          </Fragment>
        ))}
      </div>
      {active.length > PREVIEW_COUNT && (
        <Link to="/transactions" className="see-all">see all →</Link>
      )}
    </section>
  );
}

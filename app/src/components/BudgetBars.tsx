import { useTranslation } from 'react-i18next';
import { useStore } from '../lib/store';
import { categoryLabel } from '../lib/starterLabels';
import { formatAmount } from '../lib/format';
import { committedForMonth, postedKeys } from '../lib/schedules';

export function BudgetBars() {
  const store = useStore();
  const { t } = useTranslation();
  // Local date construction, not toISOString() — that's UTC and would land
  // on the wrong month for anyone in a positive-UTC-offset timezone (local
  // midnight minus the offset rolls back into the previous UTC day).
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

  // docs/10 D40: one bar per (category, currency) that has a budget or spend
  // this month — never merged across currencies.
  const spendByKey = new Map<string, number>();
  for (const tx of store.transactions) {
    if (tx.deletedAt || !tx.categoryId || tx.amountCents >= 0) continue;
    if (!tx.occurredAt.startsWith(monthStart.slice(0, 7))) continue;
    const key = `${tx.categoryId}:${tx.currency}`;
    spendByKey.set(key, (spendByKey.get(key) ?? 0) + -tx.amountCents);
  }

  // docs/57 D213 — open scheduled payments still to come this month,
  // shown as their own segment after "spent", never merged into it.
  const committedByKey = committedForMonth(store.scheduledPayments, postedKeys(store.transactions), monthStart);

  const rows = store.budgets
    .filter((b) => b.month === monthStart)
    .map((b) => {
      const key = `${b.categoryId}:${b.currency}`;
      const category = store.categories.find((c) => c.id === b.categoryId);
      const spent = spendByKey.get(key) ?? 0;
      const committed = committedByKey.get(key) ?? 0;
      return { ...b, categoryName: category ? categoryLabel(category) : '—', spent, committed };
    });

  if (rows.length === 0) return null;

  return (
    <section>
      <div className="section-label">{t('insights.thisMonth')}</div>
      {rows.map((r) => {
        const pct = r.amountCents > 0 ? Math.min(100, (r.spent / r.amountCents) * 100) : 0;
        const committedPct = r.amountCents > 0 ? Math.min(100 - pct, (r.committed / r.amountCents) * 100) : 0;
        const over = r.spent > r.amountCents;
        const willBeOver = !over && r.spent + r.committed > r.amountCents;
        return (
          <div className="budget-row" key={`${r.categoryId}:${r.currency}`}>
            <div className="labels">
              <span className="name">{r.categoryName} ({r.currency})</span>
              <span className="amt">
                {formatAmount(r.spent, r.currency)} / {formatAmount(r.amountCents, r.currency)}
              </span>
            </div>
            <div className="track">
              <div className={`fill ${over ? 'over' : ''}`} style={{ width: `${pct}%` }} />
              {committedPct > 0 && (
                <div className={`fill committed ${willBeOver ? 'over' : ''}`} style={{ width: `${committedPct}%` }} />
              )}
            </div>
            {r.committed > 0 && (
              <div className="budget-committed-note">{t('insights.scheduled', { amount: formatAmount(r.committed, r.currency) })}</div>
            )}
          </div>
        );
      })}
    </section>
  );
}

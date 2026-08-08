import { useStore } from '../lib/store';
import { formatAmount } from '../lib/format';

// docs/07: trend chart stays primary-currency only. "Primary currency" is
// meant to be a local device preference (docs/10) — no settings UI for it
// yet, so this hardcodes CAD until that lands.
const PRIMARY_CURRENCY = 'CAD';
const DAYS = 30;

export function TrendSparkline() {
  const store = useStore();

  const days: string[] = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }

  const spendByDay = new Map<string, number>();
  for (const t of store.transactions) {
    if (t.deletedAt || t.currency !== PRIMARY_CURRENCY || t.amountCents >= 0) continue;
    spendByDay.set(t.occurredOn, (spendByDay.get(t.occurredOn) ?? 0) + -t.amountCents);
  }

  const values = days.map((d) => spendByDay.get(d) ?? 0);
  const total = values.reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...values);

  const w = 240;
  const h = 46;
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - (v / max) * (h - 6) - 2;
    return [x, y] as const;
  });
  const line = points.map(([x, y]) => `${x},${y}`).join(' L');
  const area = `M0,${h} L${line} L${w},${h} Z`;
  const [lastX, lastY] = points[points.length - 1];

  return (
    <div className="trend-card">
      <div className="trend-head">
        <span className="t">Last {DAYS} days ({PRIMARY_CURRENCY})</span>
        <span className="v">{formatAmount(total, PRIMARY_CURRENCY)}</span>
      </div>
      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--accent)" stopOpacity="0.35" />
            <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#trend-fill)" />
        <path d={`M${line}`} fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={lastX} cy={lastY} r="3" fill="var(--accent)" />
      </svg>
    </div>
  );
}

import { formatAmount } from '../lib/format';

interface Props {
  amountCents: number;
  currency: string;
  direction: 'expense' | 'income';
  onDigit: (digit: string) => void;
  onBackspace: () => void;
  onToggleDirection: () => void;
}

// Shared between EntryZone (create) and TransactionList's edit panel — the
// number-entry experience should be identical whether you're logging a new
// transaction or fixing an existing one.
export function AmountKeypad({ amountCents, currency, direction, onDigit, onBackspace, onToggleDirection }: Props) {
  return (
    <>
      <div className="amount-preview">{formatAmount(amountCents, currency)}</div>
      <div className="keys">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} className="key" onClick={() => onDigit(d)}>
            {d}
          </button>
        ))}
        <button className="key" onClick={onBackspace}>⌫</button>
        <button className="key" onClick={() => onDigit('0')}>0</button>
        <button className="key done" onClick={onToggleDirection} title="Toggle expense/income">
          {direction === 'expense' ? '−' : '+'}
        </button>
      </div>
    </>
  );
}

import { personInitial } from '../lib/household';

// docs/26 D121 — filled/accent = paid by you, outline = paid by the other
// household member. Shared across the Recent/Transactions list rows, the
// "Paid by" chip row, and Settings' household member list so the mine/
// theirs visual language stays identical everywhere it appears.
export function PayerBadge({ label, mine, className }: { label: string; mine: boolean; className?: string }) {
  return <span className={`payer-badge ${mine ? 'mine' : 'theirs'}${className ? ` ${className}` : ''}`}>{personInitial(label)}</span>;
}

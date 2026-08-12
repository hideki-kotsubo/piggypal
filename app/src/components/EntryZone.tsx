import { useState } from 'react';
import { useStore } from '../lib/store';
import { nowLocal } from '../lib/format';
import { AccountCurrencyPicker } from './AccountCurrencyPicker';
import { AmountKeypad } from './AmountKeypad';
import { CategoryPicker } from './CategoryPicker';
import type { Transaction } from '../lib/types';

interface Props {
  onSubmitted: (message: string, onUndo?: () => void) => void;
}

export function EntryZone({ onSubmitted }: Props) {
  const store = useStore();
  const [expanded, setExpanded] = useState(false);
  const [typedText, setTypedText] = useState('');
  const [digits, setDigits] = useState(''); // POS-style: rightmost 2 digits = cents
  const [direction, setDirection] = useState<'expense' | 'income'>('expense');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [currency, setCurrency] = useState<string | null>(null);

  const resolvedAccountId = accountId ?? store.defaultAccountId();
  const resolvedCurrency = currency ?? store.defaultCurrencyFor(resolvedAccountId);
  const amountCents = digits === '' ? 0 : Number(digits);

  function open() {
    setExpanded(true);
  }

  function reset() {
    setExpanded(false);
    setTypedText('');
    setDigits('');
    setDirection('expense');
    setAccountId(null);
    setCurrency(null);
  }

  function pressDigit(d: string) {
    setDigits((prev) => (prev + d).slice(-9)); // cap so amounts can't grow unbounded
  }

  function backspace() {
    setDigits((prev) => prev.slice(0, -1));
  }

  function submitTap(categoryId: string) {
    if (amountCents === 0) return;
    const tx: Transaction = {
      id: crypto.randomUUID(),
      accountId: resolvedAccountId,
      categoryId,
      amountCents: direction === 'expense' ? -amountCents : amountCents,
      currency: resolvedCurrency,
      occurredAt: nowLocal(),
      note: store.categories.find((c) => c.id === categoryId)?.name ?? null,
      source: 'manual',
      aiRaw: null,
      deletedAt: null,
    };
    store.addTransaction(tx);
    onSubmitted('Added', () => store.deleteTransaction(tx.id));
    reset();
  }

  function submitTyped(e: React.FormEvent) {
    e.preventDefault();
    if (!typedText.trim()) return;
    // Tier 1/2 parsing (docs/04) isn't wired up yet — this is UI scaffolding only.
    onSubmitted("Typed entry isn't wired to the AI parser yet (docs/04) — use the pad below for now");
    setTypedText('');
  }

  return (
    <div className="entry-zone">
      {!expanded && (
        <button className="entry-trigger" onClick={open}>
          type or tap what you spent…
        </button>
      )}

      {expanded && (
        <>
          <form onSubmit={submitTyped}>
            <input
              className="entry-input"
              placeholder="type or tap what you spent…"
              value={typedText}
              onChange={(e) => setTypedText(e.target.value)}
            />
          </form>

          <div className="keypad-panel">
            <AccountCurrencyPicker
              accountId={resolvedAccountId}
              currency={resolvedCurrency}
              onChange={(newAccountId, newCurrency) => {
                setAccountId(newAccountId);
                setCurrency(newCurrency);
              }}
            />

            <AmountKeypad
              amountCents={amountCents}
              currency={resolvedCurrency}
              direction={direction}
              onDigit={pressDigit}
              onBackspace={backspace}
              onToggleDirection={() => setDirection((d) => (d === 'expense' ? 'income' : 'expense'))}
            />

            <CategoryPicker selectedId={null} onPick={submitTap} />
            <div className="chip-row">
              <button className="chip ghost" onClick={reset}>cancel</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

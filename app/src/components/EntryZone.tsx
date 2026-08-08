import { useState } from 'react';
import { useStore } from '../lib/store';
import { accountLabel, formatAmount } from '../lib/format';
import type { Transaction } from '../lib/types';

interface Props {
  onSubmitted: (message: string) => void;
}

export function EntryZone({ onSubmitted }: Props) {
  const store = useStore();
  const [expanded, setExpanded] = useState(false);
  const [typedText, setTypedText] = useState('');
  const [digits, setDigits] = useState(''); // POS-style: rightmost 2 digits = cents
  const [direction, setDirection] = useState<'expense' | 'income'>('expense');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [currency, setCurrency] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState<'account' | 'currency' | null>(null);

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
    setPickerOpen(null);
  }

  function pressDigit(d: string) {
    setDigits((prev) => (prev + d).slice(-9)); // cap so amounts can't grow unbounded
  }

  function backspace() {
    setDigits((prev) => prev.slice(0, -1));
  }

  function pickAccount(id: string) {
    setAccountId(id);
    setCurrency(null); // D46: switching account resets the currency default
    setPickerOpen(null);
  }

  function submitTap(categoryId: string) {
    if (amountCents === 0) return;
    const tx: Transaction = {
      id: crypto.randomUUID(),
      accountId: resolvedAccountId,
      categoryId,
      amountCents: direction === 'expense' ? -amountCents : amountCents,
      currency: resolvedCurrency,
      occurredOn: new Date().toISOString().slice(0, 10),
      note: store.categories.find((c) => c.id === categoryId)?.name ?? null,
      source: 'manual',
      aiRaw: null,
      deletedAt: null,
    };
    store.addTransaction(tx);
    onSubmitted('Added — Undo');
    reset();
  }

  function submitTyped(e: React.FormEvent) {
    e.preventDefault();
    if (!typedText.trim()) return;
    // Tier 1/2 parsing (docs/04) isn't wired up yet — this is UI scaffolding only.
    onSubmitted("Typed entry isn't wired to the AI parser yet (docs/04) — use the pad below for now");
    setTypedText('');
  }

  const account = store.accounts.find((a) => a.id === resolvedAccountId);
  const rankedAccounts = store.rankedAccounts();
  const rankedCurrencies = store.rankedCurrencies(resolvedAccountId);
  const rankedCategories = store.rankedCategories();

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
          <div className="pill-row">
            <button className="pill-tap" onClick={() => setPickerOpen(pickerOpen === 'account' ? null : 'account')}>
              {account ? accountLabel(account) : '—'} ▾
            </button>
            <button className="pill-tap" onClick={() => setPickerOpen(pickerOpen === 'currency' ? null : 'currency')}>
              {resolvedCurrency} ▾
            </button>
          </div>

          {pickerOpen === 'account' && (
            <div className="chip-row">
              {rankedAccounts.map((a) => (
                <button
                  key={a.id}
                  className={`chip ${a.id === resolvedAccountId ? 'picked' : ''}`}
                  onClick={() => pickAccount(a.id)}
                >
                  {accountLabel(a)}
                </button>
              ))}
            </div>
          )}

          {pickerOpen === 'currency' && (
            <div className="chip-row">
              {rankedCurrencies.map((c) => (
                <button
                  key={c}
                  className={`chip ${c === resolvedCurrency ? 'picked' : ''}`}
                  onClick={() => {
                    setCurrency(c);
                    setPickerOpen(null);
                  }}
                >
                  {c}
                </button>
              ))}
            </div>
          )}

          <div className="amount-preview">
            {formatAmount(amountCents, resolvedCurrency)}
          </div>

          <div className="keys">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
              <button key={d} className="key" onClick={() => pressDigit(d)}>
                {d}
              </button>
            ))}
            <button className="key" onClick={backspace}>⌫</button>
            <button className="key" onClick={() => pressDigit('0')}>0</button>
            <button
              className="key done"
              onClick={() => setDirection((d) => (d === 'expense' ? 'income' : 'expense'))}
              title="Toggle expense/income"
            >
              {direction === 'expense' ? '−' : '+'}
            </button>
          </div>

          <div className="chip-row">
            {rankedCategories.map((c) => (
              <button key={c.id} className="chip" onClick={() => submitTap(c.id)}>
                {c.name}
              </button>
            ))}
            <button className="chip ghost" onClick={reset}>cancel</button>
          </div>
          </div>
        </>
      )}
    </div>
  );
}

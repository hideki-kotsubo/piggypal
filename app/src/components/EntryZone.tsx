import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../lib/store';
import { nowLocal } from '../lib/format';
import { parseUtterance } from '../lib/parser';
import { isSpeechInputSupported, startSpeechInput } from '../lib/speechInput';
import { AccountCurrencyPicker } from './AccountCurrencyPicker';
import { AmountKeypad } from './AmountKeypad';
import { CategoryPicker } from './CategoryPicker';
import type { Transaction } from '../lib/types';

interface Props {
  onSubmitted: (message: string, onUndo?: () => void) => void;
}

export function EntryZone({ onSubmitted }: Props) {
  const store = useStore();
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const [typedText, setTypedText] = useState('');
  const [digits, setDigits] = useState(''); // POS-style: rightmost 2 digits = cents
  const [direction, setDirection] = useState<'expense' | 'income'>('expense');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [currency, setCurrency] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);

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
      merchant: null, // tap-entry is Tier 1 — never attempts extraction, see docs/15 D77
      source: 'manual',
      aiRaw: null,
      deletedAt: null,
    };
    store.addTransaction(tx);
    reset();
    // docs/17: land straight on the new transaction's dedicated screen
    // instead of a toast — Note/Location/Date-Time are one tap away there
    // instead of requiring a hunt back through Recent afterward (the
    // motivating pain point). No separate undo affordance needed: the
    // screen's own "Delete transaction" action covers it, and a 5s toast
    // would be cut short by the navigation anyway.
    navigate(`/transactions/${tx.id}`);
  }

  // docs/16: Tier 1 (docs/04) — on-device, offline, free. No amount found
  // at all soft-blocks (doesn't insert, text stays editable) rather than
  // the spec's undefined "draft" concept, since amount_cents is NOT NULL
  // in the schema. An ambiguous/no-match category degrades into the
  // existing uncategorized inbox (docs/07) exactly like tap-entry's
  // never-guess principle elsewhere in this app.
  function submitTyped(e: React.FormEvent) {
    e.preventDefault();
    const text = typedText.trim();
    if (!text) return;

    const result = parseUtterance(text, {
      categories: store.categories,
      keywords: store.categoryKeywords,
      accounts: store.accounts,
      now: new Date(),
    });

    if (result.amountCents === null) {
      onSubmitted("Couldn't find an amount — try rephrasing, or use the pad below");
      return;
    }

    const parsedAccountId = result.accountId ?? store.defaultAccountId();
    const parsedCurrency = result.currency ?? store.defaultCurrencyFor(parsedAccountId);
    const category = result.categoryId ? store.categories.find((c) => c.id === result.categoryId) : undefined;

    const tx: Transaction = {
      id: crypto.randomUUID(),
      accountId: parsedAccountId,
      categoryId: result.categoryId,
      amountCents: result.direction === 'expense' ? -result.amountCents : result.amountCents,
      currency: parsedCurrency,
      occurredAt: result.occurredAt ?? nowLocal(),
      note: category?.name ?? null,
      merchant: null, // Tier 1 never attempts merchant extraction, see docs/15 D77
      source: 'ai',
      aiRaw: text,
      deletedAt: null,
    };
    store.addTransaction(tx);
    setTypedText('');
    onSubmitted(
      result.categoryId ? 'Added' : 'Added to your inbox — needs a category',
      () => store.deleteTransaction(tx.id),
    );
  }

  // Voice only fills the text field above — no separate parse path, it's
  // parsed the same way on submit either way. Feature-detected: the mic
  // button doesn't render at all when unsupported (e.g. desktop Firefox).
  function toggleVoice() {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const handle = startSpeechInput({
      onResult: (transcript) => setTypedText(transcript),
      onError: () => setListening(false),
      onEnd: () => setListening(false),
    });
    if (!handle) return;
    recognitionRef.current = handle;
    setListening(true);
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
            <div className="entry-input-row">
              <input
                className="entry-input"
                placeholder="type or tap what you spent…"
                value={typedText}
                onChange={(e) => setTypedText(e.target.value)}
              />
              {isSpeechInputSupported() && (
                <button
                  type="button"
                  className={`mic-btn ${listening ? 'listening' : ''}`}
                  onClick={toggleVoice}
                  aria-label={listening ? 'Stop voice input' : 'Start voice input'}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <rect x="5" y="1" width="4" height="7" rx="2" stroke="currentColor" strokeWidth="1.3" />
                    <path d="M2.5 6.5C2.5 9 4.5 11 7 11C9.5 11 11.5 9 11.5 6.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                    <path d="M7 11V13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  </svg>
                </button>
              )}
            </div>
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

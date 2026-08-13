import { useState } from 'react';
import { useStore } from '../lib/store';
import { AccountCurrencyPicker } from './AccountCurrencyPicker';
import { AmountKeypad } from './AmountKeypad';
import { CategoryPicker } from './CategoryPicker';
import type { Transaction } from '../lib/types';

// occurredAt is "YYYY-MM-DDTHH:MM:SS" — split for the two native inputs,
// recombine on either one's change so the other half is never lost.
function datePart(occurredAt: string): string {
  return occurredAt.slice(0, 10);
}
function timePart(occurredAt: string): string {
  return occurredAt.slice(11, 16);
}
function combine(date: string, time: string): string {
  return `${date}T${time}:00`;
}

// Shared between TransactionList (the full "Transactions" screen) and
// RecentList (Home's preview) — same expand-in-place edit panel either way.
export function TransactionEditForm({ transaction, onDone }: { transaction: Transaction; onDone: () => void }) {
  const store = useStore();
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  // Local mirror of the Note field — `transaction.note` comes straight
  // from the store, and commit() writes through an async DB round-trip
  // (PowerSync live query), so binding the input's value directly to it
  // snaps the cursor to the end on every keystroke once that round-trip
  // resolves. Same fix as AccountsScreen's Name/Institution fields: local
  // state updates synchronously for display, the store write happens on
  // the side.
  const [noteStr, setNoteStr] = useState(() => transaction.note ?? '');
  // Same local-mirror reasoning as noteStr above — docs/15.
  const [merchantStr, setMerchantStr] = useState(() => transaction.merchant ?? '');
  const category = store.categories.find((c) => c.id === transaction.categoryId);
  // docs/15 D79: recency order comes from the store; narrowing by the
  // typed substring (contains, not just starts-with — same rule as the
  // Institution-autosuggest backlog item) is this component's own job.
  const merchantSuggestions = store
    .rankedMerchants(transaction.id)
    .filter((m) => m.toLowerCase().includes(merchantStr.toLowerCase()));
  // <= 0, not < 0 — a brand-new blank transaction (docs/19's "+" quick-add)
  // starts at exactly $0, which a real, already-entered transaction never
  // is; treating that as expense (the common case) rather than income
  // gives digit entry the right sign from the first tap.
  const direction: 'expense' | 'income' = transaction.amountCents <= 0 ? 'expense' : 'income';

  function commit(patch: Partial<Transaction>) {
    store.updateTransaction(transaction.id, patch);
  }

  // Keypad edits the amount live, digit by digit, same as creating —
  // starts pre-loaded with the transaction's current amount rather than
  // empty. Each digit tap autosaves immediately, consistent with every
  // other field in this form (no separate "save" step for existing rows).
  function pressDigit(d: string) {
    const digits = String(Math.abs(transaction.amountCents)) + d;
    commit({ amountCents: direction === 'expense' ? -Number(digits) : Number(digits) });
  }

  function backspace() {
    const digits = String(Math.abs(transaction.amountCents)).slice(0, -1);
    const cents = digits === '' ? 0 : Number(digits);
    commit({ amountCents: direction === 'expense' ? -cents : cents });
  }

  function toggleDirection() {
    const cents = Math.abs(transaction.amountCents);
    commit({ amountCents: direction === 'expense' ? cents : -cents });
  }

  function remove() {
    if (!window.confirm('Delete this transaction? This can\'t be undone from here.')) return;
    store.deleteTransaction(transaction.id);
    onDone();
  }

  return (
    <div className="account-form">
      <div className="form-actions edit-form-top-actions">
        <button className="text-link delete-link" onClick={remove}>Delete transaction</button>
      </div>

      <AccountCurrencyPicker
        accountId={transaction.accountId}
        currency={transaction.currency}
        onChange={(accountId, currency) => commit({ accountId, currency })}
      />

      <AmountKeypad
        amountCents={Math.abs(transaction.amountCents)}
        currency={transaction.currency}
        direction={direction}
        onDigit={pressDigit}
        onBackspace={backspace}
        onToggleDirection={toggleDirection}
      />

      <div>
        <button className="pill-tap" onClick={() => setCategoryPickerOpen((o) => !o)}>
          {category?.name ?? 'Uncategorized'} ▾
        </button>
        {categoryPickerOpen && (
          <CategoryPicker
            selectedId={transaction.categoryId}
            onPick={(categoryId) => {
              commit({ categoryId });
              setCategoryPickerOpen(false);
            }}
          />
        )}
      </div>

      <div className="field-pair">
        <label className="field-label">
          Date
          <input
            className="text-input"
            type="date"
            value={datePart(transaction.occurredAt)}
            onChange={(e) => commit({ occurredAt: combine(e.target.value, timePart(transaction.occurredAt)) })}
          />
        </label>

        <label className="field-label">
          Time
          <input
            className="text-input"
            type="time"
            value={timePart(transaction.occurredAt)}
            onChange={(e) => commit({ occurredAt: combine(datePart(transaction.occurredAt), e.target.value) })}
          />
        </label>
      </div>

      <label className="field-label">
        Note
        <input
          className="text-input"
          value={noteStr}
          onChange={(e) => {
            const v = e.target.value;
            setNoteStr(v);
            commit({ note: v || null });
          }}
        />
      </label>

      <label className="field-label">
        Location
        <input
          className="text-input"
          placeholder="optional…"
          value={merchantStr}
          onChange={(e) => {
            const v = e.target.value;
            setMerchantStr(v);
            commit({ merchant: v || null });
          }}
        />
      </label>
      {merchantSuggestions.length > 0 && (
        <div className="chip-row">
          {merchantSuggestions.map((m) => (
            <button
              key={m}
              className={`chip ${m === merchantStr ? 'picked' : ''}`}
              onClick={() => {
                setMerchantStr(m);
                commit({ merchant: m });
              }}
            >
              {m}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

import { useState } from 'react';
import { useStore } from '../lib/store';
import { AccountCurrencyPicker } from './AccountCurrencyPicker';
import { AmountKeypad } from './AmountKeypad';
import { CategoryPicker } from './CategoryPicker';
import { PayerBadge } from './PayerBadge';
import { hasHousehold, householdMembers, personLabel } from '../lib/household';
import { usePairedPeers } from '../lib/peers';
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
  const [peers] = usePairedPeers();
  const showHousehold = hasHousehold(peers);
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
  // Same local-mirror reasoning as noteStr/merchantStr — a real bug found
  // via Playwright verifying an unrelated feature: pressDigit/backspace/
  // toggleDirection all used to read transaction.amountCents (the prop,
  // stale until commit()'s async round-trip resolves) as the basis for
  // computing the next value. Digit presses faster than that round-trip
  // raced — a second press read the still-stale amount and silently
  // overwrote instead of appended (e.g. typing "1" then "0" fast enough
  // could persist $1.00 instead of $10.00). Mirroring the signed amount
  // locally (not just its digits) also keeps direction consistent through
  // a rapid toggle-then-digit sequence.
  const [amountCentsLocal, setAmountCentsLocal] = useState(() => transaction.amountCents);
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
  const direction: 'expense' | 'income' = amountCentsLocal <= 0 ? 'expense' : 'income';

  function commit(patch: Partial<Transaction>) {
    store.updateTransaction(transaction.id, patch);
  }

  // Keypad edits the amount live, digit by digit, same as creating —
  // starts pre-loaded with the transaction's current amount rather than
  // empty. Each digit tap autosaves immediately, consistent with every
  // other field in this form (no separate "save" step for existing rows).
  function pressDigit(d: string) {
    const digits = String(Math.abs(amountCentsLocal)) + d;
    const next = direction === 'expense' ? -Number(digits) : Number(digits);
    setAmountCentsLocal(next);
    commit({ amountCents: next });
  }

  function backspace() {
    const digits = String(Math.abs(amountCentsLocal)).slice(0, -1);
    const cents = digits === '' ? 0 : Number(digits);
    const next = direction === 'expense' ? -cents : cents;
    setAmountCentsLocal(next);
    commit({ amountCents: next });
  }

  function toggleDirection() {
    const next = -amountCentsLocal;
    setAmountCentsLocal(next);
    commit({ amountCents: next });
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
        amountCents={Math.abs(amountCentsLocal)}
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

      {showHousehold && (
        <div>
          <div className="field-label">Paid by</div>
          <div className="chip-row">
            {householdMembers(peers).map((m) => (
              <button
                key={m.userId}
                className={`chip chip-payer ${m.userId === transaction.paidByUserId ? 'picked' : ''}`}
                onClick={() => commit({ paidByUserId: m.userId })}
              >
                <PayerBadge label={m.label} mine={m.isYou} />
                {m.label}
              </button>
            ))}
          </div>
          {/* createdByUserId is immutable (set once at insert, docs/24 D110)
              — plain caption text, no tap target, mirroring that at the
              interaction level. No creation timestamp shown alongside the
              name: this app doesn't track one locally (occurredAt is the
              user-editable transaction date, not a log-time), so this is
              deliberately narrower than docs/26's mockup rather than
              fabricating a time that isn't real. */}
          <p className="provenance">Logged by {personLabel(transaction.createdByUserId, peers)}</p>
        </div>
      )}

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

      {/* Every field above already autosaves on change — this button isn't
          a "commit my edits" step. It exists so it's visually obvious the
          data is saved and that leaving (same as the back arrow) is safe,
          instead of the only affordance being an app-bar back arrow that
          doesn't look like a save action. */}
      <div className="form-actions">
        <button className="save-btn" onClick={onDone}>Done</button>
      </div>
    </div>
  );
}

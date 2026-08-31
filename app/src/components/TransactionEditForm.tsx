import { useState } from 'react';
import { useStore } from '../lib/store';
import { AccountCurrencyPicker } from './AccountCurrencyPicker';
import { AmountKeypad } from './AmountKeypad';
import { CategoryPicker } from './CategoryPicker';
import { PayerBadge } from './PayerBadge';
import { hasHousehold, householdMembers, personLabel, useHouseholdPeers } from '../lib/household';
import { formatAmount, nowUtc } from '../lib/format';
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
  const peers = useHouseholdPeers();
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
  // docs/50 — same local-mirror pattern as amountCentsLocal above, but for
  // whichever one split leg's keypad is currently open (only one at a
  // time, matching this form's existing tap-to-reveal convention).
  const [openLegId, setOpenLegId] = useState<string | null>(null);
  const [legAmountLocal, setLegAmountLocal] = useState(0);
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

  // docs/50 — a split purchase's per-account breakdown. accountId is null
  // exactly when 2+ of these exist for this transaction (see db/schema.sql).
  const legs = store.transactionSplits
    .filter((s) => s.transactionId === transaction.id)
    .sort((a, b) => a.id.localeCompare(b.id));
  const isSplit = transaction.accountId === null;
  const legsTotal = legs.reduce((sum, l) => sum + l.amountCents, 0);
  const canAddLeg = store.rankedAccounts().some((a) => !legs.some((l) => l.accountId === a.id));

  // docs/50 (revised) — while split, the total is *derived* from the legs,
  // not the other way around: every leg edit recomputes and writes the
  // sum back onto the transaction's own amountCents. Takes the
  // about-to-be-true leg list directly (not a re-read of `legs`, which
  // won't reflect an edit still in flight) so the total is never one edit
  // behind.
  function syncTotalFromLegs(nextLegs: { amountCents: number }[]) {
    const total = nextLegs.reduce((sum, l) => sum + l.amountCents, 0);
    store.updateTransaction(transaction.id, { amountCents: total });
  }

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

  // docs/50 — enters split mode: seeds 2 legs (the transaction's current
  // account + full amount, and a different account with $0) so the common
  // "mostly card A, a bit of card B" case needs minimal retyping.
  function beginSplit() {
    if (transaction.accountId === null) return; // already split
    const currentAccountId = transaction.accountId;
    const alternative = store.rankedAccounts().find((a) => a.id !== currentAccountId);
    // Unlike every other write in this form, startSplit/endSplit are
    // multi-statement db.writeTransaction calls specifically so a failure
    // partway through can't leave a half-applied state (see StoreApi's own
    // comment) — but that guarantee only holds if a real failure actually
    // surfaces instead of being silently swallowed by a bare `void`. If
    // this throws (e.g. the local schema doesn't yet have
    // transaction_splits — needs a real page reload to pick up after a
    // schema change, not just component hot-reload), the transaction
    // itself should have rolled back to its pre-split state; report it
    // rather than leaving the UI looking like the split "worked."
    store.startSplit(transaction.id, [
      { id: crypto.randomUUID(), accountId: currentAccountId, amountCents: transaction.amountCents },
      { id: crypto.randomUUID(), accountId: alternative?.id ?? currentAccountId, amountCents: 0 },
    ]).catch((err) => {
      console.error('piggypal: startSplit failed', err);
      window.alert('Could not start the split. If this app was already open before today, try reloading the page — see console for details.');
    });
  }

  // Leaves split mode: restores a real accountId, defaulting to whichever
  // leg carried the largest portion (most representative of "which account
  // this really belongs to" going forward) — user can still change it via
  // the now-restored normal account picker.
  function cancelSplit() {
    const largest = [...legs].sort((a, b) => Math.abs(b.amountCents) - Math.abs(a.amountCents))[0];
    setOpenLegId(null);
    // The keypad's local mirror (amountCentsLocal) is about to take back
    // over display duty from the plain derived-total text — resync it now
    // rather than leaving it holding whatever value it had before split
    // mode hid it, which could be stale if legs were edited in between.
    setAmountCentsLocal(legsTotal);
    store.endSplit(transaction.id, largest?.accountId ?? store.rankedAccounts()[0]?.id ?? '').catch((err) => {
      console.error('piggypal: endSplit failed', err);
      window.alert('Could not cancel the split — see console for details.');
    });
  }

  function addLeg() {
    const usedIds = new Set(legs.map((l) => l.accountId));
    const nextAccount = store.rankedAccounts().find((a) => !usedIds.has(a.id));
    if (!nextAccount) return;
    // Starts at $0 — doesn't change the total (already the sum of the
    // existing legs), so no syncTotalFromLegs call needed here.
    store.addTransactionSplit({
      id: crypto.randomUUID(),
      transactionId: transaction.id,
      accountId: nextAccount.id,
      amountCents: 0,
      updatedAt: nowUtc(),
    });
  }

  function toggleLegKeypad(legId: string, currentAmount: number) {
    if (openLegId === legId) {
      setOpenLegId(null);
      return;
    }
    setOpenLegId(legId);
    setLegAmountLocal(currentAmount);
  }

  // docs/50 (revised) — each leg edit below also recomputes the total from
  // the legs as they'll be *after* this change (not the current `legs`,
  // which is one render behind the edit in flight).
  function legPressDigit(d: string) {
    if (!openLegId) return;
    const dir: 'expense' | 'income' = legAmountLocal <= 0 ? 'expense' : 'income';
    const digits = String(Math.abs(legAmountLocal)) + d;
    const next = dir === 'expense' ? -Number(digits) : Number(digits);
    setLegAmountLocal(next);
    store.updateTransactionSplit(openLegId, { amountCents: next });
    syncTotalFromLegs(legs.map((l) => (l.id === openLegId ? { ...l, amountCents: next } : l)));
  }

  function legBackspace() {
    if (!openLegId) return;
    const dir: 'expense' | 'income' = legAmountLocal <= 0 ? 'expense' : 'income';
    const digits = String(Math.abs(legAmountLocal)).slice(0, -1);
    const cents = digits === '' ? 0 : Number(digits);
    const next = dir === 'expense' ? -cents : cents;
    setLegAmountLocal(next);
    store.updateTransactionSplit(openLegId, { amountCents: next });
    syncTotalFromLegs(legs.map((l) => (l.id === openLegId ? { ...l, amountCents: next } : l)));
  }

  function legToggleDirection() {
    if (!openLegId) return;
    const next = -legAmountLocal;
    setLegAmountLocal(next);
    store.updateTransactionSplit(openLegId, { amountCents: next });
    syncTotalFromLegs(legs.map((l) => (l.id === openLegId ? { ...l, amountCents: next } : l)));
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
        showAccount={!isSplit}
      />

      {/* docs/50 (revised) — while split, the total is derived from the
          legs below, not directly editable, so the keypad is replaced by
          a plain read-out of the live sum. */}
      {isSplit ? (
        <div className="amount-preview">{formatAmount(transaction.amountCents, transaction.currency)}</div>
      ) : (
        <AmountKeypad
          amountCents={Math.abs(amountCentsLocal)}
          currency={transaction.currency}
          direction={direction}
          onDigit={pressDigit}
          onBackspace={backspace}
          onToggleDirection={toggleDirection}
        />
      )}

      {/* docs/50 — the split-across-accounts editor. The total above is
          derived from these legs, never edited directly while split. */}
      {isSplit && legs.length === 0 ? (
        // Should never happen — startSplit is atomic and always seeds 2
        // legs — but a real failure partway through (e.g. a stale local
        // schema from before transaction_splits existed) could still land
        // here if it slipped past startSplit's own error handling above.
        // Never leave the account genuinely unset with no way back.
        <div className="split-editor">
          <p className="split-remaining-note">
            This transaction has no account set — pick one to fix it.
          </p>
          <AccountCurrencyPicker
            accountId={null}
            currency={transaction.currency}
            onChange={(accountId) => {
              setAmountCentsLocal(legsTotal);
              store.endSplit(transaction.id, accountId).catch((err) => {
                console.error('piggypal: endSplit (recovery) failed', err);
              });
            }}
          />
        </div>
      ) : isSplit ? (
        <div className="split-editor">
          {legs.map((leg) => (
            <div className="split-leg-row" key={leg.id}>
              <AccountCurrencyPicker
                accountId={leg.accountId}
                currency={transaction.currency}
                onChange={(accountId) => store.updateTransactionSplit(leg.id, { accountId })}
                showCurrency={false}
              />
              <button className="split-leg-amount" onClick={() => toggleLegKeypad(leg.id, leg.amountCents)}>
                {formatAmount(leg.amountCents, transaction.currency)}
              </button>
              {legs.length > 2 && (
                <button
                  className="split-leg-remove"
                  aria-label="Remove this leg"
                  onClick={() => {
                    if (openLegId === leg.id) setOpenLegId(null);
                    store.removeTransactionSplit(leg.id);
                    syncTotalFromLegs(legs.filter((l) => l.id !== leg.id));
                  }}
                >
                  ×
                </button>
              )}
              {openLegId === leg.id && (
                <AmountKeypad
                  amountCents={Math.abs(legAmountLocal)}
                  currency={transaction.currency}
                  direction={legAmountLocal <= 0 ? 'expense' : 'income'}
                  onDigit={legPressDigit}
                  onBackspace={legBackspace}
                  onToggleDirection={legToggleDirection}
                />
              )}
            </div>
          ))}

          {canAddLeg && (
            <button className="text-link" onClick={addLeg}>+ add another account</button>
          )}

          <button className="text-link delete-link" onClick={cancelSplit}>Cancel split</button>
        </div>
      ) : (
        <button className="text-link" onClick={beginSplit}>Split across accounts</button>
      )}

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
            {householdMembers(peers, store.profiles).map((m) => (
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
          <p className="provenance">Logged by {personLabel(transaction.createdByUserId, peers, store.profiles)}</p>
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

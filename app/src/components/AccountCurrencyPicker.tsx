import { useState } from 'react';
import { useStore } from '../lib/store';
import { ACCOUNT_PICKER_SCALE_THRESHOLD, useAccountPickerMode } from '../lib/settings';
import { accountLabel } from '../lib/format';
import { personLabel, useHouseholdPeers } from '../lib/household';
import type { Account } from '../lib/types';

interface Props {
  accountId: string | null;
  currency: string;
  onChange: (accountId: string, currency: string) => void;
  // docs/50 — reused for a split purchase's per-leg account picker
  // (showCurrency: false, no per-leg currency — a split is one currency,
  // by construction) and the top-level picker while split mode is active
  // (showAccount: false — the account picker doesn't apply to the
  // transaction as a whole once it has 2+ accounts; the currency picker
  // still does). Both default true, unchanged from every existing call
  // site's behavior.
  showAccount?: boolean;
  showCurrency?: boolean;
}

// A real report: two household members' accounts sharing the same
// institution AND name (each independently named "Scotiabank —
// Checking") were indistinguishable in this picker — every label above
// only ever disambiguates by institution, never by owner, so both
// rendered as the bare "Checking". Groups by (institution, name) and
// flags only the accounts genuinely ambiguous without an owner label —
// distinct owners sharing that same pair, not just any duplicate (two of
// the *same* person's identically-named accounts are a separate,
// pre-existing "these look like real duplicates" case the manual-merge
// tool already covers, not something an owner label would help with).
function accountsNeedingOwnerLabel(accounts: Account[]): Set<string> {
  const groups = new Map<string, Account[]>();
  for (const a of accounts) {
    const key = `${a.institution ?? ''} ${a.name}`;
    const list = groups.get(key);
    if (list) list.push(a);
    else groups.set(key, [a]);
  }
  const result = new Set<string>();
  for (const list of groups.values()) {
    if (new Set(list.map((a) => a.ownerUserId)).size > 1) {
      for (const a of list) result.add(a.id);
    }
  }
  return result;
}

// D68 — an account whose institution has only one account under it shows
// the institution alone ("Wise"), not "Wise — Checking": nothing to
// disambiguate. Institution-less accounts are unaffected (still bare
// name). Counts across ALL accounts, not just the visible slice, so this
// stays correct under the Capped mode's top-N cut too. ownerPrefix (see
// above) is applied last, after whichever base form was chosen, so an
// owner-ambiguous solo-institution account still reads as "Hideki —
// Wise" rather than losing its disambiguation to the institution-only
// shortcut.
function flatChipLabel(a: Account, institutionCounts: Map<string, number>, ownerPrefix: string | null): string {
  const base = !a.institution ? a.name : (institutionCounts.get(a.institution) ?? 0) > 1 ? accountLabel(a) : a.institution;
  return ownerPrefix ? `${ownerPrefix} — ${base}` : base;
}

function countByInstitution(accounts: Account[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const a of accounts) {
    if (!a.institution) continue;
    counts.set(a.institution, (counts.get(a.institution) ?? 0) + 1);
  }
  return counts;
}

// Shared between EntryZone (create) and TransactionList's edit panel.
//
// Account and currency are two fully independent choices — an account has
// no currency of its own (see Account), so picking one only re-defaults
// currency to whatever's typical for that account, never resolves or
// creates anything.
export function AccountCurrencyPicker({ accountId, currency, onChange, showAccount = true, showCurrency = true }: Props) {
  const store = useStore();
  const peers = useHouseholdPeers();
  const [pickerOpen, setPickerOpen] = useState<'account' | 'currency' | null>(null);
  const [pickerMode] = useAccountPickerMode();
  const [expandedInstitutions, setExpandedInstitutions] = useState<Set<string> | null>(null);
  const [cappedExpanded, setCappedExpanded] = useState(false);

  const account = store.accounts.find((a) => a.id === accountId);
  const ranked = store.rankedAccounts();
  const currencyOptions = store.rankedCurrencies(accountId ?? '');
  const institutionCounts = countByInstitution(ranked);
  const needsOwnerLabel = accountsNeedingOwnerLabel(ranked);
  const ownerPrefixFor = (a: Account): string | null =>
    needsOwnerLabel.has(a.id) ? (a.ownerUserId ? personLabel(a.ownerUserId, peers, store.profiles) : 'Shared') : null;

  const overThreshold = ranked.length > ACCOUNT_PICKER_SCALE_THRESHOLD;
  const grouped = overThreshold && pickerMode === 'grouped';

  // Grouped mode: institutions with 2+ accounts collapse to one row (tap
  // to expand); everything else — no institution, or a solo institution —
  // renders as a plain chip via flatChipLabel. Preserves rankedAccounts'
  // frequency order for both groups and plain chips.
  const institutionGroups: { institution: string; accounts: Account[] }[] = [];
  const plainAccounts: Account[] = [];
  if (grouped) {
    const seen = new Set<string>();
    for (const a of ranked) {
      if (a.institution && (institutionCounts.get(a.institution) ?? 0) > 1) {
        if (!seen.has(a.institution)) {
          seen.add(a.institution);
          institutionGroups.push({
            institution: a.institution,
            accounts: ranked.filter((r) => r.institution === a.institution),
          });
        }
      } else {
        plainAccounts.push(a);
      }
    }
  }

  // The group containing the current selection starts expanded — same
  // "most-recently-used opens by default" rule the Accounts screen uses
  // (docs/12 D60/D61) — everything else starts collapsed.
  const effectiveExpanded =
    expandedInstitutions ??
    new Set(account?.institution && institutionGroups.some((g) => g.institution === account.institution)
      ? [account.institution]
      : []);

  function toggleInstitution(institution: string) {
    const next = new Set(effectiveExpanded);
    if (next.has(institution)) next.delete(institution);
    else next.add(institution);
    setExpandedInstitutions(next);
  }

  // Capped mode (and the plain under-threshold case, which is just this
  // with cap === total) shows the top ACCOUNT_PICKER_SCALE_THRESHOLD by existing
  // frequency ranking, plus a flat "+ more" — not re-grouped (docs/13 D67).
  const cap = overThreshold && pickerMode === 'capped' && !cappedExpanded ? ACCOUNT_PICKER_SCALE_THRESHOLD : ranked.length;
  const flatAccounts = grouped ? [] : ranked.slice(0, cap);
  const flatHiddenCount = ranked.length - flatAccounts.length;

  function pickAccount(newAccount: Account) {
    // Re-default currency to the newly picked account's own last-used
    // currency (D45/D46) rather than carrying over whatever was selected
    // for the previous account.
    onChange(newAccount.id, store.defaultCurrencyFor(newAccount.id));
    setPickerOpen(null);
  }

  function pickCurrency(newCurrency: string) {
    // docs/50: with showAccount false (the split top-bar's currency-only
    // usage), accountId can legitimately be null here — pass it through
    // as-is (the caller ignores it in that mode) rather than requiring a
    // resolved Account first.
    onChange(accountId ?? '', newCurrency);
    setPickerOpen(null);
  }

  return (
    <>
      <div className="pill-row">
        {showAccount && (
          <button className="pill-tap" onClick={() => setPickerOpen(pickerOpen === 'account' ? null : 'account')}>
            {account ? (ownerPrefixFor(account) ? `${ownerPrefixFor(account)} — ` : '') + accountLabel(account) : '—'} ▾
          </button>
        )}
        {showCurrency && (
          <button className="pill-tap" onClick={() => setPickerOpen(pickerOpen === 'currency' ? null : 'currency')}>
            {currency} ▾
          </button>
        )}
      </div>

      {showAccount && pickerOpen === 'account' && (
        <div className="chip-row">
          {grouped ? (
            <>
              {institutionGroups.map((g) => {
                const isOpen = effectiveExpanded.has(g.institution);
                return isOpen ? (
                  <div className="picker-group" key={g.institution}>
                    <button className="picker-group-head" onClick={() => toggleInstitution(g.institution)}>
                      <span className="chev">▾</span> {g.institution}
                    </button>
                    <div className="chip-row">
                      {g.accounts.map((a) => (
                        <button
                          key={a.id}
                          className={`chip ${a.id === accountId ? 'picked' : ''}`}
                          onClick={() => pickAccount(a)}
                        >
                          {ownerPrefixFor(a) ? `${ownerPrefixFor(a)} — ${a.name}` : a.name}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <button className="chip" key={g.institution} onClick={() => toggleInstitution(g.institution)}>
                    {g.institution} ▸ {g.accounts.length}
                  </button>
                );
              })}
              {plainAccounts.map((a) => (
                <button
                  key={a.id}
                  className={`chip ${a.id === accountId ? 'picked' : ''}`}
                  onClick={() => pickAccount(a)}
                >
                  {flatChipLabel(a, institutionCounts, ownerPrefixFor(a))}
                </button>
              ))}
            </>
          ) : (
            <>
              {flatAccounts.map((a) => (
                <button
                  key={a.id}
                  className={`chip ${a.id === accountId ? 'picked' : ''}`}
                  onClick={() => pickAccount(a)}
                >
                  {flatChipLabel(a, institutionCounts, ownerPrefixFor(a))}
                </button>
              ))}
              {flatHiddenCount > 0 && (
                <button className="chip ghost" onClick={() => setCappedExpanded(true)}>
                  + {flatHiddenCount} more
                </button>
              )}
            </>
          )}
        </div>
      )}

      {showCurrency && pickerOpen === 'currency' && (
        <div className="chip-row">
          {currencyOptions.map((c) => (
            <button
              key={c}
              className={`chip ${c === currency ? 'picked' : ''}`}
              onClick={() => pickCurrency(c)}
            >
              {c}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

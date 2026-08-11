import { useState } from 'react';
import { useStore } from '../lib/store';
import { ACCOUNT_PICKER_SCALE_THRESHOLD, useAccountPickerMode } from '../lib/settings';
import { accountLabel } from '../lib/format';
import type { Account } from '../lib/types';

interface Props {
  accountId: string;
  currency: string;
  onChange: (accountId: string, currency: string) => void;
}

// D68 — an account whose institution has only one account under it shows
// the institution alone ("Wise"), not "Wise — Checking": nothing to
// disambiguate. Institution-less accounts are unaffected (still bare
// name). Counts across ALL accounts, not just the visible slice, so this
// stays correct under the Capped mode's top-N cut too.
function flatChipLabel(a: Account, institutionCounts: Map<string, number>): string {
  if (!a.institution) return a.name;
  return (institutionCounts.get(a.institution) ?? 0) > 1 ? accountLabel(a) : a.institution;
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
export function AccountCurrencyPicker({ accountId, currency, onChange }: Props) {
  const store = useStore();
  const [pickerOpen, setPickerOpen] = useState<'account' | 'currency' | null>(null);
  const [pickerMode] = useAccountPickerMode();
  const [expandedInstitutions, setExpandedInstitutions] = useState<Set<string> | null>(null);
  const [cappedExpanded, setCappedExpanded] = useState(false);

  const account = store.accounts.find((a) => a.id === accountId);
  const ranked = store.rankedAccounts();
  const currencyOptions = store.rankedCurrencies(accountId);
  const institutionCounts = countByInstitution(ranked);

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
    if (!account) return;
    onChange(account.id, newCurrency);
    setPickerOpen(null);
  }

  return (
    <>
      <div className="pill-row">
        <button className="pill-tap" onClick={() => setPickerOpen(pickerOpen === 'account' ? null : 'account')}>
          {account ? accountLabel(account) : '—'} ▾
        </button>
        <button className="pill-tap" onClick={() => setPickerOpen(pickerOpen === 'currency' ? null : 'currency')}>
          {currency} ▾
        </button>
      </div>

      {pickerOpen === 'account' && (
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
                          {a.name}
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
                  {flatChipLabel(a, institutionCounts)}
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
                  {flatChipLabel(a, institutionCounts)}
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

      {pickerOpen === 'currency' && (
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

import { useState } from 'react';

// docs/73 D272 — "15 dollars" or a bare "$" says *a* dollar but not which
// one. Before this, the account's default currency won, so an English
// "$15" on a reais account saved as R$ 15 (real report, 2026-10-16).
// Now the caller (EntryZone) picks a dollar currency, shown as a guess in
// the parse preview so it can be changed before saving.

// Explicit symbols for when "$" alone would be ambiguous (formatAmount).
export const DOLLAR_SYMBOLS: Record<string, string> = {
  CAD: 'CA$',
  USD: 'US$',
  AUD: 'A$',
  NZD: 'NZ$',
  SGD: 'S$',
  HKD: 'HK$',
};

export const DOLLAR_CURRENCIES = Object.keys(DOLLAR_SYMBOLS);

export type DollarPreference = 'CAD' | 'USD';

const DOLLAR_KEY = 'flowtab:default-dollar';

// A Canadian device region means Canadian dollars; anything else, US.
function deviceDefault(): DollarPreference {
  const langs = typeof navigator === 'undefined' ? [] : navigator.languages?.length ? navigator.languages : [navigator.language];
  return langs.some((l) => l.toUpperCase().endsWith('-CA')) ? 'CAD' : 'USD';
}

export function readDollarPreference(): DollarPreference {
  try {
    const stored = localStorage.getItem(DOLLAR_KEY);
    if (stored === 'CAD' || stored === 'USD') return stored;
  } catch {
    // No storage — device default.
  }
  return deviceDefault();
}

// Per device, like the other entry preferences (settings.ts).
export function useDollarPreference(): [DollarPreference, (next: DollarPreference) => void] {
  const [preference, setPreferenceState] = useState<DollarPreference>(readDollarPreference);
  function setPreference(next: DollarPreference) {
    try {
      localStorage.setItem(DOLLAR_KEY, next);
    } catch {
      // Applies for this session even if it can't be saved.
    }
    setPreferenceState(next);
  }
  return [preference, setPreference];
}

// 1. the account's usual currency, if it's already a dollar;
// 2. else the dollar currency used most recently anywhere;
// 3. else the "Dollars ($) mean" setting.
export function resolveDollar(accountCurrency: string, recentCurrencies: string[], preference: DollarPreference): string {
  if (DOLLAR_CURRENCIES.includes(accountCurrency)) return accountCurrency;
  return recentCurrencies.find((c) => DOLLAR_CURRENCIES.includes(c)) ?? preference;
}

// docs/09: number formatting keyed to UI language, currency symbol keyed to
// the transaction's own currency — independent axes. UI language is
// hardcoded to en-CA for now; docs/09's language switcher isn't built yet.
const UI_LOCALE = 'en-CA';

export function formatAmount(cents: number, currency: string): string {
  return new Intl.NumberFormat(UI_LOCALE, {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
  }).format(cents / 100);
}

export function formatRelativeDate(iso: string): string {
  const date = new Date(iso + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - date.getTime()) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Intl.DateTimeFormat(UI_LOCALE, { month: 'short', day: 'numeric' }).format(date);
}

export function accountLabel(account: { institution: string | null; name: string }): string {
  return account.institution ? `${account.institution} — ${account.name}` : account.name;
}

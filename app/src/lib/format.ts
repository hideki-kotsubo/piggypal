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

// `occurredAt` is a local date+time now ("YYYY-MM-DDTHH:MM:SS", no
// timezone suffix) — parsed as-is; the old code appended a synthetic
// midnight time here, which only worked because the value used to be
// date-only.
export function formatRelativeDate(occurredAt: string): string {
  const date = new Date(occurredAt);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dateAtMidnight = new Date(date);
  dateAtMidnight.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - dateAtMidnight.getTime()) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Intl.DateTimeFormat(UI_LOCALE, { month: 'short', day: 'numeric' }).format(date);
}

export function formatTime(occurredAt: string): string {
  return new Intl.DateTimeFormat(UI_LOCALE, { hour: 'numeric', minute: '2-digit' }).format(new Date(occurredAt));
}

// Local wall-clock "now" as "YYYY-MM-DDTHH:MM:SS" — deliberately NOT
// `new Date().toISOString()`, which is UTC and can land on the wrong
// calendar day in the evening for any negative-UTC-offset timezone (e.g.
// 7pm in Vancouver is already tomorrow in UTC). Every date/time in this
// app is meant to represent "what the user means", not a UTC instant.
export function nowLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// docs/12 D61 — institution disambiguates same-named accounts at different
// banks ("TD — Checking" vs "Itaú — Checking"); falls back to the bare name
// when institution isn't set.
export function accountLabel(account: { institution: string | null; name: string }): string {
  return account.institution ? `${account.institution} — ${account.name}` : account.name;
}

import { addDays } from './schedules';
import i18n, { uiLocale } from './i18n';
import { accountName, categoryLabel } from './starterLabels';
import type { AccountKind } from './types';

// docs/09: number formatting keyed to UI language, currency symbol keyed to
// the transaction's own currency — independent axes. The locale comes from
// i18n.ts (docs/73 D265): UI language plus the device's region.

export function formatAmount(cents: number, currency: string): string {
  return new Intl.NumberFormat(uiLocale(), {
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
  if (days === 0) return i18n.t('date.today');
  if (days === 1) return i18n.t('date.yesterday');
  if (days < 7) return i18n.t('date.daysAgo', { count: days });
  return new Intl.DateTimeFormat(uiLocale(), { month: 'short', day: 'numeric' }).format(date);
}

export interface DayGroup<T> {
  label: string;
  items: T[];
}

// Groups an already-occurredAt-descending-sorted list into day buckets for
// a day-divider list UI. Buckets by the actual calendar date (not
// formatRelativeDate's display string) so two same-month-day dates a year
// apart never collide into one group — formatRelativeDate is still what
// supplies each bucket's display label, just not its grouping key.
export function groupByDay<T extends { occurredAt: string }>(items: T[]): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  let currentKey = '';
  for (const item of items) {
    const key = item.occurredAt.slice(0, 10); // local YYYY-MM-DD, see nowLocal
    if (key !== currentKey) {
      groups.push({ label: formatRelativeDate(item.occurredAt), items: [] });
      currentKey = key;
    }
    groups[groups.length - 1].items.push(item);
  }
  return groups;
}

export function formatTime(occurredAt: string): string {
  return new Intl.DateTimeFormat(uiLocale(), { hour: 'numeric', minute: '2-digit' }).format(new Date(occurredAt));
}

// docs/46 D169 — for the sign-in merge review's "which is more recent"
// display. Deliberately absolute, not relative ("2 days ago"): the local
// and server copies of an `updatedAt` being compared are often both
// "today" in ordinary testing/early use, where a coarse relative label
// would be useless for actually telling them apart — an exact timestamp
// always is. Epoch (NEVER_UPDATED, store.tsx) reads as "never" rather
// than a real, misleadingly precise 1970 date.
export function formatDateTime(iso: string): string {
  if (iso === '1970-01-01T00:00:00.000Z') return i18n.t('date.never');
  return new Intl.DateTimeFormat(uiLocale(), {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
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

// docs/46 D170 — real UTC bookkeeping timestamp for the new `updatedAt`
// field on Account/Category/Transaction/Budget. Deliberately separate
// from nowLocal() above: that one is the user-facing wall-clock semantic
// occurredAt uses (docs/16 D93 and friends never UTC-convert it);
// updatedAt is pure sync/merge bookkeeping and should be real UTC, same
// as Postgres's own `timestamptz not null default now()` on these tables.
export function nowUtc(): string {
  return new Date().toISOString();
}

// docs/12 D61 — institution disambiguates same-named accounts at different
// banks ("TD — Checking" vs "Itaú — Checking"); falls back to the bare name
// when institution isn't set.
export function accountLabel(account: { institution: string | null; name: string; kind?: AccountKind }): string {
  const name = accountName(account);
  return account.institution ? `${account.institution} — ${name}` : name;
}

// A note-less transaction's category is more useful as the list-row title
// than a generic "No note" — falls back further to "Uncategorized" for
// entries that are neither (e.g. Inbox items, always category-less there).
export function transactionTitle(
  transaction: { note: string | null },
  category: { id: string; name: string } | null | undefined,
): string {
  return transaction.note ?? (category ? categoryLabel(category) : i18n.t('category.uncategorized'));
}

// docs/57 — "Today", "Tomorrow", "Oct 15" for a scheduled-payment date. A
// schedule date has no time part ("YYYY-MM-DD"), so it never goes through
// the occurredAt-oriented helpers above.
export function formatOccurrenceDate(date: string, today: string): string {
  if (date === today) return i18n.t('occurrence.today');
  if (date === addDays(today, 1)) return i18n.t('occurrence.tomorrow');
  if (date === addDays(today, -1)) return i18n.t('occurrence.yesterday');
  const [y, m, d] = date.split('-').map(Number);
  const sameYear = date.slice(0, 4) === today.slice(0, 4);
  return new Intl.DateTimeFormat(uiLocale(), { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) }).format(
    new Date(y, m - 1, d),
  );
}

// "just now" / "N minutes/hours ago" — finer-grained than
// formatRelativeDate (which only resolves to whole calendar days), for
// Settings' paired peers and the Household screen's devices (docs/71): a
// peer synced 20 minutes ago and one synced yesterday should read
// differently, not both collapse to "today".
export function formatTimeAgo(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return i18n.t('date.justNow');
  if (minutes < 60) return i18n.t('date.minutesAgo', { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return i18n.t('date.hoursAgo', { count: hours });
  const days = Math.round(hours / 24);
  return i18n.t('date.daysAgo', { count: days });
}

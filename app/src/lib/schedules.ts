import type { ScheduledPayment, Transaction } from './types';

// docs/57 — everything about a scheduled payment that isn't storage: when
// its occurrences fall, what each one costs, which are still open, and the
// deterministic id a posted one gets. Pure (apart from uuidv5's async
// SHA-1) so it's unit-testable without a database — store.tsx and the
// screens only ever call into here.
//
// All dates are plain local "YYYY-MM-DD" strings, same "what the user
// means" semantic as Transaction.occurredAt (format.ts's nowLocal()).
// Arithmetic goes through Date.UTC purely as a calendar calculator — no
// timezone or DST can shift a date that never had a time attached.

export interface Occurrence {
  scheduleId: string;
  date: string; // "YYYY-MM-DD"
  number: number; // 1-based position in the plan (startIndex-aware)
  amountCents: number; // signed, same convention as Transaction
}

// ---- calendar helpers ----

function parts(date: string): [number, number, number] {
  return [Number(date.slice(0, 4)), Number(date.slice(5, 7)), Number(date.slice(8, 10))];
}

function fmt(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = parts(date);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return fmt(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

// D209 — the anchor's own day-of-month is what's remembered, clamped to
// each month's length: Jan 31 → Feb 28/29 → Mar 31, never drifting to the
// 28th forever after one short month.
function addMonthsClamped(anchor: string, months: number): string {
  const [y, m, d] = parts(anchor);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return fmt(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

export function todayLocal(): string {
  const d = new Date();
  return fmt(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

// ---- projection ----

function occurrenceDateAt(rule: Pick<ScheduledPayment, 'freq' | 'intervalCount' | 'anchorDate'>, k: number): string {
  const step = Math.max(1, rule.intervalCount) * k;
  switch (rule.freq) {
    case 'weekly':
      return addDays(rule.anchorDate, 7 * step);
    case 'yearly':
      return addMonthsClamped(rule.anchorDate, 12 * step);
    default:
      return addMonthsClamped(rule.anchorDate, step);
  }
}

// How many occurrences the rule has from anchorDate on — null when
// open-ended. An installment plan already partly paid before Flowtab
// (startIndex > 1) only has its remaining installments here.
export function remainingCount(rule: Pick<ScheduledPayment, 'occurrenceCount' | 'startIndex'>): number | null {
  if (rule.occurrenceCount === null) return null;
  return Math.max(0, rule.occurrenceCount - rule.startIndex + 1);
}

// D211 — integer cents, remainder on the FIRST installment (card-issuer
// convention): 100000 / 3 → 33334, 33333, 33333. Sign preserved.
export function installmentAmount(totalCents: number, count: number, number: number): number {
  if (count <= 0) return totalCents;
  const sign = totalCents < 0 ? -1 : 1;
  const abs = Math.abs(totalCents);
  const base = Math.floor(abs / count);
  const remainder = abs - base * count;
  return sign * (base + (number === 1 ? remainder : 0));
}

export function occurrenceAmount(rule: ScheduledPayment, number: number): number {
  if (rule.kind === 'installment' && rule.occurrenceCount) {
    return installmentAmount(rule.amountCents, rule.occurrenceCount, number);
  }
  return rule.amountCents;
}

// Hard stop for a pathological rule (a weekly rule anchored decades ago,
// a corrupted interval) — far beyond any real plan's length.
const MAX_STEPS = 5000;

// Every occurrence of `rule` dated within [from, to] (inclusive), whether
// or not it's been posted — see openOccurrences for "still open".
export function projectOccurrences(rule: ScheduledPayment, from: string, to: string): Occurrence[] {
  const out: Occurrence[] = [];
  if (to < rule.anchorDate) return out;
  const remaining = remainingCount(rule);
  for (let k = 0; k < MAX_STEPS; k++) {
    if (remaining !== null && k >= remaining) break;
    const date = occurrenceDateAt(rule, k);
    if (date > to) break;
    if (rule.endDate && date > rule.endDate) break;
    if (date < from) continue;
    const number = rule.startIndex + k;
    out.push({ scheduleId: rule.id, date, number, amountCents: occurrenceAmount(rule, number) });
  }
  return out;
}

export function occurrenceKey(scheduleId: string, date: string): string {
  return `${scheduleId}:${date}`;
}

// D209 — every (schedule, date) that already has a transactions row,
// live OR soft-deleted: a skip is a posted-then-deleted row (D210), and
// it must keep suppressing its occurrence just like a paid one does.
export function postedKeys(transactions: Pick<Transaction, 'scheduleId' | 'occurrenceDate'>[]): Set<string> {
  const keys = new Set<string>();
  for (const t of transactions) {
    if (t.scheduleId && t.occurrenceDate) keys.add(occurrenceKey(t.scheduleId, t.occurrenceDate));
  }
  return keys;
}

function isLive(rule: ScheduledPayment): boolean {
  return !rule.paused && !rule.archived;
}

export function openOccurrences(rule: ScheduledPayment, posted: ReadonlySet<string>, from: string, to: string): Occurrence[] {
  if (!isLive(rule)) return [];
  return projectOccurrences(rule, from, to).filter((o) => !posted.has(occurrenceKey(o.scheduleId, o.date)));
}

const byDate = (a: Occurrence, b: Occurrence) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

// D212 — due = open and dated today or earlier. No lower bound: an unposted
// occurrence stays due until it's posted or skipped (docs/57 open
// question 3, resolved as "forever").
export function dueOccurrences(rules: ScheduledPayment[], posted: ReadonlySet<string>, today: string): Occurrence[] {
  return rules.flatMap((r) => openOccurrences(r, posted, r.anchorDate, today)).sort(byDate);
}

// Open occurrences strictly after today, up to `days` ahead.
export function upcomingOccurrences(
  rules: ScheduledPayment[],
  posted: ReadonlySet<string>,
  today: string,
  days: number,
): Occurrence[] {
  const from = addDays(today, 1);
  const to = addDays(today, days);
  return rules.flatMap((r) => openOccurrences(r, posted, from, to)).sort(byDate);
}

// The next open occurrence on or after `from`, for a rule's list row.
// Looks a bounded distance ahead (weekly → ~2 years of steps), so a rule
// whose next date is genuinely past that just shows none.
export function nextOpenOccurrence(rule: ScheduledPayment, posted: ReadonlySet<string>, from: string): Occurrence | null {
  return openOccurrences(rule, posted, from, addDays(from, 3 * 366))[0] ?? null;
}

// D213 — the "committed" segment of a month's budget bars: open expense
// occurrences dated in that month (past-but-unposted ones included),
// keyed `${categoryId}:${currency}` exactly like BudgetBars' spend map,
// as positive cents. Never blended across currencies (docs/10).
export function committedForMonth(
  rules: ScheduledPayment[],
  posted: ReadonlySet<string>,
  monthStart: string, // "YYYY-MM-01"
): Map<string, number> {
  const [y, m] = parts(monthStart);
  const monthEnd = fmt(y, m, daysInMonth(y, m));
  const out = new Map<string, number>();
  for (const r of rules) {
    if (!r.categoryId) continue;
    for (const o of openOccurrences(r, posted, monthStart, monthEnd)) {
      if (o.amountCents >= 0) continue;
      const key = `${r.categoryId}:${r.currency}`;
      out.set(key, (out.get(key) ?? 0) - o.amountCents);
    }
  }
  return out;
}

// D210 "change this and future" — the occurrence number the split-off
// rule starts at, so an installment plan keeps counting (4/10, 5/10…)
// instead of restarting at 1/10.
export function splitStartIndex(rule: ScheduledPayment, newAnchor: string): number {
  return rule.startIndex + projectOccurrences(rule, rule.anchorDate, addDays(newAnchor, -1)).length;
}

// The posted transaction's note — what every list row shows as its title
// (format.ts's transactionTitle). Stored, not derived, so the "3/10" reads
// the same in search, CSV export and on a device without the rule.
export function occurrenceNote(rule: ScheduledPayment, occ: Pick<Occurrence, 'number'>): string {
  const base = rule.note?.trim() || rule.name;
  if (rule.kind === 'installment' && rule.occurrenceCount) return `${base} (${occ.number}/${rule.occurrenceCount})`;
  return base;
}

// D212 — occurred_at for a posted occurrence. A fixed noon rather than
// "now": auto-posting devices then agree on the value, and a back-dated
// catch-up post never lands near a midnight boundary.
export function occurrenceOccurredAt(date: string): string {
  return `${date}T12:00:00`;
}

const ORDINAL_EN = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "Monthly on the 1st", "Every 2 weeks on Friday", "Yearly on Mar 15".
export function describeCadence(rule: Pick<ScheduledPayment, 'freq' | 'intervalCount' | 'anchorDate'>): string {
  const [y, m, d] = parts(rule.anchorDate);
  const n = Math.max(1, rule.intervalCount);
  switch (rule.freq) {
    case 'weekly': {
      const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
      return `${n === 1 ? 'Weekly' : `Every ${n} weeks`} on ${weekday}`;
    }
    case 'yearly':
      return `${n === 1 ? 'Yearly' : `Every ${n} years`} on ${MONTHS[m - 1]} ${d}`;
    default:
      return `${n === 1 ? 'Monthly' : `Every ${n} months`} on the ${d >= 29 ? `${ORDINAL_EN(d)} (or last day)` : ORDINAL_EN(d)}`;
  }
}

// ---- D208: deterministic ids ----

// Fixed, random, Flowtab-specific uuidv5 namespace. Changing it would give
// every future post of an already-posted occurrence a different id — never
// change it.
export const FLOWTAB_SCHEDULE_NS = '4f9b2c1e-8d3a-4e6f-9a7b-2c5d8e1f0a3b';

function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '');
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

// RFC 9562 UUIDv5 (SHA-1). crypto.randomUUID() has no v5, and this is
// small enough not to warrant a dependency.
export async function uuidv5(name: string, namespace: string): Promise<string> {
  const ns = uuidToBytes(namespace);
  const nameBytes = new TextEncoder().encode(name);
  const input = new Uint8Array(ns.length + nameBytes.length);
  input.set(ns);
  input.set(nameBytes, ns.length);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-1', input));
  const b = hash.slice(0, 16);
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function occurrenceTransactionId(scheduleId: string, date: string): Promise<string> {
  return uuidv5(occurrenceKey(scheduleId, date), FLOWTAB_SCHEDULE_NS);
}

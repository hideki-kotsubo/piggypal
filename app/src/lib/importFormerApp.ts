// docs/81 — adapter for the user's own former app's JSON export: one array
// of records ({ id, when, what, where, currency, amount, category,
// subCategory, amounts, payments[], type }). Pure: turns the file into
// ImportLine[] (importPlan.ts's input) and never touches the store.
// Anything that doesn't fit the documented shape becomes an issue on the
// line, never a guess (docs/81's per-type checks table).

export type ImportKind = 'expense' | 'income' | 'transfer';

export type ImportIssue =
  | 'badRecord' // not an object, or a required field missing/unreadable
  | 'badDate'
  | 'badAmount'
  | 'unknownType'
  | 'signMismatch' // amount's sign doesn't fit the type
  | 'legsDontSum' // payments don't add up to amount (expense/income), or to 0 (transfer)
  | 'transferShape' // a transfer that isn't exactly one negative + one positive payment
  | 'amountsNotEmpty'; // the never-seen-filled `amounts` field has data

export interface ImportLeg {
  accountName: string;
  amountCents: number; // signed
}

export interface ImportLine {
  index: number; // position in the file, for stable keys and error messages
  sourceId: string | null; // lowercased; becomes the transaction id (docs/81 I-D7)
  kind: ImportKind;
  occurredAt: string; // local "YYYY-MM-DDTHH:MM:SS", the app's convention
  amountCents: number; // signed total
  currency: string;
  note: string | null;
  merchant: string | null;
  categoryName: string | null; // "Parent › Child" when subCategory is set
  legs: ImportLeg[];
  issues: ImportIssue[];
}

export const CATEGORY_PATH_SEPARATOR = ' › ';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// "-44.61", "100.00", "1234", "-20" → cents, exactly (no float maths).
// Amounts are stored ×100 whatever the currency (cents.ts), so yen too.
export function decimalToCents(value: string): number | null {
  const m = /^\s*([+-]?)(\d+)(?:[.,](\d{1,2}))?\s*$/.exec(value);
  if (!m) return null;
  const cents = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0'));
  return m[1] === '-' ? -cents : cents;
}

// The record-level `amount` is a JSON number (-44.61); round, don't trust
// the float.
function numberToCents(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value * 100);
  if (typeof value === 'string') return decimalToCents(value);
  return null;
}

// `when` is UTC ("2026-11-08T00:21:29Z"); occurredAt is the local wall
// clock with no zone (format.ts nowLocal). Taking the date straight from
// the string would put a Vancouver evening on the next day.
export function utcToLocal(iso: string, timeZone?: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;
}

const TYPES: Record<number, ImportKind> = { 1: 'expense', 2: 'income', 3: 'transfer' };

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  return s === '' ? null : s;
}

export function parseFormerAppRecord(record: unknown, index: number, timeZone?: string): ImportLine {
  const issues: ImportIssue[] = [];
  const r = (record && typeof record === 'object' ? record : {}) as Record<string, unknown>;
  if (record === null || typeof record !== 'object' || Array.isArray(record)) issues.push('badRecord');

  const rawId = text(r.id);
  const sourceId = rawId && UUID_RE.test(rawId) ? rawId.toLowerCase() : null;

  const kind = TYPES[r.type as number];
  if (!kind) issues.push('unknownType');

  const occurredAt = typeof r.when === 'string' ? utcToLocal(r.when, timeZone) : null;
  if (!occurredAt) issues.push('badDate');

  const amountCents = numberToCents(r.amount);
  if (amountCents === null) issues.push('badAmount');

  const currency = text(r.currency)?.toUpperCase() ?? null;
  if (!currency || !/^[A-Z]{3}$/.test(currency)) issues.push('badRecord');

  const legs: ImportLeg[] = [];
  const payments = Array.isArray(r.payments) ? r.payments : [];
  if (payments.length === 0) issues.push('badRecord');
  for (const p of payments) {
    const pr = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>;
    const accountName = text(pr.wallet);
    const cents = typeof pr.amount === 'string' ? decimalToCents(pr.amount) : numberToCents(pr.amount);
    if (!accountName || cents === null) {
      issues.push('badAmount');
      continue;
    }
    legs.push({ accountName, amountCents: cents });
  }

  if (Array.isArray(r.amounts) && r.amounts.length > 0) issues.push('amountsNotEmpty');

  if (kind && amountCents !== null && legs.length > 0) {
    const sum = legs.reduce((s, l) => s + l.amountCents, 0);
    if (kind === 'transfer') {
      const out = legs.filter((l) => l.amountCents < 0);
      const into = legs.filter((l) => l.amountCents > 0);
      if (legs.length !== 2 || out.length !== 1 || into.length !== 1) issues.push('transferShape');
      else if (sum !== 0 || into[0].amountCents !== Math.abs(amountCents)) issues.push('legsDontSum');
      if (amountCents < 0) issues.push('signMismatch');
    } else {
      const wantNegative = kind === 'expense';
      if (amountCents === 0 || amountCents < 0 !== wantNegative) issues.push('signMismatch');
      else if (legs.some((l) => l.amountCents < 0 !== wantNegative)) issues.push('signMismatch');
      if (sum !== amountCents) issues.push('legsDontSum');
    }
  }

  const category = text(r.category);
  const sub = text(r.subCategory);
  const categoryName = category ? (sub ? `${category}${CATEGORY_PATH_SEPARATOR}${sub}` : category) : null;

  return {
    index,
    sourceId,
    kind: kind ?? 'expense',
    occurredAt: occurredAt ?? '',
    amountCents: amountCents ?? 0,
    currency: currency ?? '',
    note: text(r.what),
    merchant: text(r.where),
    categoryName,
    legs,
    issues: [...new Set(issues)],
  };
}

export class ImportFileError extends Error {}

// Throws ImportFileError when the file as a whole isn't this format, so
// the screen can say "not the right file" instead of listing N broken rows.
export function parseFormerAppJson(fileText: string, timeZone?: string): ImportLine[] {
  let data: unknown;
  try {
    data = JSON.parse(fileText.replace(/^﻿/, ''));
  } catch {
    throw new ImportFileError('notJson');
  }
  if (!Array.isArray(data)) throw new ImportFileError('notArray');
  const looksRight = data.length === 0 || data.some((r) => r && typeof r === 'object' && 'payments' in r && 'when' in r);
  if (!looksRight) throw new ImportFileError('wrongShape');
  return data.map((r, i) => parseFormerAppRecord(r, i, timeZone));
}

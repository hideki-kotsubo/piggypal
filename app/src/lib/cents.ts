// Money read back from SQLite (docs/00-backlog, reported 2026-08-12): the
// web driver once returned INTEGER columns as `bigint`, and mixing a bigint
// with a plain number throws ("Cannot mix BigInt and other types"). It
// returns `number` today (checked 2026-10-09 on @powersync/web 2.3.0), but
// the native drivers can't be checked here and a future SDK could change
// again, so store.tsx's row mappers convert once, here, rather than every
// sum and comparison downstream having to care.
export function centsFromRow(value: number | bigint): number {
  return typeof value === 'bigint' ? Number(value) : value;
}

// Every amount is stored ×100 ("cents"), whatever the currency: ￥1,500 is
// 150000, the same convention the parser and the server use. But a
// currency without minor units (JPY, KRW…) can't have a fraction, so its
// smallest step is 100 "cents", not 1. Before this, the keypad treated
// every currency as having cents: typing 1 5 0 0 in yen gave ￥15 (real
// report, 2026-10-22).
const unitCache = new Map<string, number>();

export function centsPerUnit(currency: string): number {
  let unit = unitCache.get(currency);
  if (unit === undefined) {
    let digits = 2;
    try {
      digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
    } catch {
      // Unknown code — treat as having cents.
    }
    // Three-decimal currencies (KWD, BHD…) can't be finer than a cent
    // here, so they step by cents too.
    unit = digits >= 2 ? 1 : 10 ** (2 - digits);
    unitCache.set(currency, unit);
  }
  return unit;
}

// Keypad: the absolute amount after typing `digit`, or after backspace.
// The caller applies the sign, as before.
export function appendDigit(cents: number, digit: string, currency: string): number {
  const unit = centsPerUnit(currency);
  const units = Math.floor(Math.abs(cents) / unit);
  return Number(String(units) + digit) * unit;
}

export function dropDigit(cents: number, currency: string): number {
  const unit = centsPerUnit(currency);
  const digits = String(Math.floor(Math.abs(cents) / unit)).slice(0, -1);
  return (digits === '' ? 0 : Number(digits)) * unit;
}

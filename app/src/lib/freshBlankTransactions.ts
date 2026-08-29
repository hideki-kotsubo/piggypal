// Tracks transaction ids created via EntryZone's quick-add (docs/19) that
// are still blank and safe to drop if the user backs out without entering
// anything (docs/23's cleanup in TransactionScreen.finish()). Deliberately
// a plain in-memory Set, never persisted (localStorage/SQLite) — the whole
// point is that it does NOT survive a reload, same "must not survive
// reload" property auth.ts's in-memory access token relies on. Without
// this, the cleanup's only signal was `transaction.amountCents === 0` read
// fresh off the store, which can't tell "user never touched this" apart
// from "user filled this in, but it hasn't finished syncing and briefly
// reads back as 0 after a reconnect" — a real case that cost a user's
// entered amount/category/note after their phone reconnected post-offline
// entry and the sync connection needed a reload to recover.
const freshBlankIds = new Set<string>();

export function markFreshBlank(id: string): void {
  freshBlankIds.add(id);
}

export function isFreshBlank(id: string): boolean {
  return freshBlankIds.has(id);
}

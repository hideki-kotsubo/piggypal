// One-time read-through migration for the piggypal: -> flowtab: localStorage
// prefix rename (docs/53). Never deletes the old key — the leftover is
// harmless, and not deleting avoids any edge case with a second already-open
// tab still reading/writing the old key concurrently before it reloads.
// Idempotent: a no-op once the new key exists, whether from a real migration
// or a genuinely fresh device that never had the old key at all.
export function migrateStorageKey(oldKey: string, newKey: string): void {
  if (localStorage.getItem(newKey) !== null) return;
  const oldValue = localStorage.getItem(oldKey);
  if (oldValue !== null) localStorage.setItem(newKey, oldValue);
}

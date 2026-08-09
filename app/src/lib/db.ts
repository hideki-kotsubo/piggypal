import { PowerSyncDatabase } from '@powersync/web';
import { AppSchema } from './schema';

// No connector passed — this is local-only mode. docs/01 D1's "local-first"
// half is what this satisfies; the "sync" half (connecting to a PowerSync
// Service + our API) is a distinct, later phase, not attempted here.
export const db = new PowerSyncDatabase({
  schema: AppSchema,
  database: {
    // Bumped from piggypal.db while chasing a seeding bug — a missing `id`
    // column on budget inserts, fixed in store.tsx/seed.ts/types.ts. Seeding
    // never actually succeeded on the old file (rolled back atomically every
    // time), so this was just a clean-slate reset, not a data-recovery fix.
    // No need to bump again now that the real cause is fixed.
    dbFilename: 'piggypal-v2.db',
  },
});

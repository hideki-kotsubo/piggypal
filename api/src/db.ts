import { Pool } from 'pg';

// docs/39's DATABASE_URL — the same real Postgres db/schema.sql was
// verified against, not a second connection. Only auth.ts's tables
// (users/magic_links/refresh_tokens) touch this from api/ so far — the
// sync/parse write paths (docs/03, docs/04) will reuse this same pool
// once they're built.
//
// Lazily constructed, not built at module-load time: ES module imports
// fully evaluate before the importing file's own top-level code runs, so
// a top-level `new Pool(...)` here would read process.env.DATABASE_URL
// before index.ts's process.loadEnvFile() ever executes — always
// undefined, real bug hit and fixed 2026-08-22 ("client password must be
// a string" from pg, not an obvious "env var missing" error).
let instance: Pool | undefined;

export function pool(): Pool {
  instance ??= new Pool({ connectionString: process.env.DATABASE_URL });
  return instance;
}

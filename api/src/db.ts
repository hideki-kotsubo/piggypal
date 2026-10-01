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

// DATABASE_URL wins when set (production's docker-compose.yaml builds it
// from POSTGRES_*). Otherwise the split DATABASE_* vars from api/.env —
// passed to pg as separate fields, so the password needs no URL-encoding.
function config(): ConstructorParameters<typeof Pool>[0] {
  const env = process.env;
  if (env.DATABASE_URL) return { connectionString: env.DATABASE_URL };
  return {
    host: env.DATABASE_HOST,
    port: env.DATABASE_PORT ? Number(env.DATABASE_PORT) : undefined,
    user: env.DATABASE_USER,
    password: env.DATABASE_PASSWORD,
    database: env.DATABASE_NAME,
  };
}

export function pool(): Pool {
  instance ??= new Pool(config());
  return instance;
}

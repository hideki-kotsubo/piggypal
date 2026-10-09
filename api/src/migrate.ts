import { readdirSync, readFileSync } from 'node:fs';
import type { PoolClient } from 'pg';
import { pool } from './db.js';

// docs/58 D220 — db/migrations/*.sql applied in filename order (they're
// date-prefixed), each recorded in schema_migrations so it runs exactly
// once per database. Same relative path from api/src (tsx) and api/dist
// (built, and in the Docker image, which copies db/migrations alongside).
const MIGRATIONS_DIR = new URL('../../db/migrations/', import.meta.url);

// Arbitrary but fixed: serializes two api processes starting at once
// against the same database (pg_advisory_lock is per-database).
const LOCK_KEY = 58_220;

export const CREATE_TABLE_SQL = `create table if not exists schema_migrations (
  filename   text primary key,
  applied_at timestamptz not null default now()
)`;

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
}

export async function isTracked(client: PoolClient): Promise<boolean> {
  const { rows } = await client.query<{ tracked: boolean }>(
    "select to_regclass('schema_migrations') is not null as tracked",
  );
  return rows[0].tracked;
}

export async function appliedMigrations(client: PoolClient): Promise<Set<string>> {
  const { rows } = await client.query<{ filename: string }>('select filename from schema_migrations');
  return new Set(rows.map((r) => r.filename));
}

// A migration file itself failed, as opposed to the database being
// unreachable — index.ts treats the two differently.
export class MigrationError extends Error {}

// Latest applied migration, reported by /health as the database's
// "version". null until runMigrations has run against a tracked database.
let schemaVersion: string | null = null;
export function getSchemaVersion(): string | null {
  return schemaVersion;
}

// Applies every pending migration. A database without schema_migrations
// (one that predates D220) is left alone with a warning rather than
// guessed at — several migrations aren't safe to re-run, so it needs a
// one-time `migrate baseline` by hand first (docs/58).
export async function runMigrations(): Promise<string[]> {
  const client = await pool().connect();
  try {
    await client.query('select pg_advisory_lock($1)', [LOCK_KEY]);
    if (!(await isTracked(client))) {
      console.warn(
        'migrate: schema_migrations does not exist, skipping migrations. ' +
          'Run `migrate baseline` once for this database (docs/58).',
      );
      return [];
    }

    const applied = await appliedMigrations(client);
    const pending = migrationFiles().filter((f) => !applied.has(f));
    for (const file of pending) {
      console.log(`migrate: applying ${file}`);
      try {
        // Files carry their own begin/commit, so they run as-is.
        await client.query(readFileSync(new URL(file, MIGRATIONS_DIR), 'utf8'));
      } catch (err) {
        await client.query('rollback').catch(() => {});
        throw new MigrationError(`migration ${file} failed: ${(err as Error).message}`);
      }
      await client.query('insert into schema_migrations (filename) values ($1)', [file]);
      applied.add(file);
    }

    schemaVersion = [...applied].sort().at(-1) ?? null;
    return pending;
  } finally {
    await client.query('select pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    client.release();
  }
}

import { existsSync } from 'node:fs';
import { pool } from './db.js';
import {
  CREATE_TABLE_SQL,
  appliedMigrations,
  isTracked,
  migrationFiles,
  runMigrations,
} from './migrate.js';

// docs/58 D220. Usage:
//   dev:    npm run migrate -w api -- <status|up|baseline [through-file]>
//   docker: docker compose exec api node api/dist/migrate-cli.js <...>
//
// `baseline` marks migrations as already applied without running them —
// for a database that existed before schema_migrations did. Only run it
// after checking the live schema really has them; with a through-file it
// stops there, so later ones still get applied by `up`.

if (existsSync('.env')) {
  process.loadEnvFile();
}

const [command = 'status', through] = process.argv.slice(2);

async function status(): Promise<void> {
  const client = await pool().connect();
  try {
    if (!(await isTracked(client))) {
      console.log('schema_migrations does not exist yet: run `baseline` first.');
      return;
    }
    const applied = await appliedMigrations(client);
    for (const file of migrationFiles()) {
      console.log(`${applied.has(file) ? 'applied ' : 'PENDING '} ${file}`);
    }
  } finally {
    client.release();
  }
}

async function baseline(): Promise<void> {
  const files = migrationFiles();
  if (through && !files.includes(through)) {
    throw new Error(`${through} is not in db/migrations`);
  }
  const marked = through ? files.filter((f) => f <= through) : files;
  const client = await pool().connect();
  try {
    await client.query(CREATE_TABLE_SQL);
    for (const file of marked) {
      await client.query(
        'insert into schema_migrations (filename) values ($1) on conflict do nothing',
        [file],
      );
    }
    console.log(`marked ${marked.length} migration(s) as applied, through ${marked.at(-1)}`);
  } finally {
    client.release();
  }
}

try {
  if (command === 'status') await status();
  else if (command === 'baseline') await baseline();
  else if (command === 'up') {
    const applied = await runMigrations();
    console.log(applied.length ? `applied ${applied.length} migration(s)` : 'nothing to apply');
  } else {
    throw new Error(`unknown command "${command}" (expected status, up or baseline)`);
  }
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await pool().end();
}

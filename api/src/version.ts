import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Read at startup rather than imported as JSON — keeps working from both
// `tsx watch src/index.ts` (cwd = api/) and the built `dist/index.js`
// (package.json still sits one level up from dist/), no bundler JSON
// config needed either way.
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8')) as { version: string };

export const API_VERSION = pkg.version;

// docs/58 D218 — the commit this api was built from. The Docker image has
// no .git (.dockerignore), so it gets GIT_COMMIT as a build arg from
// deploy/up.sh; a dev process (tsx watch) asks git directly. Same "-dirty"
// / "unknown" conventions as app/vite.config.ts.
function gitCommit(): string {
  if (process.env.GIT_COMMIT) return process.env.GIT_COMMIT;
  try {
    const sha = execSync('git rev-parse --short HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const dirty = execSync('git status --porcelain', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() !== '';
    return dirty ? `${sha}-dirty` : sha;
  } catch {
    return 'unknown';
  }
}

export const API_COMMIT = gitCommit();

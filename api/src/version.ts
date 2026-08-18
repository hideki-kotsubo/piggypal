import { readFileSync } from 'node:fs';

// Read at startup rather than imported as JSON — keeps working from both
// `tsx watch src/index.ts` (cwd = api/) and the built `dist/index.js`
// (package.json still sits one level up from dist/), no bundler JSON
// config needed either way.
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8')) as { version: string };

export const API_VERSION = pkg.version;

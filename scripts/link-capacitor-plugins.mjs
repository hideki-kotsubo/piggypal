#!/usr/bin/env node
// Runs on `npm install` / `npm ci` (root postinstall). docs/64.
//
// The Capacitor CLI finds native plugins with
// require.resolve('<plugin>/package.json') from app/, and falls back to
// looking in app/node_modules/<plugin>. A plugin whose package.json
// "exports" doesn't list ./package.json (@powersync/capacitor) fails the
// first, and npm workspaces hoist it to the root node_modules, so it fails
// the second too, and `cap sync` silently leaves its native code out of
// the iOS and Android projects. Linking it into app/node_modules makes the
// fallback find it.
import { existsSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appDir = path.join(root, 'app');
const appRequire = createRequire(path.join(appDir, 'package.json'));
const { dependencies = {} } = JSON.parse(readFileSync(path.join(appDir, 'package.json'), 'utf8'));

for (const name of Object.keys(dependencies)) {
  try {
    appRequire.resolve(`${name}/package.json`);
    continue; // the CLI's first lookup works
  } catch {
    // not resolvable that way; see if it's a hoisted Capacitor plugin
  }
  const hoisted = path.join(root, 'node_modules', name);
  const local = path.join(appDir, 'node_modules', name);
  if (!existsSync(path.join(hoisted, 'package.json')) || existsSync(local)) continue;
  const meta = JSON.parse(readFileSync(path.join(hoisted, 'package.json'), 'utf8'));
  if (!meta.capacitor) continue;

  mkdirSync(path.dirname(local), { recursive: true });
  symlinkSync(path.relative(path.dirname(local), hoisted), local, 'junction');
  console.log(`linked Capacitor plugin ${name} into app/node_modules`);
}

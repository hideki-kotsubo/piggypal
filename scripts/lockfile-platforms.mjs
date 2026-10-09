#!/usr/bin/env node
// Keeps package-lock.json installable on every platform (docs/63).
//
// npm sometimes records a nested package's optional native binaries only
// for the platform the lockfile was updated on (rolldown, lightningcss,
// oxlint, typescript 7 each ship one binary package per OS/CPU). A lockfile
// written on Linux then installs on a Mac without the Mac binary, and the
// build crashes. This finds every optionalDependency with no lockfile
// entry and adds it, at the exact version the parent asks for, from the
// npm registry. Existing entries are never changed or moved.
//
//   node scripts/lockfile-platforms.mjs --check   exit 1 if anything is missing (CI)
//   node scripts/lockfile-platforms.mjs --fix     add the missing entries
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LOCK = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package-lock.json');
const mode = process.argv[2];
if (mode !== '--check' && mode !== '--fix') {
  console.error('Usage: node scripts/lockfile-platforms.mjs --check | --fix');
  process.exit(2);
}

const lock = JSON.parse(readFileSync(LOCK, 'utf8'));
const pkgs = lock.packages;

// Node's resolution: look in the owner's own node_modules, then each
// ancestor's, up to the root.
function resolves(owner, dep) {
  let base = owner;
  for (;;) {
    if (pkgs[`${base ? `${base}/` : ''}node_modules/${dep}`]) return true;
    if (!base) return false;
    const i = base.lastIndexOf('/node_modules/');
    base = i === -1 ? '' : base.slice(0, i);
  }
}

const missing = [];
for (const [owner, meta] of Object.entries(pkgs)) {
  for (const [dep, version] of Object.entries(meta.optionalDependencies ?? {})) {
    if (!resolves(owner, dep)) {
      // Siblings of the owner, where npm puts the binaries it did record.
      const target = `${owner.slice(0, owner.lastIndexOf('node_modules/'))}node_modules/${dep}`;
      missing.push({ owner, dep, version, target, dev: !!meta.dev });
    }
  }
}

if (mode === '--check') {
  if (missing.length) {
    console.error(`package-lock.json is missing ${missing.length} platform binaries, e.g.:`);
    for (const m of missing.slice(0, 5)) console.error(`  ${m.target}@${m.version} (for ${m.owner})`);
    console.error('Run: node scripts/lockfile-platforms.mjs --fix');
    process.exit(1);
  }
  console.log('package-lock.json has every platform binary.');
  process.exit(0);
}

const added = new Map();
for (const m of missing) {
  if (added.has(m.target)) continue;
  const res = await fetch(`https://registry.npmjs.org/${m.dep.replace('/', '%2F')}/${m.version}`);
  if (!res.ok) throw new Error(`${m.dep}@${m.version}: registry returned ${res.status}`);
  const meta = await res.json();
  const entry = { version: meta.version, resolved: meta.dist.tarball, integrity: meta.dist.integrity };
  for (const k of ['cpu', 'os', 'libc']) if (meta[k]) entry[k] = meta[k];
  if (m.dev) entry.dev = true;
  if (meta.license) entry.license = meta.license;
  entry.optional = true;
  if (meta.engines) entry.engines = meta.engines;
  added.set(m.target, entry);
}

// Insert each new entry after the last existing entry of its family
// (e.g. next to @rolldown/binding-linux-x64-gnu), keeping every existing
// line where it was.
const order = Object.keys(pkgs);
for (const target of [...added.keys()].sort().reverse()) {
  const name = target.slice(target.lastIndexOf('/') + 1);
  const stem = target.slice(0, target.lastIndexOf('/') + 1) + name.split('-')[0];
  let at = order.length;
  for (let i = order.length - 1; i >= 0; i--) if (order[i].startsWith(stem)) { at = i + 1; break; }
  order.splice(at, 0, target);
}
lock.packages = Object.fromEntries(order.map((k) => [k, pkgs[k] ?? added.get(k)]));
writeFileSync(LOCK, `${JSON.stringify(lock, null, 2)}\n`);
console.log(`added ${added.size} platform binaries to package-lock.json`);

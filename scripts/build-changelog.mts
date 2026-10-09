// docs/59 — app/CHANGELOG.md → website/changelog.html, plus the release-time
// steps scripts/deploy-app.sh needs. Run via `npm run changelog -- <mode>`:
//
//   (no args)            regenerate website/changelog.html
//   --check              exit 1 if website/changelog.html is out of date (CI)
//   --has-unreleased     exit 3 unless "## Unreleased" has notes
//   --release <version>  stamp "## Unreleased" as <version> — <today>, regenerate
//   --plain <version>    print that entry as plain text (store release notes)
//
// The generated page is committed, so neither server needs a build step to
// serve it.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type ChangelogEntry,
  entryPlainText,
  formatEntryDate,
  hasUnreleasedNotes,
  inlineParts,
  parseChangelog,
  releasedEntries,
  stampRelease,
} from '../app/src/lib/changelog.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(root, 'app/CHANGELOG.md');
const PAGE = path.join(root, 'website/changelog.html');

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const inline = (text: string) =>
  inlineParts(text)
    .map((p) => (p.bold ? `<strong>${escape(p.text)}</strong>` : escape(p.text)))
    .join('');

function renderEntry(entry: ChangelogEntry): string {
  const intro = entry.intro.map((p) => `      <p>${inline(p)}</p>\n`).join('');
  const items = entry.items.length
    ? `      <ul>\n${entry.items.map((i) => `        <li>${inline(i)}</li>\n`).join('')}      </ul>\n`
    : '';
  return `    <article class="entry" id="v${escape(entry.version)}">
      <header>
        <h2>${escape(entry.version)}</h2>
        <time datetime="${entry.date}">${formatEntryDate(entry.date!)}</time>
      </header>
${intro}${items}    </article>
`;
}

function renderPage(entries: ChangelogEntry[]): string {
  const released = releasedEntries(entries);
  const body = released.length
    ? released.map(renderEntry).join('\n')
    : '    <p class="empty">No releases yet.</p>\n';
  return `<!doctype html>
<!-- Generated from app/CHANGELOG.md by scripts/build-changelog.mts. Don't edit by hand. -->
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>What's new — Flowtab</title>
<meta name="description" content="Every Flowtab release, and what changed in it.">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#f5f8f6">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0e1513">
<link rel="icon" type="image/png" href="favicon.png">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="site.css">
<style>
  main { max-width: 720px; padding-top: 24px; padding-bottom: 56px; }
  h1 { font-family: var(--font-display); font-size: clamp(2.1rem, 6vw, 2.9rem); letter-spacing: -0.02em; line-height: 1.1; margin: 0 0 8px; }
  .lede { color: var(--ink-soft); margin: 0 0 36px; }
  .entry { border-top: 1px solid var(--line); padding: 28px 0; }
  .entry header { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; margin-bottom: 10px; }
  .entry h2 { font-family: var(--font-mono); font-size: 1.05rem; font-weight: 600; color: var(--flow-ink); margin: 0; }
  .entry time { font-family: var(--font-mono); font-size: 0.85rem; color: var(--ink-soft); }
  .entry p { margin: 0 0 12px; }
  .entry ul { margin: 0; padding-left: 1.2em; }
  .entry li { margin: 7px 0; }
  .entry li::marker { color: var(--flow); }
  .entry strong { font-weight: 600; }
  .empty { color: var(--ink-soft); }
</style>
</head>
<body>
<nav class="wrap site-nav">
  <a class="brand" href="./" aria-label="Flowtab home"><img src="logo.png" alt="Flowtab" width="135" height="36"></a>
  <div class="nav-links">
    <a href="./">Home</a>
    <a class="btn btn-primary btn-sm" href="https://app.myflowtab.com/">Open Flowtab</a>
  </div>
</nav>
<main class="wrap">
  <h1>What's new</h1>
  <p class="lede">Every Flowtab release, newest first.</p>
  <section>
${body}  </section>
</main>
<footer class="site-foot">
  <div class="wrap">
    <a class="brand" href="./" aria-label="Flowtab home"><img src="logo.png" alt="Flowtab" width="105" height="28"></a>
    <div class="foot-links">
      <a href="./">Home</a>
      <a href="https://app.myflowtab.com/">Open the app</a>
      <span>© 2026 Flowtab</span>
    </div>
  </div>
</footer>
</body>
</html>
`;
}

function localToday(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const [mode, arg] = process.argv.slice(2);
let source = readFileSync(SOURCE, 'utf8');

switch (mode) {
  case undefined:
    writeFileSync(PAGE, renderPage(parseChangelog(source)));
    console.log(`wrote ${path.relative(root, PAGE)}`);
    break;
  case '--check': {
    const current = (() => {
      try {
        return readFileSync(PAGE, 'utf8');
      } catch {
        return '';
      }
    })();
    if (current !== renderPage(parseChangelog(source))) {
      console.error('website/changelog.html is out of date: run `npm run changelog`.');
      process.exit(1);
    }
    break;
  }
  case '--has-unreleased':
    // 3, not 1: deploy-app.sh must tell "no notes" apart from a crash.
    if (!hasUnreleasedNotes(parseChangelog(source))) process.exit(3);
    break;
  case '--release':
    if (!arg) throw new Error('--release needs a version');
    source = stampRelease(source, arg, localToday());
    writeFileSync(SOURCE, source);
    writeFileSync(PAGE, renderPage(parseChangelog(source)));
    break;
  case '--plain': {
    const entry = parseChangelog(source).find((e) => e.version === arg);
    if (!entry) throw new Error(`No changelog entry for ${arg}`);
    console.log(entryPlainText(entry));
    break;
  }
  default:
    throw new Error(`Unknown mode ${mode}`);
}

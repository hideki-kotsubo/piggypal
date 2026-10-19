// docs/74 — turns one app/CHANGELOG.md release into a draft "update" post
// in marketing/posts/, English only: the changelog is English (docs/59
// D226), and translations are written by a person or Claude afterwards,
// then reviewed (D275). Never overwrites an existing post file.
//
//   npm run social:from-changelog -- 0.7.0             post dated today
//   npm run social:from-changelog -- 0.7.0 2026-10-21  post dated that day
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { entryPlainText, inlineParts, parseChangelog } from '../../app/src/lib/changelog.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const [version, dateArg] = process.argv.slice(2);
if (!version) throw new Error('Usage: npm run social:from-changelog -- <version> [YYYY-MM-DD]');
const entry = parseChangelog(readFileSync(path.join(root, 'app/CHANGELOG.md'), 'utf8')).find((e) => e.version === version);
if (!entry) throw new Error(`No changelog entry for ${version}`);

const today = new Date();
const pad = (n: number) => String(n).padStart(2, '0');
const date = dateArg ?? `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

// A bullet's bold lead-in is its headline ("**Voice language from Home**:
// tap…" → "Voice language from Home"); a bullet without one is shortened
// to its first sentence. Image bullets must stay short to fit.
function shortBullet(item: string): string {
  const lead = inlineParts(item).find((p) => p.bold);
  const text = lead && item.startsWith('**') ? lead.text : item.replace(/\*\*/g, '').split(/(?<=[.!?])\s/)[0];
  return text.replace(/[.:]$/, '');
}

const file = path.join(root, 'marketing/posts', `${date}-v${version.replace(/\./g, '-')}.md`);
if (existsSync(file)) throw new Error(`${path.relative(root, file)} already exists`);

writeFileSync(
  file,
  `---
date: ${date}
template: update
screen: 03-home
crop: top
platforms: instagram, facebook, threads, linkedin
approved:
---

<!-- Draft from app/CHANGELOG.md ${version}. Tighten the headline and
bullets (three fit the feed image), pick a screen that shows the change,
add the pt-BR, es and fr sections, then list the reviewed languages in
approved: (docs/74 D275). -->

## en
headline: New in Flowtab ${version}
sub:
bullets:
${entry.items.map((i) => `- ${shortBullet(i)}`).join('\n')}
caption:
New in Flowtab ${version}:

${entryPlainText(entry)}

Already on Flowtab? Reopen the app to get it. New here? Link in bio.

#Flowtab #budgeting #personalfinance #expensetracker
`,
);
console.log(`wrote ${path.relative(root, file)}`);

// docs/59 — the user-facing changelog. app/CHANGELOG.md is the one source;
// this parser feeds About's "What's new" (bundled via ?raw), and
// scripts/build-changelog.mts, which generates website/changelog.html and
// stamps a release (run through tsx). No imports, so it stays usable from
// both places.

export interface ChangelogEntry {
  version: string; // 'Unreleased' or semver
  date: string | null; // YYYY-MM-DD, null while unreleased
  intro: string[]; // paragraphs
  items: string[]; // bullet points
}

export const UNRELEASED = 'Unreleased';

const HEADING = /^## +(Unreleased|\d+\.\d+\.\d+)(?: +[—–-] +(\d{4}-\d{2}-\d{2}))? *$/;

// Everything before the first `## ` heading (title, how-to comment) is
// ignored, as are HTML comments anywhere. A `## ` line that doesn't match
// HEADING throws: a typo'd heading would otherwise silently merge two
// releases' notes.
export function parseChangelog(source: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  let current: ChangelogEntry | null = null;
  let paragraph: string[] = [];
  let lastWasItem = false;

  const flushParagraph = () => {
    if (current && paragraph.length) current.intro.push(paragraph.join(' '));
    paragraph = [];
  };

  const lines = source.replace(/<!--[\s\S]*?-->/g, '').split('\n');
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith('## ')) {
      const match = HEADING.exec(line);
      if (!match) throw new Error(`Malformed changelog heading: "${line}"`);
      flushParagraph();
      current = { version: match[1], date: match[2] ?? null, intro: [], items: [] };
      entries.push(current);
      lastWasItem = false;
      continue;
    }
    if (!current) continue;

    if (line.trim() === '') {
      flushParagraph();
      lastWasItem = false;
    } else if (/^[-*] /.test(line)) {
      flushParagraph();
      current.items.push(line.slice(2).trim());
      lastWasItem = true;
    } else if (lastWasItem && /^\s+/.test(line)) {
      // Indented continuation of the previous bullet.
      current.items[current.items.length - 1] += ` ${line.trim()}`;
    } else {
      paragraph.push(line.trim());
      lastWasItem = false;
    }
  }
  flushParagraph();
  return entries;
}

export function releasedEntries(entries: ChangelogEntry[]): ChangelogEntry[] {
  return entries.filter((e) => e.version !== UNRELEASED);
}

export function hasUnreleasedNotes(entries: ChangelogEntry[]): boolean {
  const unreleased = entries.find((e) => e.version === UNRELEASED);
  return !!unreleased && (unreleased.intro.length > 0 || unreleased.items.length > 0);
}

// Turns `## Unreleased` into `## <version> — <date>` in the source text,
// leaving everything else byte-for-byte as written.
export function stampRelease(source: string, version: string, date: string): string {
  if (!hasUnreleasedNotes(parseChangelog(source))) {
    throw new Error('No notes under "## Unreleased" to release.');
  }
  if (parseChangelog(source).some((e) => e.version === version)) {
    throw new Error(`The changelog already has an entry for ${version}.`);
  }
  return source.replace(/^## +Unreleased *$/m, `## ${version} — ${date}`);
}

// The only inline formatting supported is **bold**.
export interface InlinePart {
  text: string;
  bold: boolean;
}

export function inlineParts(text: string): InlinePart[] {
  return text
    .split(/(\*\*[^*]+\*\*)/)
    .filter((part) => part !== '')
    .map((part) =>
      part.startsWith('**') && part.endsWith('**') && part.length > 4
        ? { text: part.slice(2, -2), bold: true }
        : { text: part, bold: false },
    );
}

// "Oct 12, 2026". Built from the parts, not `new Date('2026-10-12')`, which
// is UTC midnight and shows the previous day west of Greenwich.
export function formatEntryDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// Plain text for App Store "What's New" / Play Store release notes.
export function entryPlainText(entry: ChangelogEntry): string {
  const strip = (s: string) => s.replace(/\*\*([^*]+)\*\*/g, '$1');
  return [...entry.intro.map(strip), ...entry.items.map((i) => `• ${strip(i)}`)].join('\n');
}

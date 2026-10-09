import { describe, expect, it } from 'vitest';
import realChangelog from '../../CHANGELOG.md?raw';
import {
  entryPlainText,
  formatEntryDate,
  hasUnreleasedNotes,
  inlineParts,
  parseChangelog,
  releasedEntries,
  stampRelease,
} from './changelog';

const SOURCE = `# What's new in Flowtab

<!-- How to write an entry: ...
## Not a heading, it's inside a comment
-->

## Unreleased

Faster sync.

- **New:** a thing
  that wraps.
- Fixed another thing.

## 0.3.0 — 2026-10-12

First release.
Second line of the same paragraph.

Another paragraph.

* Star bullet.
`;

describe('parseChangelog', () => {
  it('parses entries, paragraphs, bullets and continuations', () => {
    const entries = parseChangelog(SOURCE);
    expect(entries).toEqual([
      {
        version: 'Unreleased',
        date: null,
        intro: ['Faster sync.'],
        items: ['**New:** a thing that wraps.', 'Fixed another thing.'],
      },
      {
        version: '0.3.0',
        date: '2026-10-12',
        intro: ['First release. Second line of the same paragraph.', 'Another paragraph.'],
        items: ['Star bullet.'],
      },
    ]);
  });

  it('throws on a malformed heading', () => {
    expect(() => parseChangelog('## 0.3 — 2026-10-12\n- x')).toThrow(/Malformed/);
    expect(() => parseChangelog('## Unreleasd\n- x')).toThrow(/Malformed/);
  });

  it('accepts a plain hyphen as the separator', () => {
    expect(parseChangelog('## 1.0.0 - 2026-01-02\n- x')[0].date).toBe('2026-01-02');
  });
});

describe('releasing', () => {
  it('releasedEntries drops Unreleased', () => {
    expect(releasedEntries(parseChangelog(SOURCE)).map((e) => e.version)).toEqual(['0.3.0']);
  });

  it('hasUnreleasedNotes needs a non-empty Unreleased section', () => {
    expect(hasUnreleasedNotes(parseChangelog(SOURCE))).toBe(true);
    expect(hasUnreleasedNotes(parseChangelog('## Unreleased\n\n## 0.1.0 — 2026-01-01\n- x'))).toBe(false);
    expect(hasUnreleasedNotes(parseChangelog('## 0.1.0 — 2026-01-01\n- x'))).toBe(false);
  });

  it('stampRelease rewrites only the Unreleased heading', () => {
    const out = stampRelease(SOURCE, '0.4.0', '2026-11-01');
    expect(out).toBe(SOURCE.replace('## Unreleased', '## 0.4.0 — 2026-11-01'));
    expect(parseChangelog(out)[0]).toMatchObject({ version: '0.4.0', date: '2026-11-01' });
  });

  it('stampRelease refuses an empty Unreleased or a duplicate version', () => {
    expect(() => stampRelease('## Unreleased\n', '0.4.0', '2026-11-01')).toThrow(/No notes/);
    expect(() => stampRelease(SOURCE, '0.3.0', '2026-11-01')).toThrow(/already has/);
  });
});

describe('formatting', () => {
  it('inlineParts splits out **bold**', () => {
    expect(inlineParts('**New:** a thing')).toEqual([
      { text: 'New:', bold: true },
      { text: ' a thing', bold: false },
    ]);
    expect(inlineParts('no bold')).toEqual([{ text: 'no bold', bold: false }]);
  });

  it('formatEntryDate keeps the calendar date', () => {
    expect(formatEntryDate('2026-10-01')).toBe('Oct 1, 2026');
  });

  it('entryPlainText strips bold and bullets items', () => {
    expect(entryPlainText(parseChangelog(SOURCE)[0])).toBe(
      'Faster sync.\n• New: a thing that wraps.\n• Fixed another thing.',
    );
  });
});

describe('app/CHANGELOG.md', () => {
  it('parses (a malformed heading would break About)', () => {
    expect(parseChangelog(realChangelog).length).toBeGreaterThan(0);
  });
});

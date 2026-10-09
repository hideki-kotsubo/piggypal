import { Link } from 'react-router-dom';
import changelogSource from '../../CHANGELOG.md?raw';
import {
  type ChangelogEntry,
  UNRELEASED,
  formatEntryDate,
  inlineParts,
  parseChangelog,
  releasedEntries,
} from '../lib/changelog';
import { APP_COMMIT, APP_VERSION } from '../lib/version';

// docs/59 — the newest few releases from app/CHANGELOG.md. Dev builds also
// show the not-yet-released notes, to preview how they read.
const parsed = parseChangelog(changelogSource);
const RECENT_CHANGES = (import.meta.env.DEV ? parsed : releasedEntries(parsed)).slice(0, 3);

function Inline({ text }: { text: string }) {
  return (
    <>
      {inlineParts(text).map((part, i) => (part.bold ? <strong key={i}>{part.text}</strong> : part.text))}
    </>
  );
}

function ChangelogItem({ entry }: { entry: ChangelogEntry }) {
  return (
    <div className="changelog-entry">
      <div className="changelog-heading">
        <span className="changelog-version">{entry.version}</span>
        {entry.date && <span className="changelog-date">{formatEntryDate(entry.date)}</span>}
        {entry.version === UNRELEASED && <span className="changelog-date">dev preview</span>}
      </div>
      {entry.intro.map((p, i) => (
        <p key={i}><Inline text={p} /></p>
      ))}
      {entry.items.length > 0 && (
        <ul>
          {entry.items.map((item, i) => (
            <li key={i}><Inline text={item} /></li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AboutScreen() {
  return (
    <main className="home">
      <div className="app-bar">
        <Link to="/settings" className="back-link">← Back</Link>
        <span className="wordmark">About</span>
        <span style={{ width: '3rem' }} />
      </div>

      <p className="about-text">
        Flowtab is a simple, light, private budgeting app — you just type or
        say what you spent.
      </p>
      <p className="about-text">
        Built by Hideki Kotsubo, an independent software developer based in
        Vancouver, Canada.
      </p>

      <div className="accounts-list">
        <a href="mailto:hideki.kotsubo@gmail.com" className="settings-row">
          <span>Contact</span>
          <span style={{ color: 'var(--ink-faint)', fontSize: '0.85rem' }}>hideki.kotsubo@gmail.com</span>
        </a>
        <div className="settings-row settings-row-static">
          <span>Version</span>
          <span style={{ color: 'var(--ink-faint)' }}>{APP_VERSION} ({APP_COMMIT})</span>
        </div>
      </div>

      {RECENT_CHANGES.length > 0 && (
        <>
          <div className="section-label">What's new</div>
          {RECENT_CHANGES.map((entry) => (
            <ChangelogItem key={entry.version} entry={entry} />
          ))}
        </>
      )}
    </main>
  );
}

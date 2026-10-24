import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
  return (
    <div className="changelog-entry">
      <div className="changelog-heading">
        <span className="changelog-version">{entry.version}</span>
        {entry.date && <span className="changelog-date">{formatEntryDate(entry.date)}</span>}
        {entry.version === UNRELEASED && <span className="changelog-date">{t('about.devPreview')}</span>}
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
  const { t } = useTranslation();
  return (
    <main className="home">
      <div className="app-bar">
        <Link to="/settings" className="back-link">← {t('common.back')}</Link>
        <span className="wordmark">{t('about.title')}</span>
        <span style={{ width: '3rem' }} />
      </div>

      <p className="about-text">{t('about.pitch')}</p>
      <p className="about-text">{t('about.author')}</p>

      <div className="accounts-list">
        <a href="mailto:social@myflowtab.com" className="settings-row">
          <span>{t('about.contact')}</span>
          <span style={{ color: 'var(--ink-faint)', fontSize: '0.85rem' }}>social@myflowtab.com</span>
        </a>
        <div className="settings-row settings-row-static">
          <span>{t('about.version')}</span>
          <span style={{ color: 'var(--ink-faint)' }}>{APP_VERSION} ({APP_COMMIT})</span>
        </div>
      </div>

      {RECENT_CHANGES.length > 0 && (
        <>
          <div className="section-label">{t('about.whatsNew')}</div>
          {RECENT_CHANGES.map((entry) => (
            <ChangelogItem key={entry.version} entry={entry} />
          ))}
        </>
      )}
    </main>
  );
}

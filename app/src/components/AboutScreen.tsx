import { Link } from 'react-router-dom';
import { APP_VERSION } from '../lib/version';

export function AboutScreen() {
  return (
    <main className="home">
      <div className="app-bar">
        <Link to="/settings" className="back-link">← Back</Link>
        <span className="wordmark">About</span>
        <span style={{ width: '3rem' }} />
      </div>

      <p className="about-text">
        piggypal is a simple, light, private budgeting app — you just type or
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
          <span style={{ color: 'var(--ink-faint)' }}>{APP_VERSION}</span>
        </div>
      </div>
    </main>
  );
}

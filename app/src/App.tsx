import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { EntryZone } from './components/EntryZone';
import { DueBanner } from './components/DueBanner';
import { InboxBanner } from './components/InboxBanner';
import { RecentList } from './components/RecentList';
import { SessionExpiredBanner } from './components/SessionExpiredBanner';
import { BudgetBars } from './components/BudgetBars';
import { TrendSparkline } from './components/TrendSparkline';
import { hasHousehold, useHouseholdPeers } from './lib/household';
import { pickWordmarkPhrase } from './lib/wordmarkPhrases';
import { useWidthClass } from './lib/layout';

interface ToastState {
  message: string;
  onUndo?: () => void;
}

export default function App() {
  const { t, i18n } = useTranslation();
  const [toast, setToast] = useState<ToastState | null>(null);
  const household = hasHousehold(useHouseholdPeers());
  // Re-picked each time Home mounts (a fresh app open, or navigating back
  // to "/"), not on a timer — a finance app's header shouldn't be visibly
  // ticking. Only re-rolls again if `household` itself flips (e.g. store
  // data finishes loading after first paint), not on every render.
  const wordmark = useMemo(() => pickWordmarkPhrase(i18n.language, household), [i18n.language, household]);
  const wide = useWidthClass() !== 'compact';

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  function showToast(message: string, onUndo?: () => void) {
    setToast({ message, onUndo });
  }

  // docs/80 D316 — on a wide window Home is two columns, and also shows
  // this month's budgets and the trend: a desktop-only exception to
  // docs/07 D147, which moved those to Insights on the phone. Entry and
  // the toast live in AppShell's top bar there (D312).
  if (wide) {
    return (
      <main className="home home-dashboard">
        <div className="dashboard-col">
          <RecentList />
        </div>
        <div className="dashboard-col">
          <SessionExpiredBanner />
          <DueBanner />
          <InboxBanner />
          <TrendSparkline />
          <BudgetBars />
        </div>
      </main>
    );
  }

  return (
    <main className="home home-with-dock">
      <div className="app-bar">
        <span className="wordmark">{wordmark}</span>
        <div className="app-bar-actions">
          <Link to="/insights" className="icon-btn" aria-label={t('nav.insights')}>▤</Link>
          <Link to="/settings" className="kebab" aria-label={t('nav.settings')}>
            <span /><span /><span />
          </Link>
        </div>
      </div>

      <SessionExpiredBanner />
      <DueBanner />
      <InboxBanner />
      <RecentList />

      {/* docs/31 — trial: entry zone docked to the bottom of the screen
          instead of the top. position:fixed takes it out of document flow
          entirely, so its DOM position doesn't affect where it renders —
          kept last, after the scrolling content, to match visual reading
          order top-to-bottom into the composer (same reasoning most
          chat-style UIs place their composer last). */}
      <div className="entry-zone-dock">
        <EntryZone onSubmitted={showToast} />
      </div>

      {toast && (
        <div className="toast toast-above-dock">
          <span>{toast.message}</span>
          {toast.onUndo && (
            <button
              className="toast-undo"
              onClick={() => {
                toast.onUndo!();
                setToast(null);
              }}
            >
              {t('common.undo')}
            </button>
          )}
        </div>
      )}
    </main>
  );
}

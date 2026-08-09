import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { EntryZone } from './components/EntryZone';
import { InboxBanner } from './components/InboxBanner';
import { BudgetBars } from './components/BudgetBars';
import { TrendSparkline } from './components/TrendSparkline';
import { RecentList } from './components/RecentList';

export default function App() {
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <main className="home">
      <div className="app-bar">
        <span className="wordmark">piggypal</span>
        <Link to="/settings" className="kebab" aria-label="Settings">
          <span /><span /><span />
        </Link>
      </div>

      <EntryZone onSubmitted={setToast} />
      <InboxBanner />
      <BudgetBars />
      <TrendSparkline />
      <RecentList />

      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}

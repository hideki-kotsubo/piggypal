import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { EntryZone } from './components/EntryZone';
import { InboxBanner } from './components/InboxBanner';
import { RecentList } from './components/RecentList';

interface ToastState {
  message: string;
  onUndo?: () => void;
}

export default function App() {
  const [toast, setToast] = useState<ToastState | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  function showToast(message: string, onUndo?: () => void) {
    setToast({ message, onUndo });
  }

  return (
    <main className="home">
      <div className="app-bar">
        <span className="wordmark">piggypal</span>
        <div className="app-bar-actions">
          <Link to="/insights" className="icon-btn" aria-label="Insights">▤</Link>
          <Link to="/settings" className="kebab" aria-label="Settings">
            <span /><span /><span />
          </Link>
        </div>
      </div>

      <EntryZone onSubmitted={showToast} />
      <InboxBanner />
      <RecentList />

      {toast && (
        <div className="toast">
          <span>{toast.message}</span>
          {toast.onUndo && (
            <button
              className="toast-undo"
              onClick={() => {
                toast.onUndo!();
                setToast(null);
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}
    </main>
  );
}

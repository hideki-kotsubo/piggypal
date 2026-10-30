import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useStore } from '../lib/store';
import { useWidthClass } from '../lib/layout';

// docs/80 — the wide-window frame around every route. On a phone-sized
// window (compact) it renders the route alone, so the phone app's DOM is
// exactly what it was before this existed. Medium and expanded windows
// get a navigation rail on the left and a top bar with the section's
// title, and the route scrolls inside the main area instead of the page.
export function AppShell() {
  const widthClass = useWidthClass();
  const { pathname } = useLocation();
  const { t } = useTranslation();

  if (widthClass === 'compact') return <Outlet />;

  const section = sectionFor(pathname);
  const isRoot = RAIL.some((item) => item.to === pathname);

  return (
    <div className={`shell shell-${widthClass}`}>
      <NavRail labelled={widthClass === 'expanded'} />
      <div className="shell-main">
        <header className="shell-topbar">
          <h1 className="shell-title">{section ? t(section.label) : ''}</h1>
        </header>
        <div className={`shell-content${isRoot ? ' shell-root' : ''}`}>
          <Outlet />
        </div>
      </div>
    </div>
  );
}

type IconName = 'home' | 'transactions' | 'inbox' | 'insights' | 'accounts' | 'categories' | 'schedules' | 'settings';

interface RailItem {
  to: string;
  label: string;
  icon: IconName;
  // Other paths that belong to this section, for the title and the
  // highlighted rail item.
  also?: string[];
}

const RAIL: RailItem[] = [
  { to: '/', label: 'nav.home', icon: 'home' },
  { to: '/transactions', label: 'transactions.title', icon: 'transactions' },
  { to: '/inbox', label: 'nav.inbox', icon: 'inbox' },
  { to: '/insights', label: 'nav.insights', icon: 'insights' },
  { to: '/accounts', label: 'accounts.title', icon: 'accounts' },
  { to: '/categories', label: 'categories.title', icon: 'categories' },
  { to: '/schedules', label: 'schedules.title', icon: 'schedules' },
  { to: '/settings', label: 'nav.settings', icon: 'settings', also: ['/about', '/auth'] },
];

function sectionFor(pathname: string): RailItem | undefined {
  const within = (base: string) => pathname === base || pathname.startsWith(base + '/');
  return RAIL.find((item) => (item.to === '/' ? pathname === '/' : within(item.to) || item.also?.some(within)));
}

function NavRail({ labelled }: { labelled: boolean }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const store = useStore();
  const inboxCount = store.transactions.filter((tx) => !tx.deletedAt && !tx.categoryId).length;
  const current = sectionFor(pathname);

  return (
    <nav className="shell-rail" aria-label={t('nav.main')}>
      <div className="shell-rail-mark" aria-hidden="true">{labelled ? 'Flowtab' : 'F'}</div>
      {RAIL.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className="shell-rail-item"
          aria-current={current === item ? 'page' : undefined}
          title={labelled ? undefined : t(item.label)}
        >
          <RailIcon name={item.icon} />
          <span className="shell-rail-label">{t(item.label)}</span>
          {item.icon === 'inbox' && inboxCount > 0 && <span className="shell-rail-badge">{inboxCount}</span>}
        </NavLink>
      ))}
    </nav>
  );
}

const ICON_PATHS: Record<IconName, string> = {
  home: 'M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z',
  transactions: 'M4 6h16M4 12h16M4 18h10',
  inbox: 'M3 13h5l1.5 3h5L16 13h5M5 5h14l2 8v6H3v-6z',
  insights: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  accounts: 'M5 6h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zM3 10h18',
  categories: 'M4 5h7v7H4zM13 5h7v7h-7zM4 14h7v6H4zM13 14h7v6h-7z',
  schedules: 'M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM3 10h18M8 3v4M16 3v4',
  settings: 'M12 8.8a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1',
};

function RailIcon({ name }: { name: IconName }) {
  return (
    <svg className="shell-rail-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

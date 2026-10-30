import { Fragment, useState, type ReactNode } from 'react';
import { useLocation, useOutlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useWidthClass } from '../lib/layout';
import { DetailSlotContext, PaneContext } from '../lib/pane';

// docs/80 D313 — a list on the left and the selected item's existing
// detail screen on the right, on wide windows. The detail is a child
// route, so the URL is the same one the phone uses (/accounts/:id) and
// links, refresh and Back keep working. On a phone-sized window this is
// exactly the old behaviour: the detail route replaces the list.

export function SplitLayout({ list, base, emptyKey }: { list: ReactNode; base: string; emptyKey: string }) {
  const widthClass = useWidthClass();
  const outlet = useOutlet();
  const { pathname } = useLocation();
  const { t } = useTranslation();

  if (widthClass === 'compact') return outlet ?? <>{list}</>;

  // Keyed by path: picking another row mounts a fresh detail screen, as
  // the phone does when it goes list → detail. Without it React reuses
  // the open screen with a new :id, and forms that copy the record into
  // their own state on mount (TransactionEditForm) keep showing the
  // first record. Search params aren't in the key, so filters don't
  // remount it.

  return (
    <div className="split">
      <PaneContext.Provider value={{ pane: 'list', base }}>
        <section className="split-list">{list}</section>
      </PaneContext.Provider>
      <PaneContext.Provider value={{ pane: 'detail', base }}>
        <section className="split-detail">{outlet ? <Fragment key={pathname}>{outlet}</Fragment> : <p className="split-empty">{t(emptyKey)}</p>}</section>
      </PaneContext.Provider>
    </div>
  );
}

// docs/80 D314 — Categories has no detail route: a tap opens its edit
// form in a BottomSheet (docs/79 D311). On wide windows the screen gets
// the same two panes, and BottomSheet renders into this slot instead of
// sliding up over the page.
export function SlotSplit({ children, emptyKey }: { children: ReactNode; emptyKey: string }) {
  const widthClass = useWidthClass();
  const { t } = useTranslation();
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  if (widthClass === 'compact') return <>{children}</>;

  return (
    <div className="split">
      <DetailSlotContext.Provider value={slot}>
        <PaneContext.Provider value={{ pane: 'list', base: '' }}>
          <section className="split-list">{children}</section>
        </PaneContext.Provider>
      </DetailSlotContext.Provider>
      <section className="split-detail">
        <div className="split-slot" ref={setSlot} />
        <p className="split-empty">{t(emptyKey)}</p>
      </section>
    </div>
  );
}

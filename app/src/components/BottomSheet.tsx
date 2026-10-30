import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useWidthClass } from '../lib/layout';
import { useDetailSlot } from '../lib/pane';

// docs/79 D311 — the slide-up edit panel shared by Accounts and
// Categories, replacing in-list expansion. Edits still autosave as they're
// typed (the forms commit on change), so Done only closes; there's no
// separate save step to lose. Tapping the scrim or Escape closes too.
//
// docs/80: on wide windows it isn't a sheet. Inside a SlotSplit
// (Categories, D314) it renders in the detail pane beside the list, with
// no scrim; anywhere else it's a centred dialog.
export function BottomSheet({
  title,
  eyebrow,
  onClose,
  children,
}: {
  title: string;
  eyebrow?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const sheetRef = useRef<HTMLDivElement>(null);
  const slot = useDetailSlot();
  const wide = useWidthClass() !== 'compact';
  const inline = wide && slot !== null;
  // Callers pass a fresh arrow each render; the mount effect below must
  // not re-run on it, or focus would jump back to the sheet mid-typing.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    sheetRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    if (!inline) document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus?.();
    };
    // Mount-only on purpose (see onCloseRef); `inline` can't change while
    // the sheet is open without remounting it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (inline) {
    return createPortal(
      <div className="sheet sheet-inline" role="region" aria-label={title} tabIndex={-1} ref={sheetRef}>
        <div className="sheet-head">
          <div className="sheet-titles">
            {eyebrow && <div className="sheet-eyebrow">{eyebrow}</div>}
            <div className="sheet-title">{title}</div>
          </div>
          <button type="button" className="save-btn" onClick={onClose}>
            {t('common.done')}
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>,
      slot,
    );
  }

  return createPortal(
    <div className={`sheet-layer${wide ? ' sheet-layer-dialog' : ''}`}>
      <div className="sheet-scrim" onClick={onClose} aria-hidden="true" />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={sheetRef}>
        <div className="sheet-grab" aria-hidden="true" />
        <div className="sheet-head">
          <div className="sheet-titles">
            {eyebrow && <div className="sheet-eyebrow">{eyebrow}</div>}
            <div className="sheet-title">{title}</div>
          </div>
          <button type="button" className="save-btn" onClick={onClose}>
            {t('common.done')}
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

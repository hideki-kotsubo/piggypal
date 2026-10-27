import { useTranslation } from 'react-i18next';

// docs/77 — the small lock shown on an "Only me" record, in lists and next
// to the edit screen's toggle. Same stroke style as the app's other inline
// icons.
export function PrivateMark() {
  const { t } = useTranslation();
  return (
    <svg className="private-mark" width="11" height="12" viewBox="0 0 11 12" fill="none" role="img" aria-label={t('transaction.onlyMe')}>
      <title>{t('transaction.onlyMe')}</title>
      <rect x="1" y="5" width="9" height="6.2" rx="1.4" stroke="currentColor" strokeWidth="1.3" />
      <path d="M3.2 5V3.6a2.3 2.3 0 0 1 4.6 0V5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

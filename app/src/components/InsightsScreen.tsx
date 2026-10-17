import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BudgetBars } from './BudgetBars';
import { TrendSparkline } from './TrendSparkline';

export function InsightsScreen() {
  const { t } = useTranslation();
  return (
    <main className="home">
      <div className="app-bar">
        <Link to="/" className="back-link">← {t('common.back')}</Link>
        <span className="wordmark">{t('nav.insights')}</span>
        <span style={{ width: '3rem' }} />
      </div>

      <TrendSparkline />
      <BudgetBars />
    </main>
  );
}

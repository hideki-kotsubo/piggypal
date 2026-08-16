import { Link } from 'react-router-dom';
import { BudgetBars } from './BudgetBars';
import { TrendSparkline } from './TrendSparkline';

export function InsightsScreen() {
  return (
    <main className="home">
      <div className="app-bar">
        <Link to="/" className="back-link">← Back</Link>
        <span className="wordmark">Insights</span>
        <span style={{ width: '3rem' }} />
      </div>

      <TrendSparkline />
      <BudgetBars />
    </main>
  );
}

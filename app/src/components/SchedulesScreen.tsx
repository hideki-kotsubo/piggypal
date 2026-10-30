import { centsPerUnit } from '../lib/cents';
import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useStore } from '../lib/store';
import { accountLabel, formatAmount, formatOccurrenceDate } from '../lib/format';
import {
  describeCadence,
  dueOccurrences,
  installmentAmount,
  nextOpenOccurrence,
  occurrenceNote,
  postedKeys,
  remainingCount,
  todayLocal,
  upcomingOccurrences,
} from '../lib/schedules';
import type { Occurrence } from '../lib/schedules';
import type { ScheduledPayment } from '../lib/types';

const UPCOMING_DAYS = 30;

// The amount a rule's list row shows: per occurrence, which for an
// installment plan is the regular (non-first) installment.
function perOccurrenceLabel(rule: ScheduledPayment): string {
  if (rule.kind === 'installment' && rule.occurrenceCount) {
    const each = installmentAmount(rule.amountCents, rule.occurrenceCount, 2, centsPerUnit(rule.currency));
    return `${formatAmount(each, rule.currency)} × ${rule.occurrenceCount}`;
  }
  return `${rule.amountMode === 'estimated' ? '~' : ''}${formatAmount(rule.amountCents, rule.currency)}`;
}

// docs/57 D212 — one open occurrence with its two actions. Shared by this
// screen's Due/Upcoming sections and ScheduleScreen's "Coming up" list.
// "Paid" on an estimated-amount rule opens the posted transaction right
// away so the real amount gets typed before anything else.
export function OccurrenceRow({ rule, occ, today }: { rule: ScheduledPayment; occ: Occurrence; today: string }) {
  const store = useStore();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const overdueDays = occ.date < today ? Math.round((Date.parse(today) - Date.parse(occ.date)) / 86_400_000) : 0;

  async function post(skip: boolean) {
    setBusy(true);
    try {
      const id = await store.postOccurrence(rule, occ, { skip });
      if (!skip && rule.amountMode === 'estimated') navigate(`/transactions/${id}`);
    } catch (err) {
      console.error('flowtab: posting occurrence failed', err);
      setBusy(false);
    }
  }

  return (
    <div className="tx-row schedule-occ-row">
      <div className="tx-main">
        <span className="tx-note">{occurrenceNote(rule, occ)}</span>
        <span className={`tx-meta ${overdueDays > 0 ? 'schedule-overdue' : ''}`}>
          {formatOccurrenceDate(occ.date, today)}
          {overdueDays > 0 && ` · ${t('schedules.overdue', { count: overdueDays })}`}
        </span>
      </div>
      <div className="schedule-occ-right">
        <span className={`tx-amt ${occ.amountCents < 0 ? 'out' : 'in'}`}>
          {rule.amountMode === 'estimated' ? '~' : ''}
          {formatAmount(occ.amountCents, rule.currency)}
        </span>
        <div className="chip-row schedule-occ-actions">
          <button className="chip ghost" disabled={busy} onClick={() => void post(true)}>
            {t('schedules.skip')}
          </button>
          <button className="chip picked" disabled={busy} onClick={() => void post(false)}>
            {t('schedules.paid')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function SchedulesScreen() {
  const store = useStore();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [archivedOpen, setArchivedOpen] = useState(false);
  const today = todayLocal();
  const posted = postedKeys(store.transactions);
  const byId = new Map(store.scheduledPayments.map((r) => [r.id, r]));

  const due = dueOccurrences(store.scheduledPayments, posted, today);
  const dueCount = new Map<string, number>();
  for (const o of due) dueCount.set(o.scheduleId, (dueCount.get(o.scheduleId) ?? 0) + 1);
  const upcoming = upcomingOccurrences(store.scheduledPayments, posted, today, UPCOMING_DAYS);
  const active = store.scheduledPayments
    .filter((r) => !r.archived && !r.deletedAt)
    .sort((a, b) => a.name.localeCompare(b.name));
  const archived = store.scheduledPayments.filter((r) => r.archived && !r.deletedAt);

  function renderRule(rule: ScheduledPayment) {
    const next = nextOpenOccurrence(rule, posted, today);
    const account = store.accounts.find((a) => a.id === rule.accountId);
    const left = remainingCount(rule);
    const meta = [
      describeCadence(rule),
      rule.paused
        ? t('schedules.paused')
        : dueCount.get(rule.id)
          ? t('schedules.dueCount', { count: dueCount.get(rule.id) })
          : next
            ? t('schedules.next', { date: formatOccurrenceDate(next.date, today) })
            : t('schedules.noMore'),
      rule.kind === 'installment' && left !== null && next
        ? t('schedules.left', { left: rule.occurrenceCount! - next.number + 1, total: rule.occurrenceCount })
        : null,
      rule.autoPost ? t('schedules.auto') : null,
      account ? accountLabel(account) : null,
    ].filter(Boolean);
    return (
      <NavLink key={rule.id} to={`/schedules/${rule.id}`} className="tx-row tx-row-tappable">
        <div className="tx-main">
          <span className="tx-note">{rule.name}</span>
          <span className="tx-meta">{meta.join(' · ')}</span>
        </div>
        <span className={`tx-amt ${rule.amountCents < 0 ? 'out' : 'in'}`}>{perOccurrenceLabel(rule)}</span>
      </NavLink>
    );
  }

  return (
    <main className="home">
      <div className="app-bar">
        <Link to="/" className="back-link">← {t('common.back')}</Link>
        <span className="wordmark">{t('schedules.title')}</span>
        <div className="app-bar-actions">
          <button className="icon-btn" aria-label={t('schedules.add')} onClick={() => navigate('/schedules/new')}>
            +
          </button>
        </div>
      </div>

      {due.length > 0 && (
        <section className="schedule-list">
          <div className="section-label">{t('schedules.due')}</div>
          <div className="day-card">
            {due.map((o) => (
              <OccurrenceRow key={`${o.scheduleId}:${o.date}`} rule={byId.get(o.scheduleId)!} occ={o} today={today} />
            ))}
          </div>
        </section>
      )}

      {upcoming.length > 0 && (
        <section className="schedule-list">
          <div className="section-label">{t('schedules.nextDays', { count: UPCOMING_DAYS })}</div>
          <div className="day-card">
            {upcoming.map((o) => (
              <OccurrenceRow key={`${o.scheduleId}:${o.date}`} rule={byId.get(o.scheduleId)!} occ={o} today={today} />
            ))}
          </div>
        </section>
      )}

      <section className="schedule-list">
        <div className="section-label">{t('schedules.schedules')}</div>
        {active.length === 0 ? (
          <p className="empty-note">{t('schedules.empty')}</p>
        ) : (
          <div className="day-card">{active.map(renderRule)}</div>
        )}
      </section>

      {archived.length > 0 && (
        <div className="account-group">
          <button className="group-header" onClick={() => setArchivedOpen((o) => !o)}>
            <span>{t('schedules.stopped', { count: archived.length })}</span>
            <span className="group-count">{archivedOpen ? '▾' : '›'}</span>
          </button>
          {archivedOpen && <div className="schedule-list day-card">{archived.map(renderRule)}</div>}
        </div>
      )}
    </main>
  );
}

import { appendDigit, centsPerUnit, dropDigit } from '../lib/cents';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useStore } from '../lib/store';
import { categoryLabel } from '../lib/starterLabels';
import { totalsByCurrency } from '../lib/filterTransactions';
import { formatAmount, formatOccurrenceDate, nowUtc } from '../lib/format';
import { locationSuggestions } from '../lib/locationSuggestions';
import {
  addDays,
  describeCadence,
  installmentAmount,
  nextOpenOccurrence,
  openOccurrences,
  postedKeys,
  todayLocal,
} from '../lib/schedules';
import type { ScheduleFreq, ScheduledPayment } from '../lib/types';
import { AccountCurrencyPicker } from './AccountCurrencyPicker';
import { AmountKeypad } from './AmountKeypad';
import { CategoryPicker } from './CategoryPicker';
import { OccurrenceRow } from './SchedulesScreen';

const FREQS: { value: ScheduleFreq; labelKey: string }[] = [
  { value: 'weekly', labelKey: 'schedule.weekly' },
  { value: 'monthly', labelKey: 'schedule.monthly' },
  { value: 'yearly', labelKey: 'schedule.yearly' },
];

// docs/57 D210 — the fields that decide *when* occurrences fall. Changing
// one on a rule that already has posted (or skipped) occurrences would
// re-project its whole past and orphan that history, so on such a rule
// these are staged locally and applied as a split from a chosen date
// instead of written in place.
type TimingPatch = Partial<Pick<ScheduledPayment, 'freq' | 'intervalCount' | 'anchorDate'>>;
const TIMING_KEYS = new Set<keyof ScheduledPayment>(['freq', 'intervalCount', 'anchorDate']);

const COMING_UP = 3;

export function ScheduleScreen() {
  const { id } = useParams();
  const store = useStore();
  const { t } = useTranslation();
  if (id === 'new') return <ScheduleEditor rule={null} />;
  const rule = store.scheduledPayments.find((r) => r.id === id && !r.deletedAt);
  if (!rule) {
    return (
      <main className="home">
        <div className="app-bar">
          <Link to="/schedules" className="back-link">← {t('common.back')}</Link>
          <span className="wordmark">{t('schedules.title')}</span>
          <span style={{ width: '3rem' }} />
        </div>
        <p className="empty-note">{t('schedule.missing')}</p>
      </main>
    );
  }
  return <ScheduleEditor key={rule.id} rule={rule} />;
}

function parsePositiveInt(v: string): number | null {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function ScheduleEditor({ rule }: { rule: ScheduledPayment | null }) {
  const store = useStore();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const isNew = rule === null;
  const today = todayLocal();

  const [draft, setDraft] = useState<ScheduledPayment>(() => {
    const accountId = store.defaultAccountId();
    return {
      id: '',
      name: '',
      accountId: accountId || null,
      categoryId: null,
      amountCents: 0,
      amountMode: 'fixed',
      currency: store.defaultCurrencyFor(accountId),
      merchant: null,
      note: null,
      paidByUserId: store.defaultPayerFor(accountId),
      kind: 'recurring',
      freq: 'monthly',
      intervalCount: 1,
      anchorDate: today,
      occurrenceCount: null,
      endDate: null,
      startIndex: 1,
      autoPost: false,
      paused: false,
      archived: false,
      deletedAt: null,
      updatedAt: nowUtc(),
    };
  });
  const [timingDraft, setTimingDraft] = useState<TimingPatch>({});
  const base: ScheduledPayment = rule ?? draft;
  const view: ScheduledPayment = { ...base, ...timingDraft };

  const posted = postedKeys(store.transactions);
  const history = rule
    ? store.transactions
        .filter((tx) => tx.scheduleId === rule.id)
        .sort((a, b) => ((a.occurrenceDate ?? '') < (b.occurrenceDate ?? '') ? 1 : -1))
    : [];
  const lastLoggedDate = history[0]?.occurrenceDate ?? null;
  const stagesTiming = !isNew && history.length > 0;

  // Local mirrors for free-text and keypad fields — same reason as
  // AccountForm/TransactionEditForm: binding inputs straight to store
  // values that round-trip through an async DB write jumps the cursor.
  const [nameStr, setNameStr] = useState(() => base.name);
  const [noteStr, setNoteStr] = useState(() => base.note ?? '');
  const [merchantStr, setMerchantStr] = useState(() => base.merchant ?? '');
  const [amountLocal, setAmountLocal] = useState(() => base.amountCents);
  const [countStr, setCountStr] = useState(() => (base.occurrenceCount ? String(base.occurrenceCount) : ''));
  const [startIndexStr, setStartIndexStr] = useState(() => String(base.startIndex));
  const [intervalStr, setIntervalStr] = useState(() => String(base.intervalCount));
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [endMode, setEndMode] = useState<'never' | 'date' | 'count'>(() =>
    base.endDate ? 'date' : base.kind === 'recurring' && base.occurrenceCount ? 'count' : 'never',
  );
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  function commit(patch: Partial<ScheduledPayment>) {
    if (!rule) {
      setDraft((d) => ({ ...d, ...patch }));
      return;
    }
    const timing: TimingPatch = {};
    const rest: Partial<ScheduledPayment> = {};
    for (const [k, v] of Object.entries(patch) as [keyof ScheduledPayment, never][]) {
      if (stagesTiming && TIMING_KEYS.has(k)) (timing as Record<string, unknown>)[k] = v;
      else (rest as Record<string, unknown>)[k] = v;
    }
    if (Object.keys(timing).length > 0) {
      setTimingDraft((prev) => {
        // The split needs a start date after the last logged payment —
        // default it to the next open one so a bare frequency change is
        // immediately applicable.
        const anchorDefault =
          prev.anchorDate ?? timing.anchorDate ?? nextOpenOccurrence(rule, posted, addDays(lastLoggedDate ?? today, 1))?.date ?? today;
        return { ...prev, anchorDate: anchorDefault, ...timing };
      });
    }
    if (Object.keys(rest).length > 0) store.updateScheduledPayment(rule.id, rest);
  }

  const direction: 'expense' | 'income' = amountLocal <= 0 ? 'expense' : 'income';
  function setAmount(next: number) {
    setAmountLocal(next);
    commit({ amountCents: next });
  }

  const category = store.categories.find((c) => c.id === view.categoryId);
  // docs/15's Location chips, same as TransactionEditForm's — every
  // posted occurrence copies this onto its transaction (D216), so it
  // should read the same as one typed there: a set location shows alone,
  // otherwise the six most used, narrowed while typing.
  const [merchantTyping, setMerchantTyping] = useState(false);
  const merchantSuggestions =
    merchantStr && !merchantTyping
      ? [merchantStr]
      : locationSuggestions(
          store.transactions.filter((t) => !t.deletedAt),
          merchantStr,
        );

  function saveNew() {
    const name = nameStr.trim();
    if (!name) return setError(t('schedule.errName'));
    if (draft.amountCents === 0) return setError(t('schedule.errAmount'));
    if (!draft.accountId) return setError(t('schedule.errAccount'));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.anchorDate)) return setError(t('schedule.errFirstDate'));
    if (draft.kind === 'installment') {
      if (!draft.occurrenceCount || draft.occurrenceCount < 2) return setError(t('schedule.errInstallments'));
      if (draft.startIndex > draft.occurrenceCount) return setError(t('schedule.errStartIndex', { count: draft.occurrenceCount }));
    }
    if (endMode === 'date' && !draft.endDate) return setError(t('schedule.errEndDate'));
    if (endMode === 'count' && !draft.occurrenceCount) return setError(t('schedule.errCount'));
    const id = crypto.randomUUID();
    store.addScheduledPayment({ ...draft, id, name, note: noteStr.trim() || null, updatedAt: nowUtc() });
    navigate(`/schedules/${id}`, { replace: true });
  }

  // docs/57 D217 — what a delete will take with it: only payments still
  // live (skipped ones are already deleted), totalled per currency.
  const livePayments = history.filter((tx) => !tx.deletedAt);
  const liveTotals = totalsByCurrency(livePayments)
    .map((tx) => formatAmount(Math.abs(tx.cents), tx.currency))
    .join(' + ');

  async function confirmDelete() {
    if (!rule) return;
    await store.deleteScheduledPayment(rule.id);
    navigate('/schedules', { replace: true });
  }

  async function applyTiming() {
    if (!rule || !view.anchorDate) return;
    if (lastLoggedDate && view.anchorDate <= lastLoggedDate) {
      setError(t('schedule.errTimingStart', { date: formatOccurrenceDate(lastLoggedDate, today) }));
      return;
    }
    const { anchorDate, ...rest } = timingDraft;
    const newId = await store.splitScheduledPayment(rule.id, anchorDate ?? view.anchorDate, rest);
    navigate(`/schedules/${newId}`, { replace: true });
  }

  function setKind(kind: ScheduledPayment['kind']) {
    if (kind === view.kind) return;
    // Installments always end by count; a recurring rule starts open-ended.
    const count = kind === 'installment' ? parsePositiveInt(countStr) : null;
    if (kind === 'recurring') setCountStr('');
    setEndMode('never');
    commit({ kind, occurrenceCount: count, endDate: null, startIndex: 1 });
    setStartIndexStr('1');
  }

  function setEnd(mode: 'never' | 'date' | 'count') {
    setEndMode(mode);
    if (mode === 'never') commit({ endDate: null, occurrenceCount: null });
    if (mode === 'date') commit({ occurrenceCount: null, endDate: view.endDate ?? addDays(view.anchorDate, 365) });
    if (mode === 'count') commit({ endDate: null, occurrenceCount: parsePositiveInt(countStr) });
  }

  const coming = rule && !rule.paused && !rule.archived ? openOccurrences(rule, posted, rule.anchorDate, addDays(today, 3 * 366)).slice(0, COMING_UP) : [];
  const perInstallment =
    view.kind === 'installment' && view.occurrenceCount && view.occurrenceCount > 0
      ? installmentAmount(view.amountCents, view.occurrenceCount, 2, centsPerUnit(view.currency))
      : null;
  const firstInstallment =
    view.kind === 'installment' && view.occurrenceCount ? installmentAmount(view.amountCents, view.occurrenceCount, 1, centsPerUnit(view.currency)) : null;

  return (
    <main className="home">
      <div className="app-bar">
        <Link to="/schedules" className="back-link">← {t('common.back')}</Link>
        <span className="wordmark">{isNew ? t('schedule.new') : t('schedule.title')}</span>
        <span style={{ width: '3rem' }} />
      </div>

      <div className="transaction-screen-content">
        <div className="account-form">
          <label className="field-label">
            {t('common.name')}
            <input
              className="text-input"
              placeholder={t('schedule.namePlaceholder')}
              value={nameStr}
              onChange={(e) => {
                setNameStr(e.target.value);
                if (!isNew && e.target.value.trim()) commit({ name: e.target.value.trim() });
              }}
            />
          </label>

          <div className="chip-row">
            <button className={`chip ${view.kind === 'recurring' ? 'picked' : ''}`} onClick={() => setKind('recurring')}>
              {t('schedule.recurring')}
            </button>
            <button className={`chip ${view.kind === 'installment' ? 'picked' : ''}`} onClick={() => setKind('installment')}>
              {t('schedule.installments')}
            </button>
          </div>

          <AccountCurrencyPicker
            accountId={view.accountId}
            currency={view.currency}
            onChange={(accountId, currency) =>
              commit(isNew ? { accountId, currency, paidByUserId: store.defaultPayerFor(accountId) } : { accountId, currency })
            }
          />

          <div className="field-label">{view.kind === 'installment' ? t('schedule.purchaseTotal') : t('schedule.amountEach')}</div>
          <AmountKeypad
            amountCents={Math.abs(amountLocal)}
            currency={view.currency}
            direction={direction}
            onDigit={(d) => {
              const abs = appendDigit(amountLocal, d, view.currency);
              setAmount(direction === 'expense' ? -abs : abs);
            }}
            onBackspace={() => {
              const cents = dropDigit(amountLocal, view.currency);
              setAmount(direction === 'expense' ? -cents : cents);
            }}
            onToggleDirection={() => setAmount(-amountLocal)}
          />

          {view.kind === 'installment' && (
            <div className="field-pair">
              <label className="field-label">
                {t('schedule.installments')}
                <input
                  className="text-input"
                  inputMode="numeric"
                  placeholder="10"
                  value={countStr}
                  onChange={(e) => {
                    setCountStr(e.target.value);
                    commit({ occurrenceCount: parsePositiveInt(e.target.value) });
                  }}
                />
              </label>
              <label className="field-label">
                {t('schedule.firstHereIs')}
                <input
                  className="text-input"
                  inputMode="numeric"
                  value={startIndexStr}
                  onChange={(e) => {
                    setStartIndexStr(e.target.value);
                    commit({ startIndex: parsePositiveInt(e.target.value) ?? 1 });
                  }}
                />
              </label>
            </div>
          )}
          {perInstallment !== null && firstInstallment !== null && (
            <p className="field-hint">
              {view.occurrenceCount} × {formatAmount(perInstallment, view.currency)}
              {firstInstallment !== perInstallment && t('schedule.firstOne', { amount: formatAmount(firstInstallment, view.currency) })}
              {view.startIndex > 1 && t('schedule.startingAt', { index: view.startIndex, total: view.occurrenceCount })}
            </p>
          )}

          <div>
            <div className="field-label">{t('schedule.repeats')}</div>
            <div className="chip-row">
              {FREQS.map((f) => (
                <button key={f.value} className={`chip ${view.freq === f.value ? 'picked' : ''}`} onClick={() => commit({ freq: f.value })}>
                  {t(f.labelKey)}
                </button>
              ))}
            </div>
          </div>

          <div className="field-pair">
            <label className="field-label">
              {t('schedule.every')}
              <input
                className="text-input"
                inputMode="numeric"
                value={intervalStr}
                onChange={(e) => {
                  setIntervalStr(e.target.value);
                  const n = parsePositiveInt(e.target.value);
                  if (n) commit({ intervalCount: n });
                }}
              />
            </label>
            <label className="field-label">
              {stagesTiming && Object.keys(timingDraft).length > 0 ? t('schedule.newTimingStarts') : t('schedule.firstPayment')}
              <input
                className="text-input"
                type="date"
                value={view.anchorDate}
                onChange={(e) => {
                  // A native date input reports '' while partially edited
                  // — never write that (see the upload handler's own
                  // occurred_at validator for what a bad date costs).
                  if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) commit({ anchorDate: e.target.value });
                }}
              />
            </label>
          </div>
          <p className="field-hint">{describeCadence(view)}</p>

          {stagesTiming && Object.keys(timingDraft).length > 0 && (
            <div className="merge-conflict">
              <p className="merge-conflict-title">{t('schedule.changeTimingFrom', { date: formatOccurrenceDate(view.anchorDate, today) })}</p>
              <p className="merge-conflict-detail">
                {t('schedule.changeTimingDetail', { cadence: describeCadence(view).toLowerCase() })}
              </p>
              <div className="chip-row">
                <button className="save-btn" onClick={() => void applyTiming()}>{t('schedule.apply')}</button>
                <button
                  className="chip ghost"
                  onClick={() => {
                    setTimingDraft({});
                    setIntervalStr(String(base.intervalCount));
                    setError(null);
                  }}
                >
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          )}

          {view.kind === 'recurring' && (
            <div>
              <div className="field-label">{t('schedule.ends')}</div>
              <div className="chip-row">
                <button className={`chip ${endMode === 'never' ? 'picked' : ''}`} onClick={() => setEnd('never')}>{t('schedule.never')}</button>
                <button className={`chip ${endMode === 'date' ? 'picked' : ''}`} onClick={() => setEnd('date')}>{t('schedule.onDate')}</button>
                <button className={`chip ${endMode === 'count' ? 'picked' : ''}`} onClick={() => setEnd('count')}>{t('schedule.afterN')}</button>
              </div>
              {endMode === 'date' && (
                <input
                  className="text-input"
                  type="date"
                  value={view.endDate ?? ''}
                  onChange={(e) => {
                    if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) commit({ endDate: e.target.value });
                  }}
                />
              )}
              {endMode === 'count' && (
                <input
                  className="text-input"
                  inputMode="numeric"
                  placeholder="12"
                  value={countStr}
                  onChange={(e) => {
                    setCountStr(e.target.value);
                    commit({ occurrenceCount: parsePositiveInt(e.target.value) });
                  }}
                />
              )}
            </div>
          )}

          <div>
            <div className="field-label">{t('schedule.amount')}</div>
            <div className="chip-row">
              <button
                className={`chip ${view.amountMode === 'fixed' ? 'picked' : ''}`}
                onClick={() => commit({ amountMode: 'fixed' })}
              >
                {t('schedule.sameEveryTime')}
              </button>
              <button
                className={`chip ${view.amountMode === 'estimated' ? 'picked' : ''}`}
                onClick={() => commit({ amountMode: 'estimated', autoPost: false })}
              >
                {t('schedule.varies')}
              </button>
            </div>
            {view.amountMode === 'estimated' && (
              <p className="field-hint">{t('schedule.variesHint')}</p>
            )}
          </div>

          {view.amountMode === 'fixed' && (
            <label className="schedule-toggle">
              <input type="checkbox" checked={view.autoPost} onChange={(e) => commit({ autoPost: e.target.checked })} />
              <span>{t('schedule.autoLog')}</span>
            </label>
          )}
          {view.amountMode === 'fixed' && view.autoPost && isNew && view.anchorDate < today && (
            <p className="field-hint">
              {t('schedule.backfillHint', { date: formatOccurrenceDate(view.anchorDate, today) })}
            </p>
          )}

          <div>
            <button className="pill-tap" onClick={() => setCategoryOpen((o) => !o)}>
              {category ? categoryLabel(category) : t('category.uncategorized')} ▾
            </button>
            {categoryOpen && (
              <CategoryPicker
                selectedId={view.categoryId}
                onPick={(categoryId) => {
                  commit({ categoryId });
                  setCategoryOpen(false);
                }}
              />
            )}
          </div>

          {store.profiles.length > 1 && (
            <div>
              <div className="field-label">{t('transaction.paidBy')}</div>
              <div className="chip-row">
                {store.profiles.map((p) => (
                  <button
                    key={p.id}
                    className={`chip ${view.paidByUserId === p.id ? 'picked' : ''}`}
                    onClick={() => commit({ paidByUserId: p.id })}
                  >
                    {p.displayName}
                  </button>
                ))}
              </div>
            </div>
          )}

          <label className="field-label">
            {t('schedule.noteEach')}
            <input
              className="text-input"
              placeholder={nameStr || t('schedule.noteDefault')}
              value={noteStr}
              onChange={(e) => {
                setNoteStr(e.target.value);
                commit({ note: e.target.value.trim() || null });
              }}
            />
          </label>

          <label className="field-label">
            {t('transaction.location')}
            <input
              className="text-input"
              placeholder={t('transaction.optional')}
              value={merchantStr}
              onChange={(e) => {
                const v = e.target.value;
                setMerchantStr(v);
                setMerchantTyping(true);
                commit({ merchant: v.trim() || null });
              }}
            />
          </label>
          {merchantSuggestions.length > 0 && (
            <div className="chip-row">
              {merchantSuggestions.map((m) => (
                <button
                  key={m}
                  className={`chip ${m === merchantStr ? 'picked' : ''}`}
                  onClick={() => {
                    setMerchantStr(m);
                    setMerchantTyping(false);
                    commit({ merchant: m });
                  }}
                >
                  {m}
                </button>
              ))}
            </div>
          )}

          {error && <p className="field-hint schedule-overdue">{error}</p>}

          {isNew ? (
            <div className="form-actions">
              <button className="save-btn" onClick={saveNew}>{t('schedule.save')}</button>
            </div>
          ) : (
            <div className="form-actions">
              {!rule.archived && (
                <button className="text-link" onClick={() => commit({ paused: !rule.paused })}>
                  {rule.paused ? t('schedule.resume') : t('schedule.pause')}
                </button>
              )}
              <button className="text-link" onClick={() => commit({ archived: !rule.archived })}>
                {rule.archived ? t('schedule.restore') : t('schedule.stop')}
              </button>
              <button className="text-link delete-link" onClick={() => setConfirmingDelete(true)}>
                {t('schedule.delete')}
              </button>
            </div>
          )}

          {rule && confirmingDelete && (
            <div className="merge-conflict">
              <p className="merge-conflict-title">
                {livePayments.length === 0
                  ? t('schedule.confirmDelete', { name: rule.name })
                  : t('schedule.confirmDeleteWithPayments', { name: rule.name, count: livePayments.length })}
              </p>
              <p className="merge-conflict-detail">
                {livePayments.length === 0
                  ? t('schedule.nothingLogged')
                  : t('schedule.willBeRemoved', { totals: liveTotals })}
                {' '}{t('schedule.useStopInstead')}
              </p>
              <div className="chip-row">
                <button className="save-btn schedule-delete-btn" onClick={() => void confirmDelete()}>
                  {t('schedule.deleteBtn')}
                </button>
                <button className="chip ghost" onClick={() => setConfirmingDelete(false)}>
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          )}
        </div>

        {coming.length > 0 && (
          <section>
            <div className="section-label">{t('schedule.comingUp')}</div>
            <div className="day-card">
              {coming.map((o) => (
                <OccurrenceRow key={o.date} rule={rule!} occ={o} today={today} />
              ))}
            </div>
          </section>
        )}

        {history.length > 0 && (
          <section>
            <div className="section-label">{t('schedule.logged')}</div>
            <div className="day-card">
              {history.map((tx) =>
                tx.deletedAt ? (
                  <div className="tx-row" key={tx.id}>
                    <div className="tx-main">
                      <span className="tx-note">{tx.note}</span>
                      <span className="tx-meta">{formatOccurrenceDate(tx.occurrenceDate ?? '', today)} · {t('schedule.skipped')}</span>
                    </div>
                    {/* A skip is a soft-deleted posted row (D210), so
                        undoing it can only make it paid — it can't go
                        back to "open" without a hard delete. */}
                    <button className="chip ghost" onClick={() => store.updateTransaction(tx.id, { deletedAt: null })}>
                      {t('schedule.markPaid')}
                    </button>
                  </div>
                ) : (
                  <Link key={tx.id} to={`/transactions/${tx.id}`} className="tx-row tx-row-tappable">
                    <div className="tx-main">
                      <span className="tx-note">{tx.note}</span>
                      <span className="tx-meta">{formatOccurrenceDate(tx.occurrenceDate ?? '', today)}</span>
                    </div>
                    <span className={`tx-amt ${tx.amountCents < 0 ? 'out' : 'in'}`}>{formatAmount(tx.amountCents, tx.currency)}</span>
                  </Link>
                ),
              )}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

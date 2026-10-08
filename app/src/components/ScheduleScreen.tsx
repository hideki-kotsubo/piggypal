import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useStore } from '../lib/store';
import { formatAmount, formatOccurrenceDate, nowUtc } from '../lib/format';
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

const FREQS: { value: ScheduleFreq; label: string }[] = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
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
  if (id === 'new') return <ScheduleEditor rule={null} />;
  const rule = store.scheduledPayments.find((r) => r.id === id);
  if (!rule) {
    return (
      <main className="home">
        <div className="app-bar">
          <Link to="/schedules" className="back-link">← Back</Link>
          <span className="wordmark">Scheduled</span>
          <span style={{ width: '3rem' }} />
        </div>
        <p className="empty-note">This schedule doesn't exist.</p>
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
      updatedAt: nowUtc(),
    };
  });
  const [timingDraft, setTimingDraft] = useState<TimingPatch>({});
  const base: ScheduledPayment = rule ?? draft;
  const view: ScheduledPayment = { ...base, ...timingDraft };

  const posted = postedKeys(store.transactions);
  const history = rule
    ? store.transactions
        .filter((t) => t.scheduleId === rule.id)
        .sort((a, b) => ((a.occurrenceDate ?? '') < (b.occurrenceDate ?? '') ? 1 : -1))
    : [];
  const lastLoggedDate = history[0]?.occurrenceDate ?? null;
  const stagesTiming = !isNew && history.length > 0;

  // Local mirrors for free-text and keypad fields — same reason as
  // AccountForm/TransactionEditForm: binding inputs straight to store
  // values that round-trip through an async DB write jumps the cursor.
  const [nameStr, setNameStr] = useState(() => base.name);
  const [noteStr, setNoteStr] = useState(() => base.note ?? '');
  const [amountLocal, setAmountLocal] = useState(() => base.amountCents);
  const [countStr, setCountStr] = useState(() => (base.occurrenceCount ? String(base.occurrenceCount) : ''));
  const [startIndexStr, setStartIndexStr] = useState(() => String(base.startIndex));
  const [intervalStr, setIntervalStr] = useState(() => String(base.intervalCount));
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [endMode, setEndMode] = useState<'never' | 'date' | 'count'>(() =>
    base.endDate ? 'date' : base.kind === 'recurring' && base.occurrenceCount ? 'count' : 'never',
  );
  const [error, setError] = useState<string | null>(null);

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
      setTimingDraft((t) => {
        // The split needs a start date after the last logged payment —
        // default it to the next open one so a bare frequency change is
        // immediately applicable.
        const anchorDefault =
          t.anchorDate ?? timing.anchorDate ?? nextOpenOccurrence(rule, posted, addDays(lastLoggedDate ?? today, 1))?.date ?? today;
        return { ...t, anchorDate: anchorDefault, ...timing };
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

  function saveNew() {
    const name = nameStr.trim();
    if (!name) return setError('Give it a name.');
    if (draft.amountCents === 0) return setError('Enter an amount.');
    if (!draft.accountId) return setError('Pick an account.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.anchorDate)) return setError('Pick the first payment date.');
    if (draft.kind === 'installment') {
      if (!draft.occurrenceCount || draft.occurrenceCount < 2) return setError('An installment plan needs 2 or more installments.');
      if (draft.startIndex > draft.occurrenceCount) return setError(`The first one here can't be past #${draft.occurrenceCount}.`);
    }
    if (endMode === 'date' && !draft.endDate) return setError('Pick an end date, or choose "Never".');
    if (endMode === 'count' && !draft.occurrenceCount) return setError('Enter how many payments, or choose "Never".');
    const id = crypto.randomUUID();
    store.addScheduledPayment({ ...draft, id, name, note: noteStr.trim() || null, updatedAt: nowUtc() });
    navigate(`/schedules/${id}`, { replace: true });
  }

  async function applyTiming() {
    if (!rule || !view.anchorDate) return;
    if (lastLoggedDate && view.anchorDate <= lastLoggedDate) {
      setError(`Start the new timing after the last logged payment (${formatOccurrenceDate(lastLoggedDate, today)}).`);
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
      ? installmentAmount(view.amountCents, view.occurrenceCount, 2)
      : null;
  const firstInstallment =
    view.kind === 'installment' && view.occurrenceCount ? installmentAmount(view.amountCents, view.occurrenceCount, 1) : null;

  return (
    <main className="home">
      <div className="app-bar">
        <Link to="/schedules" className="back-link">← Back</Link>
        <span className="wordmark">{isNew ? 'New schedule' : 'Schedule'}</span>
        <span style={{ width: '3rem' }} />
      </div>

      <div className="transaction-screen-content">
        <div className="account-form">
          <label className="field-label">
            Name
            <input
              className="text-input"
              placeholder="Rent, Tuition, Car lease, TV 10x…"
              value={nameStr}
              onChange={(e) => {
                setNameStr(e.target.value);
                if (!isNew && e.target.value.trim()) commit({ name: e.target.value.trim() });
              }}
            />
          </label>

          <div className="chip-row">
            <button className={`chip ${view.kind === 'recurring' ? 'picked' : ''}`} onClick={() => setKind('recurring')}>
              Recurring
            </button>
            <button className={`chip ${view.kind === 'installment' ? 'picked' : ''}`} onClick={() => setKind('installment')}>
              Installments
            </button>
          </div>

          <AccountCurrencyPicker
            accountId={view.accountId}
            currency={view.currency}
            onChange={(accountId, currency) =>
              commit(isNew ? { accountId, currency, paidByUserId: store.defaultPayerFor(accountId) } : { accountId, currency })
            }
          />

          <div className="field-label">{view.kind === 'installment' ? 'Total of the purchase' : 'Amount each time'}</div>
          <AmountKeypad
            amountCents={Math.abs(amountLocal)}
            currency={view.currency}
            direction={direction}
            onDigit={(d) => {
              const digits = String(Math.abs(amountLocal)) + d;
              setAmount(direction === 'expense' ? -Number(digits) : Number(digits));
            }}
            onBackspace={() => {
              const cents = Number(String(Math.abs(amountLocal)).slice(0, -1) || '0');
              setAmount(direction === 'expense' ? -cents : cents);
            }}
            onToggleDirection={() => setAmount(-amountLocal)}
          />

          {view.kind === 'installment' && (
            <div className="field-pair">
              <label className="field-label">
                Installments
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
                First one here is #
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
              {firstInstallment !== perInstallment && ` (first one ${formatAmount(firstInstallment, view.currency)})`}
              {view.startIndex > 1 && ` — starting at ${view.startIndex}/${view.occurrenceCount}, earlier ones already paid`}
            </p>
          )}

          <div>
            <div className="field-label">Repeats</div>
            <div className="chip-row">
              {FREQS.map((f) => (
                <button key={f.value} className={`chip ${view.freq === f.value ? 'picked' : ''}`} onClick={() => commit({ freq: f.value })}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="field-pair">
            <label className="field-label">
              Every
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
              {stagesTiming ? 'New timing starts' : 'First payment'}
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
              <p className="merge-conflict-title">Change timing from {formatOccurrenceDate(view.anchorDate, today)}?</p>
              <p className="merge-conflict-detail">
                Payments already logged stay as they are; from that date on it becomes {describeCadence(view).toLowerCase()}.
              </p>
              <div className="chip-row">
                <button className="save-btn" onClick={() => void applyTiming()}>Apply</button>
                <button
                  className="chip ghost"
                  onClick={() => {
                    setTimingDraft({});
                    setIntervalStr(String(base.intervalCount));
                    setError(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {view.kind === 'recurring' && (
            <div>
              <div className="field-label">Ends</div>
              <div className="chip-row">
                <button className={`chip ${endMode === 'never' ? 'picked' : ''}`} onClick={() => setEnd('never')}>Never</button>
                <button className={`chip ${endMode === 'date' ? 'picked' : ''}`} onClick={() => setEnd('date')}>On a date</button>
                <button className={`chip ${endMode === 'count' ? 'picked' : ''}`} onClick={() => setEnd('count')}>After N payments</button>
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
            <div className="field-label">Amount</div>
            <div className="chip-row">
              <button
                className={`chip ${view.amountMode === 'fixed' ? 'picked' : ''}`}
                onClick={() => commit({ amountMode: 'fixed' })}
              >
                Same every time
              </button>
              <button
                className={`chip ${view.amountMode === 'estimated' ? 'picked' : ''}`}
                onClick={() => commit({ amountMode: 'estimated', autoPost: false })}
              >
                Varies
              </button>
            </div>
            {view.amountMode === 'estimated' && (
              <p className="field-hint">Marking one paid opens it so you can type the real amount.</p>
            )}
          </div>

          {view.amountMode === 'fixed' && (
            <label className="schedule-toggle">
              <input type="checkbox" checked={view.autoPost} onChange={(e) => commit({ autoPost: e.target.checked })} />
              <span>Log it automatically when due</span>
            </label>
          )}
          {view.amountMode === 'fixed' && view.autoPost && isNew && view.anchorDate < today && (
            <p className="field-hint">
              Every payment since {formatOccurrenceDate(view.anchorDate, today)} will be logged as soon as you save.
            </p>
          )}

          <div>
            <button className="pill-tap" onClick={() => setCategoryOpen((o) => !o)}>
              {category?.name ?? 'Uncategorized'} ▾
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
              <div className="field-label">Paid by</div>
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
            Note on each payment
            <input
              className="text-input"
              placeholder={nameStr || 'Defaults to the name'}
              value={noteStr}
              onChange={(e) => {
                setNoteStr(e.target.value);
                commit({ note: e.target.value.trim() || null });
              }}
            />
          </label>

          {error && <p className="field-hint schedule-overdue">{error}</p>}

          {isNew ? (
            <div className="form-actions">
              <button className="save-btn" onClick={saveNew}>Save schedule</button>
            </div>
          ) : (
            <div className="form-actions">
              {!rule.archived && (
                <button className="text-link" onClick={() => commit({ paused: !rule.paused })}>
                  {rule.paused ? 'Resume' : 'Pause'}
                </button>
              )}
              <button className="text-link delete-link" onClick={() => commit({ archived: !rule.archived })}>
                {rule.archived ? 'Restore' : 'Stop this schedule'}
              </button>
            </div>
          )}
        </div>

        {coming.length > 0 && (
          <section>
            <div className="section-label">Coming up</div>
            <div className="day-card">
              {coming.map((o) => (
                <OccurrenceRow key={o.date} rule={rule!} occ={o} today={today} />
              ))}
            </div>
          </section>
        )}

        {history.length > 0 && (
          <section>
            <div className="section-label">Logged</div>
            <div className="day-card">
              {history.map((t) =>
                t.deletedAt ? (
                  <div className="tx-row" key={t.id}>
                    <div className="tx-main">
                      <span className="tx-note">{t.note}</span>
                      <span className="tx-meta">{formatOccurrenceDate(t.occurrenceDate ?? '', today)} · Skipped</span>
                    </div>
                    {/* A skip is a soft-deleted posted row (D210), so
                        undoing it can only make it paid — it can't go
                        back to "open" without a hard delete. */}
                    <button className="chip ghost" onClick={() => store.updateTransaction(t.id, { deletedAt: null })}>
                      Mark paid
                    </button>
                  </div>
                ) : (
                  <Link key={t.id} to={`/transactions/${t.id}`} className="tx-row tx-row-tappable">
                    <div className="tx-main">
                      <span className="tx-note">{t.note}</span>
                      <span className="tx-meta">{formatOccurrenceDate(t.occurrenceDate ?? '', today)}</span>
                    </div>
                    <span className={`tx-amt ${t.amountCents < 0 ? 'out' : 'in'}`}>{formatAmount(t.amountCents, t.currency)}</span>
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

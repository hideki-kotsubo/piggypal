import { useMemo, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useStore } from '../lib/store';
import { getLocalUserId } from '../lib/identity';
import { accountLabel, formatAmount, formatDateTime, nowUtc } from '../lib/format';
import { accountName, categoryLabel, starterCategoryAliases } from '../lib/starterLabels';
import { ImportFileError, parseFormerAppJson, type ImportIssue, type ImportLine } from '../lib/importFormerApp';
import {
  buildImportBatch,
  categoryPaths,
  guessAccountKind,
  planImport,
  suggestMapping,
  walletNames,
  type AccountChoice,
  type CategoryChoice,
  type ImportMapping,
  type PlannedLine,
} from '../lib/importPlan';

// docs/81 step 1 — import from the user's former app (JSON). Everything
// happens on the device: read the file, map its wallets and categories
// (I-D8), review against what's already logged, then one atomic write
// (store.importBatch). Transfers are counted and skipped until docs/82.

const MAPPING_KEY = 'flowtab:import-mapping:former-app';

function loadMapping(): Partial<ImportMapping> | undefined {
  try {
    const raw = localStorage.getItem(MAPPING_KEY);
    return raw ? (JSON.parse(raw) as Partial<ImportMapping>) : undefined;
  } catch {
    return undefined;
  }
}

function saveMapping(mapping: ImportMapping): void {
  try {
    const prev = loadMapping();
    localStorage.setItem(
      MAPPING_KEY,
      JSON.stringify({ accounts: { ...prev?.accounts, ...mapping.accounts }, categories: { ...prev?.categories, ...mapping.categories } }),
    );
  } catch {
    // Remembering is a convenience only.
  }
}

type Stage = 'pick' | 'map' | 'review' | 'done';

export function ImportScreen() {
  const store = useStore();
  const { t } = useTranslation();
  const [stage, setStage] = useState<Stage>('pick');
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<ImportLine[]>([]);
  const [mapping, setMapping] = useState<ImportMapping>({ accounts: {}, categories: {} });
  const [picked, setPicked] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [written, setWritten] = useState(0);

  const liveAccounts = store.accounts.filter((a) => !a.archived);
  const liveCategories = store.categories.filter((c) => !c.archived);

  const namedAccounts = useMemo(
    () => store.accounts.map((a) => ({ id: a.id, archived: a.archived, labels: [a.name, accountName(a), accountLabel(a)] })),
    [store.accounts],
  );
  const namedCategories = useMemo(() => {
    const aliases = starterCategoryAliases(store.categories);
    return store.categories.map((c) => ({
      id: c.id,
      parentId: c.parentId,
      archived: c.archived,
      labels: [c.name, categoryLabel(c), ...aliases.filter((a) => a.categoryId === c.id).map((a) => a.alias)],
    }));
  }, [store.categories]);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    try {
      const parsed = parseFormerAppJson(await file.text());
      setFileName(file.name);
      setLines(parsed);
      setMapping(suggestMapping(parsed, namedAccounts, namedCategories, loadMapping()));
      setPicked({});
      setStage('map');
    } catch (err) {
      setError(err instanceof ImportFileError && err.message === 'notJson' ? t('import.errorNotJson') : t('import.errorWrongShape'));
    }
  }

  const wallets = useMemo(() => walletNames(lines), [lines]);
  const paths = useMemo(() => categoryPaths(lines), [lines]);
  const walletCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of lines) for (const g of l.legs) m.set(g.accountName, (m.get(g.accountName) ?? 0) + 1);
    return m;
  }, [lines]);

  const plan = useMemo(() => {
    const idFor = (name: string) => {
      const c = mapping.accounts[name];
      return c?.type === 'existing' ? c.accountId : null;
    };
    return planImport(lines, store.transactions, store.transactionSplits, idFor);
  }, [lines, mapping, store.transactions, store.transactionSplits]);

  // New lines are in unless unticked; matched lines are out unless ticked.
  const isPicked = (p: PlannedLine) => picked[p.line.index] ?? p.status === 'new';
  const selected = plan.filter((p) => (p.status === 'new' || p.status === 'matched') && isPicked(p));
  const count = (s: PlannedLine['status']) => plan.filter((p) => p.status === s).length;

  async function runImport() {
    setBusy(true);
    try {
      saveMapping(mapping);
      const batch = buildImportBatch(
        selected.map((p) => p.line),
        mapping,
        {
          existingCategories: store.categories,
          localUserId: getLocalUserId(),
          payerFor: (id) => store.defaultPayerFor(id),
          newId: () => crypto.randomUUID(),
          now: nowUtc(),
        },
      );
      setWritten(await store.importBatch(batch));
      setStage('done');
    } finally {
      setBusy(false);
    }
  }

  const setAccount = (name: string, choice: AccountChoice) => setMapping((m) => ({ ...m, accounts: { ...m.accounts, [name]: choice } }));
  const setCategory = (path: string, choice: CategoryChoice) =>
    setMapping((m) => ({ ...m, categories: { ...m.categories, [path]: choice } }));

  return (
    <main className="home import-screen">
      <div className="app-bar">
        {stage === 'map' || stage === 'review' ? (
          <button className="back-link" onClick={() => setStage(stage === 'review' ? 'map' : 'pick')}>
            ← {t('common.back')}
          </button>
        ) : (
          <Link to="/settings" className="back-link">← {t('common.back')}</Link>
        )}
        <span className="wordmark">{t('import.title')}</span>
        <span style={{ width: '3rem' }} />
      </div>

      {stage === 'pick' && (
        <>
          <p className="import-text">{t('import.intro')}</p>
          <div className="section-label">{t('import.source')}</div>
          <div className="settings-group import-pad">
            <p className="import-title">{t('import.sourceFormerApp')}</p>
            <p className="import-hint">{t('import.sourceFormerAppHint')}</p>
            <label className="save-btn import-file">
              {t('import.chooseFile')}
              <input type="file" accept="application/json,.json" onChange={(e) => void onFile(e)} hidden />
            </label>
            {error && <p className="import-error" role="alert">{error}</p>}
          </div>
        </>
      )}

      {stage === 'map' && (
        <>
          <p className="import-text">{t('import.fileSummary', { file: fileName, count: lines.length })}</p>
          <div className="section-label">{t('import.accounts')}</div>
          <p className="import-text import-hint">{t('import.accountsHint')}</p>
          <div className="settings-group import-pad">
            {wallets.map((name) => {
              const choice = mapping.accounts[name];
              const value = choice?.type === 'existing' ? choice.accountId : '__create';
              return (
                <label className="import-map-row" key={name}>
                  <span className="import-map-name">
                    {name} <span className="import-count">{walletCounts.get(name)}</span>
                  </span>
                  <select
                    className="text-input"
                    value={value}
                    onChange={(e) =>
                      setAccount(
                        name,
                        e.target.value === '__create'
                          ? { type: 'create', name, kind: guessAccountKind(name) }
                          : { type: 'existing', accountId: e.target.value },
                      )
                    }
                  >
                    <option value="__create">{t('import.createAccount', { name })}</option>
                    {liveAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {accountLabel(a)}
                      </option>
                    ))}
                  </select>
                </label>
              );
            })}
          </div>

          {paths.length > 0 && (
            <>
              <div className="section-label">{t('import.categories')}</div>
              <div className="settings-group import-pad">
                {paths.map(({ path, count: n }) => {
                  const choice = mapping.categories[path] ?? { type: 'create' };
                  const value = choice.type === 'existing' ? choice.categoryId : `__${choice.type}`;
                  return (
                    <label className="import-map-row" key={path}>
                      <span className="import-map-name">
                        {path} <span className="import-count">{n}</span>
                      </span>
                      <select
                        className="text-input"
                        value={value}
                        onChange={(e) => {
                          const v = e.target.value;
                          setCategory(path, v === '__create' ? { type: 'create' } : v === '__none' ? { type: 'none' } : { type: 'existing', categoryId: v });
                        }}
                      >
                        <option value="__create">{t('import.createCategory', { name: path })}</option>
                        <option value="__none">{t('import.noCategory')}</option>
                        {liveCategories.map((c) => {
                          const parent = c.parentId ? store.categories.find((p) => p.id === c.parentId) : undefined;
                          return (
                            <option key={c.id} value={c.id}>
                              {parent ? `${categoryLabel(parent)} › ${categoryLabel(c)}` : categoryLabel(c)}
                            </option>
                          );
                        })}
                      </select>
                    </label>
                  );
                })}
              </div>
            </>
          )}
          <div className="import-actions">
            <button className="save-btn" onClick={() => setStage('review')}>
              {t('import.continue')}
            </button>
          </div>
        </>
      )}

      {stage === 'review' && (
        <>
          <div className="settings-group import-pad import-summary">
            <SummaryLine label={t('import.summaryNew')} value={count('new')} />
            <SummaryLine label={t('import.summaryMatched')} value={count('matched')} />
            <SummaryLine label={t('import.summaryAlready')} value={count('alreadyImported')} />
            <SummaryLine label={t('import.summaryTransfer')} value={count('transfer')} />
            <SummaryLine label={t('import.summaryProblem')} value={count('problem')} />
          </div>
          {count('transfer') > 0 && <p className="import-text import-hint">{t('import.transferNote')}</p>}

          <ReviewSection
            title={t('import.sectionFlagged')}
            items={plan.filter((p) => p.status === 'new' && p.flags.length > 0)}
            isPicked={isPicked}
            onToggle={(p) => setPicked((s) => ({ ...s, [p.line.index]: !isPicked(p) }))}
          />
          <ReviewSection
            title={t('import.sectionMatched')}
            hint={t('import.matchedHint')}
            items={plan.filter((p) => p.status === 'matched')}
            isPicked={isPicked}
            onToggle={(p) => setPicked((s) => ({ ...s, [p.line.index]: !isPicked(p) }))}
          />
          <ReviewSection title={t('import.sectionProblem')} items={plan.filter((p) => p.status === 'problem')} />
          <ReviewSection
            title={t('import.sectionNew')}
            items={plan.filter((p) => p.status === 'new' && p.flags.length === 0)}
            isPicked={isPicked}
            onToggle={(p) => setPicked((s) => ({ ...s, [p.line.index]: !isPicked(p) }))}
            collapsed
          />

          <div className="import-actions">
            <button className="save-btn" disabled={busy || selected.length === 0} onClick={() => void runImport()}>
              {busy ? t('import.importing') : t('import.importButton', { count: selected.length })}
            </button>
          </div>
        </>
      )}

      {stage === 'done' && (
        <>
          <p className="import-text import-title">{t('import.doneCount', { count: written })}</p>
          <p className="import-text import-hint">{t('import.doneHint')}</p>
          <div className="import-actions">
            <Link to="/transactions" className="save-btn">
              {t('import.openTransactions')}
            </Link>
            <button className="chip ghost" onClick={() => setStage('pick')}>
              {t('import.another')}
            </button>
          </div>
        </>
      )}
    </main>
  );
}

function SummaryLine({ label, value }: { label: string; value: number }) {
  return (
    <div className="import-summary-line">
      <span>{label}</span>
      <span className="import-count">{value}</span>
    </div>
  );
}

const ISSUE_KEYS: Record<ImportIssue, string> = {
  badRecord: 'import.issueBadRecord',
  badDate: 'import.issueBadDate',
  badAmount: 'import.issueBadAmount',
  unknownType: 'import.issueUnknownType',
  signMismatch: 'import.issueSignMismatch',
  legsDontSum: 'import.issueLegsDontSum',
  transferShape: 'import.issueTransferShape',
  amountsNotEmpty: 'import.issueAmountsNotEmpty',
};

const PREVIEW_ROWS = 50;

function ReviewSection({
  title,
  hint,
  items,
  isPicked,
  onToggle,
  collapsed,
}: {
  title: string;
  hint?: string;
  items: PlannedLine[];
  isPicked?: (p: PlannedLine) => boolean;
  onToggle?: (p: PlannedLine) => void;
  collapsed?: boolean;
}) {
  const { t } = useTranslation();
  const [showAll, setShowAll] = useState(!collapsed);
  if (items.length === 0) return null;
  const shown = showAll ? items : items.slice(0, PREVIEW_ROWS);
  return (
    <>
      <div className="section-label">
        {title} · {items.length}
      </div>
      {hint && <p className="import-text import-hint">{hint}</p>}
      <div className="settings-group">
        {shown.map((p) => (
          <ReviewRow key={p.line.index} p={p} picked={isPicked?.(p)} onToggle={onToggle ? () => onToggle(p) : undefined} />
        ))}
      </div>
      {!showAll && items.length > PREVIEW_ROWS && (
        <div className="import-actions">
          <button className="chip ghost" onClick={() => setShowAll(true)}>
            {t('import.showAll', { count: items.length })}
          </button>
        </div>
      )}
    </>
  );
}

function ReviewRow({ p, picked, onToggle }: { p: PlannedLine; picked?: boolean; onToggle?: () => void }) {
  const { t } = useTranslation();
  const { line } = p;
  const notes = [
    ...p.flags.map((f) => t(f === 'possibleDuplicate' ? 'import.flagDuplicate' : 'import.flagCurrency')),
    ...line.issues.map((i) => t(ISSUE_KEYS[i])),
  ];
  const body = (
    <>
      <span className="import-row-main">
        <span className="import-row-title">{line.merchant ?? line.note ?? t('category.uncategorized')}</span>
        <span className="import-row-meta">
          {line.occurredAt ? formatDateTime(line.occurredAt) : '—'} · {line.legs.map((g) => g.accountName).join(' + ')}
          {line.categoryName ? ` · ${line.categoryName}` : ''}
        </span>
        {notes.length > 0 && <span className="import-row-flag">{notes.join(' · ')}</span>}
      </span>
      <span className={`tx-amt ${line.amountCents < 0 ? 'out' : 'in'}`}>{line.currency ? formatAmount(line.amountCents, line.currency) : '—'}</span>
    </>
  );
  if (!onToggle) return <div className="import-row">{body}</div>;
  return (
    <label className="import-row import-row-pickable">
      <input type="checkbox" checked={picked ?? false} onChange={onToggle} />
      {body}
    </label>
  );
}

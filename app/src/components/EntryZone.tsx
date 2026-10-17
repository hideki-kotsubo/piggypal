import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useStore } from '../lib/store';
import { categoryLabel, starterAccountAliases, starterCategoryAliases } from '../lib/starterLabels';
import { accountLabel, formatAmount, formatRelativeDate, nowLocal, nowUtc } from '../lib/format';
import { getLocalUserId } from '../lib/identity';
import { markFreshBlank } from '../lib/freshBlankTransactions';
import { parseUtterance } from '../lib/parser';
import { isSpeechInputSupported, startSpeechInput } from '../lib/speechInput';
import i18n, { LANGUAGES } from '../lib/i18n';
import { voiceLanguage } from '../lib/voiceLanguage';
import type { Transaction } from '../lib/types';

interface Props {
  onSubmitted: (message: string, onUndo?: () => void) => void;
}

// What the parser understood, resolved against the store's defaults, held
// for confirmation before anything is written. Each `*Parsed` flag records
// whether the value came out of the utterance or from a fallback, so the
// preview can show the user which is which instead of presenting a
// defaulted account as though they'd said it.
interface Preview {
  text: string;
  amountCents: number; // already signed by direction
  currency: string;
  currencyParsed: boolean;
  accountId: string;
  accountParsed: boolean;
  categoryId: string | null;
  occurredAt: string;
  dateParsed: boolean;
  merchant: string | null; // docs/16 D150/D151 — a confirmed match or a guess, see merchantGuessed
  merchantGuessed: boolean; // docs/16 D151 — true = guessNewMerchant's heuristic, shown with a "guessed" badge like the other *Parsed-false fields
  unrecognized: string | null; // docs/16 D150 — becomes the transaction's note; null falls through to the category-name display (docs/07 D148)
}

export function EntryZone({ onSubmitted }: Props) {
  const store = useStore();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [typedText, setTypedText] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<{ stop: () => void; abort: () => void } | null>(null);

  // docs/19: "+" used to open an inline amount-pad + category-chip panel
  // (tap a category chip to submit) before landing on the transaction's
  // screen (docs/17). That extra step is gone — tapping "+" creates a
  // blank transaction immediately and jumps straight to its screen, where
  // amount/category/account/currency/date-time/note/location are all
  // editable in one place instead of two. Same "everything is a live row,
  // nothing is an unsaved draft" convention as the rest of this app (see
  // docs/16 D94) — the blank row is real the instant it's created, same
  // as tap-entry always was.
  function startBlank() {
    // A real, now-reachable case since accounts are no longer auto-seeded
    // (a fresh real install starts with zero) — without this guard,
    // defaultAccountId()'s '' fallback would silently create a
    // transaction with no real account, invisible in the picker and
    // rejected by Postgres's NOT NULL/FK on the next sync upload.
    //
    // Carried via router state, not onSubmitted()'s toast: the toast is
    // App's own local state, unmounted the instant this navigate() commits
    // — a real Playwright check caught it rendering for one ~50ms frame
    // and never actually being visible to a user. AccountsScreen renders
    // this reason itself instead, so it survives the route change.
    if (store.accounts.length === 0) {
      navigate('/accounts', {
        state: { openCreate: true, reason: t('entry.addAccountFirst') },
      });
      return;
    }
    const accountId = store.defaultAccountId();
    const currency = store.defaultCurrencyFor(accountId);
    const tx: Transaction = {
      id: crypto.randomUUID(),
      accountId,
      categoryId: null,
      amountCents: 0,
      currency,
      occurredAt: nowLocal(),
      note: null,
      merchant: null,
      source: 'manual',
      aiRaw: null,
      deletedAt: null,
      paidByUserId: store.defaultPayerFor(accountId),
      createdByUserId: getLocalUserId(),
      scheduleId: null,
      occurrenceDate: null,
      updatedAt: nowUtc(),
    };
    store.addTransaction(tx);
    markFreshBlank(tx.id);
    navigate(`/transactions/${tx.id}`);
  }

  // docs/16: Tier 1 (docs/04) — on-device, offline, free. No amount found
  // at all soft-blocks (doesn't insert, text stays editable) rather than
  // the spec's undefined "draft" concept, since amount_cents is NOT NULL
  // in the schema. An ambiguous/no-match category degrades into the
  // existing uncategorized inbox (docs/07) exactly like tap-entry's
  // never-guess principle elsewhere in this app.
  //
  // This no longer inserts directly — it resolves the parse into a preview
  // the user confirms (see the parse-preview panel below). Voice needed a
  // commit affordance of its own (a transcript can't reach the old
  // Enter-only submit without raising a keyboard, which defeats speaking
  // in the first place), and showing what the parser understood before
  // writing suits both paths, so both go through it.
  // `language`: what the text is most likely in — the voice language for
  // speech, the UI language for typing (docs/73 D270).
  function buildPreview(rawText: string, language: string) {
    const text = rawText.trim();
    if (!text) return;

    // Same zero-accounts guard as startBlank() above.
    if (store.accounts.length === 0) {
      navigate('/accounts', {
        state: { openCreate: true, reason: t('entry.addAccountFirst') },
      });
      return;
    }

    const result = parseUtterance(text, {
      categories: store.categories,
      keywords: store.categoryKeywords,
      accounts: store.accounts,
      merchants: store.rankedMerchants(),
      now: new Date(),
      language,
      categoryAliases: starterCategoryAliases(store.categories),
      accountAliases: starterAccountAliases(store.accounts),
    });

    if (result.amountCents === null) {
      onSubmitted(t('entry.noAmount'));
      return;
    }

    const accountId = result.accountId ?? store.defaultAccountId();
    setPreview({
      text,
      amountCents: result.direction === 'expense' ? -result.amountCents : result.amountCents,
      currency: result.currency ?? store.defaultCurrencyFor(accountId),
      currencyParsed: result.currency !== null,
      accountId,
      accountParsed: result.accountId !== null,
      categoryId: result.categoryId,
      occurredAt: result.occurredAt ?? nowLocal(),
      dateParsed: result.occurredAt !== null,
      merchant: result.merchant,
      merchantGuessed: result.merchantGuessed,
      unrecognized: result.unrecognized,
    });
  }

  function submitTyped(e: React.FormEvent) {
    e.preventDefault();
    buildPreview(typedText, i18n.language);
  }

  function confirmPreview() {
    if (!preview) return;

    const tx: Transaction = {
      id: crypto.randomUUID(),
      accountId: preview.accountId,
      categoryId: preview.categoryId,
      amountCents: preview.amountCents,
      currency: preview.currency,
      occurredAt: preview.occurredAt,
      // docs/16 D150: whatever the parser couldn't claim for a structured
      // field: null falls through to the category-name display (docs/07
      // D148) instead of duplicating it here.
      note: preview.unrecognized,
      merchant: preview.merchant,
      source: 'ai',
      aiRaw: preview.text,
      deletedAt: null,
      paidByUserId: store.defaultPayerFor(preview.accountId),
      createdByUserId: getLocalUserId(),
      scheduleId: null,
      occurrenceDate: null,
      updatedAt: nowUtc(),
    };
    store.addTransaction(tx);
    setPreview(null);
    setTypedText('');
    onSubmitted(
      preview.categoryId ? t('entry.added') : t('entry.addedToInbox'),
      () => store.deleteTransaction(tx.id),
    );
  }

  // Editing the text invalidates a preview built from the old wording, so
  // it's dropped rather than left showing a stale parse.
  function editText(next: string) {
    setTypedText(next);
    setPreview(null);
  }

  // Voice only fills the text field above — no separate parse path, it's
  // parsed the same way either way (docs/16 D93). It does go straight into
  // the preview on transcription, since that's the whole point of the
  // hands-free path. Feature-detected: the mic button doesn't render at all
  // when unsupported (e.g. desktop Firefox).
  function toggleVoice() {
    if (listening) {
      // Give-up path: abort() cuts the mic immediately and discards
      // whatever's been captured, rather than stop()'s "deliver a final
      // result anyway" behavior — the user pressed this because they
      // don't want anything transcribed. Clearing `listening` here rather
      // than waiting on onEnd keeps the button responsive even on
      // browsers where onend fires late or not at all after an abort.
      recognitionRef.current?.abort();
      setListening(false);
      return;
    }
    const handle = startSpeechInput({
      onResult: (transcript) => {
        setTypedText(transcript);
        buildPreview(transcript, voiceLanguage());
      },
      onError: (error) => {
        setListening(false);
        // docs/73: say why voice stopped, except when nothing was said or
        // the user cancelled.
        if (error === 'not-allowed' || error === 'service-not-allowed') onSubmitted(t('voice.permission'));
        else if (error === 'language-not-supported') {
          const language = LANGUAGES.find((l) => l.tag === voiceLanguage())?.label ?? voiceLanguage();
          onSubmitted(t('voice.languageUnsupported', { language }));
        } else if (error === 'network') onSubmitted(t('voice.network'));
        else if (error !== 'no-speech' && error !== 'aborted') onSubmitted(t('voice.failed'));
      },
      onEnd: () => setListening(false),
    });
    if (!handle) return;
    recognitionRef.current = handle;
    setListening(true);
  }

  return (
    <div className="entry-zone">
      <form onSubmit={submitTyped}>
        <div className="entry-input-row">
          <button type="button" className="add-btn" onClick={startBlank} aria-label={t('entry.addTransaction')}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 1V13M1 7H13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
          <input
            className="entry-input"
            placeholder={listening ? t('entry.listeningPlaceholder') : t('entry.placeholder')}
            value={typedText}
            onChange={(e) => editText(e.target.value)}
          />
          {isSpeechInputSupported() && (
            <button
              type="button"
              className={`mic-btn ${listening ? 'listening' : ''}`}
              onClick={toggleVoice}
              aria-label={listening ? t('entry.stopVoice') : t('entry.startVoice')}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <rect x="5" y="1" width="4" height="7" rx="2" stroke="currentColor" strokeWidth="1.3" />
                <path d="M2.5 6.5C2.5 9 4.5 11 7 11C9.5 11 11.5 9 11.5 6.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                <path d="M7 11V13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            </button>
          )}
          {/* The pulsing ring and the placeholder are both purely visual —
              this is the same state for anyone using a screen reader. */}
          <span className="sr-only" role="status">{listening ? t('entry.listening') : ''}</span>
        </div>

        {preview && (
          <div className="parse-preview">
            <p className="parse-label">{t('entry.understood')}</p>
            <div className="parse-fields">
              <div className="parse-field">
                <span className="k">{t('entry.amount')}</span>
                <span className="v">{formatAmount(preview.amountCents, preview.currency)}</span>
                {!preview.currencyParsed && <span className="defaulted">{t('entry.defaultCurrency')}</span>}
              </div>
              <div className="parse-field">
                <span className="k">{t('entry.category')}</span>
                {preview.categoryId ? (
                  <span className="v">
                    {(() => {
                      const category = store.categories.find((c) => c.id === preview.categoryId);
                      return category ? categoryLabel(category) : '';
                    })()}
                  </span>
                ) : (
                  <span className="v v-warn">{t('entry.uncategorizedToInbox')}</span>
                )}
              </div>
              <div className="parse-field">
                <span className="k">{t('entry.when')}</span>
                <span className="v">{formatRelativeDate(preview.occurredAt)}</span>
                {!preview.dateParsed && <span className="defaulted">{t('entry.default')}</span>}
              </div>
              <div className="parse-field">
                <span className="k">{t('entry.account')}</span>
                <span className="v">
                  {(() => {
                    const account = store.accounts.find((a) => a.id === preview.accountId);
                    return account ? accountLabel(account) : '—';
                  })()}
                </span>
                {!preview.accountParsed && <span className="defaulted">{t('entry.default')}</span>}
              </div>
              {preview.merchant && (
                <div className="parse-field">
                  <span className="k">{t('entry.merchant')}</span>
                  <span className="v">{preview.merchant}</span>
                  {preview.merchantGuessed && <span className="defaulted">{t('entry.guessed')}</span>}
                </div>
              )}
            </div>
            <div className="parse-actions">
              <button type="button" className="chip ghost" onClick={() => setPreview(null)}>
                {t('common.edit')}
              </button>
              <button type="button" className="parse-confirm" onClick={confirmPreview}>
                <svg width="13" height="10" viewBox="0 0 13 10" fill="none" aria-hidden="true">
                  <path d="M1 5L4.5 8.5L12 1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {t('common.save')}
              </button>
            </div>
          </div>
        )}
      </form>
    </div>
  );
}

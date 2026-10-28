import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../lib/store';
import { accountName } from '../lib/starterLabels';
import { ACCOUNT_KINDS, kindLabel, nowUtc } from '../lib/format';
import { getLocalUserId } from '../lib/identity';
import { personLabel, useHouseholdPeers } from '../lib/household';
import type { Account } from '../lib/types';

// docs/79 D311 — shown inside the edit sheet: on the account page for an
// existing account (account set), from the list's "+" for a new one
// (account null). An existing account autosaves on every change, as before.
export function AccountForm({ account, onDone }: { account: Account | null; onDone: () => void }) {
  const store = useStore();
  const { t } = useTranslation();
  const peers = useHouseholdPeers();
  const isNew = account === null;

  const [draft, setDraft] = useState<Account>(
    () =>
      account ?? {
        id: '',
        institution: null,
        name: '',
        kind: 'checking',
        archived: false,
        ownerUserId: getLocalUserId(),
        updatedAt: nowUtc(),
      },
  );
  const current: Account = account ?? draft;

  // Local mirrors of the free-text fields — `current.name`/`current.institution`
  // for an existing account come straight from the store, and commit() writes
  // through an async DB round-trip (PowerSync live query), so binding the
  // input's value directly to them snaps the cursor to the end on every
  // keystroke once that round-trip resolves.
  const [nameStr, setNameStr] = useState(() => (isNew ? current.name : accountName(current)));
  const [institutionStr, setInstitutionStr] = useState(() => current.institution ?? '');

  // Institutions already in use, as one-tap fills — the user's real scale
  // is several accounts per bank (docs/12), so most new ones reuse one.
  const typed = institutionStr.trim().toLowerCase();
  const institutionSuggestions = [
    ...new Set(store.accounts.filter((a) => !a.archived && a.institution).map((a) => a.institution as string)),
  ]
    .filter((i) => i.toLowerCase() !== typed && (!typed || i.toLowerCase().startsWith(typed)))
    .slice(0, 4);

  // docs/71 D252 — removed people aren't offered as a new owner; an
  // account they already own keeps showing their name, marked.
  const people = store.profiles.filter((p) => !p.deletedAt);

  function commit(patch: Partial<Account>) {
    if (isNew) setDraft((d) => ({ ...d, ...patch }));
    else store.updateAccount(current.id, patch);
  }

  function setInstitution(v: string) {
    setInstitutionStr(v);
    commit({ institution: v || null });
  }

  function saveNew() {
    if (!current.name.trim()) return;
    store.addAccount({ ...draft, id: crypto.randomUUID() });
    onDone();
  }

  function archive() {
    if (isNew) return;
    store.updateAccount(current.id, { archived: true });
    onDone();
  }

  return (
    <div className="account-form">
      <label className="field-label">
        {t('common.name')}
        <input
          className="text-input"
          placeholder={t('accounts.namePlaceholder')}
          value={nameStr}
          onChange={(e) => {
            const v = e.target.value;
            setNameStr(v);
            commit({ name: v });
          }}
        />
      </label>

      <div>
        <label className="field-label">
          {t('accounts.institution')}
          <input
            className="text-input"
            placeholder={t('accounts.institutionPlaceholder')}
            value={institutionStr}
            onChange={(e) => setInstitution(e.target.value)}
          />
        </label>
        {institutionSuggestions.length > 0 && (
          <div className="chip-row">
            {institutionSuggestions.map((i) => (
              <button key={i} type="button" className="chip ghost" onClick={() => setInstitution(i)}>
                {i}
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="field-label">{t('accounts.kind')}</div>
        <div className="segmented" role="radiogroup" aria-label={t('accounts.kind')}>
          {ACCOUNT_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={k === current.kind}
              className={k === current.kind ? 'on' : ''}
              onClick={() => commit({ kind: k })}
            >
              {kindLabel(k)}
            </button>
          ))}
        </div>
      </div>

      {/* An account can be linked to a person as its owner, so a
          transaction on it defaults its payer (EntryZone.tsx). Only shown
          once there's more than one person to choose between. */}
      {people.length > 1 && (
        <div>
          <div className="field-label">{t('accounts.owner')}</div>
          <div className="chip-row">
            {people.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`chip ${p.id === current.ownerUserId ? 'picked' : ''}`}
                onClick={() => commit({ ownerUserId: p.id })}
              >
                {p.displayName}
              </button>
            ))}
            <button
              type="button"
              className={`chip ${current.ownerUserId === null ? 'picked' : ''}`}
              onClick={() => commit({ ownerUserId: null })}
            >
              {t('accounts.shared')}
            </button>
            {current.ownerUserId && !people.some((p) => p.id === current.ownerUserId) && (
              <span className="chip picked">{personLabel(current.ownerUserId, peers, store.profiles)}</span>
            )}
          </div>
        </div>
      )}

      <div className="form-actions sheet-actions">
        {isNew ? (
          <>
            <button className="chip ghost" onClick={onDone}>
              {t('common.cancelLower')}
            </button>
            <button className="save-btn" onClick={saveNew} disabled={!current.name.trim()}>
              {t('accounts.add')}
            </button>
          </>
        ) : (
          <button className="text-link archive-link" onClick={archive}>
            {t('accounts.archive')}
          </button>
        )}
      </div>
    </div>
  );
}

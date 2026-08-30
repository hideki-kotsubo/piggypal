import { useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { connectSync, db } from '../lib/db';
import { formatDateTime, nowUtc } from '../lib/format';
import { getLocalUserId } from '../lib/identity';
import { fetchServerSnapshot, takePendingEmail, useAuthAccount, verifyMagicLink } from '../lib/auth';
import { useStore } from '../lib/store';
import { matchAccounts, matchCategories, resolveAccountRewrites, resolveCategoryRewrites } from '../lib/mergeMatch';
import type {
  AccountManualCandidate,
  AccountMatchResult,
  CategoryManualCandidate,
  CategoryMatchResult,
  ManualResolution,
} from '../lib/mergeMatch';
import type { Profile } from '../lib/types';

// docs/41's flagged followup: the app-side half of docs/05's sign-up/
// second-device flow. GET /api/auth/verify itself is real (docs/41); this
// screen is the "app's own JS" that doc's interpretation-call #1 says the
// emailed link depends on, since a raw browser navigation can't supply
// localUserId/deviceId on its own.
//
// docs/48 D177 generalizes docs/46's own-device-vs-someone-else fork
// into a single "pick your profile, or someone new" picker: connect and
// wait for a real first download (D164) → run the merge-matching cascade
// (D167/D168, now parameterized by whichever profile was picked, not
// hardcoded to "own") → only when something needs a human's judgment,
// show it for review (D169) before applying anything.

// Which profile this device is becoming/confirming. 'existing' covers
// both what used to be "my own device" (picking the account owner's own
// profile) and a returning household member's second device (picking
// their own existing profile) — both are really the same operation now,
// just targeting different existing profiles. 'new' is the one case that
// never adopts anything: this device's own pre-existing id becomes the
// new profile's id directly (docs/05 D11's same precedent the account
// owner's very first profile already uses).
type PickedIdentity = { kind: 'existing'; profile: Profile } | { kind: 'new'; displayName: string };

type Step =
  | { kind: 'confirm'; token: string }
  | { kind: 'verifying' }
  | { kind: 'profile-picker'; userId: string; profiles: Profile[]; existingAccounts: number; existingTransactions: number }
  | { kind: 'syncing' }
  | {
      kind: 'merge-review';
      userId: string;
      picked: PickedIdentity;
      categoryMatch: CategoryMatchResult;
      accountMatch: AccountMatchResult | null;
    }
  | { kind: 'done' }
  | { kind: 'error'; message: string };

function initialStep(token: string | null): Step {
  if (!token) return { kind: 'error', message: 'This link is missing its sign-in token.' };
  return { kind: 'confirm', token };
}

export function AuthVerifyScreen() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const store = useStore();
  const [, setAuthAccount] = useAuthAccount();
  const [step, setStep] = useState<Step>(() => initialStep(searchParams.get('token')));
  const [resolutions, setResolutions] = useState<Record<string, ManualResolution>>({});
  // A real bug, found testing this against a real Resend send: the token
  // was already consumed 26 seconds after sending, well before a human
  // could have clicked it — Resend/SES's own click-tracking wraps every
  // link in a redirect that gets auto-visited shortly after send (a
  // known failure mode for one-time-use links behind any click-tracking
  // or mail-security link-scanner, not specific to this provider). Fixed
  // by never calling verifyMagicLink from page load at all — only a real
  // tap on the button below does, since automated visitors load the page
  // (or don't even run its JS) but essentially never simulate a click.
  // verifiedRef is a defensive double-click guard on top of that, not the
  // primary fix — a human tapping twice fast shouldn't fire two calls
  // against a single-use token either.
  const verifiedRef = useRef(false);

  async function confirmSignIn(token: string) {
    if (verifiedRef.current) return;
    verifiedRef.current = true;
    setStep({ kind: 'verifying' });

    try {
      const result = await verifyMagicLink(token);

      // docs/05 D14: only the second-device-joins-an-existing-account
      // case can possibly need the picker/merge sequence below — a
      // brand-new account (isNewUser) was created *using* this device's
      // own local id (D11), so there's nothing to reconcile.
      if (!result.isNewUser && result.userId !== getLocalUserId()) {
        // Queried directly against SQLite, not store.accounts/
        // store.transactions — a real bug, found while first testing
        // this screen: StoreProvider flips `ready` (and so mounts this
        // screen) right after *registering* its db.watch() calls, not
        // after their first result actually lands, so this handler can
        // run while React's store state is still the empty initial
        // array even though real seeded data already exists in SQLite.
        // A direct await here can't be fooled by that timing gap.
        const [{ count: existingAccounts }] = await db.getAll<{ count: number }>('SELECT COUNT(*) as count FROM accounts');
        const [{ count: existingTransactions }] = await db.getAll<{ count: number }>(
          'SELECT COUNT(*) as count FROM transactions WHERE deleted_at IS NULL',
        );

        // docs/48 D177: no separate "remembered, don't ask again" flag
        // needed anymore (docs/46 D166's DEVICE_ROLE_KEY is gone) — if
        // this device's own id already matches an existing profile (it
        // adopted or created one on a previous sign-in), just proceed as
        // that profile directly instead of asking again.
        const snapshot = await fetchServerSnapshot();
        const profiles = snapshot?.profiles ?? [];
        const alreadyKnown = profiles.find((p) => p.id === getLocalUserId());
        if (alreadyKnown) {
          await proceedWithProfile(result.userId, { kind: 'existing', profile: alreadyKnown });
        } else {
          setStep({ kind: 'profile-picker', userId: result.userId, profiles, existingAccounts, existingTransactions });
        }
        return;
      }

      // docs/48 D177: a brand-new account — this device's own pre-existing
      // id becomes the account owner's one and only profile, same "first
      // device's id doubles as the real identity" precedent docs/05 D11
      // already established for users.id itself. Guarded to only ever
      // fire on the actual signup moment, never a repeat sign-in on an
      // already-established device — this profile's id is a primary key.
      if (result.isNewUser) {
        store.addProfile({ id: getLocalUserId(), displayName: 'You', updatedAt: nowUtc() });
      }
      await finish(result.userId);
    } catch (err) {
      setStep({ kind: 'error', message: err instanceof Error ? err.message : 'Sign-in failed.' });
    }
  }

  async function choosePickedIdentity(userId: string, picked: PickedIdentity) {
    if (picked.kind === 'new') {
      // This device's own pre-existing getLocalUserId() becomes the new
      // profile's id directly — no adoption/rewrite needed, it's already
      // what every local row this device has ever written uses.
      store.addProfile({ id: getLocalUserId(), displayName: picked.displayName, updatedAt: nowUtc() });
    }
    await proceedWithProfile(userId, picked);
  }

  // docs/46 D164: connect and wait for a real first download *before*
  // touching any local row — this is the actual fix for the reported bug.
  // The old flow rewrote local ownership and started uploading before
  // this device had ever seen the account's real state; that race is
  // exactly what let a category collision silently vanish data instead of
  // surfacing as a conflict.
  async function proceedWithProfile(userId: string, picked: PickedIdentity) {
    setStep({ kind: 'syncing' });
    try {
      await connectSync();
      // fetchServerSnapshot() is a plain, independent HTTP call — it
      // doesn't depend on PowerSync's own sync stream finishing, so there
      // was no real reason to wait for waitForFirstSync() before starting
      // it. A real user noticed the sequential version feels like a
      // frozen screen for up to ~30s on a real account's data volume;
      // running them together overlaps that network round trip with the
      // (usually longer) download wait instead of adding to it.
      const [, snapshot] = await Promise.all([db.waitForFirstSync(), fetchServerSnapshot()]);

      if (!snapshot) {
        // Real network hiccup — don't block sign-in forever over it.
        // An existing profile still gets identity adopted (same as the
        // old flow's "own device" fallback); a brand-new profile needed
        // the snapshot for anything meaningful here anyway, so there's
        // genuinely nothing more to do.
        if (picked.kind === 'existing') await store.adoptAccountId(picked.profile.id);
        await finish(userId);
        return;
      }

      const categoryMatch = matchCategories(store.categories, snapshot.categories);
      // docs/48 D177 generalizes D168's hard rule: account matching only
      // ever runs when reconciling this device's own pre-existing local
      // accounts against the *picked* profile's already-known accounts —
      // true whether that profile is the account owner or any other
      // already-known household member's own second device. Never runs
      // for a brand-new profile (nothing server-side exists under that id
      // yet — this is the actual fix for two household members'
      // identically-named accounts never being conflated, generalized
      // from "own vs. someone-else" to "any specific profile").
      const accountMatch =
        picked.kind === 'existing'
          ? matchAccounts(
              store.accounts.filter((a) => a.ownerUserId === getLocalUserId()),
              snapshot.accounts.filter((a) => a.ownerUserId === picked.profile.id),
            )
          : null;

      const needsReview = categoryMatch.manual.length > 0 || (accountMatch?.manual.length ?? 0) > 0;
      if (!needsReview) {
        await applyAndFinish(userId, picked, categoryMatch, accountMatch, {});
        return;
      }
      setResolutions({});
      setStep({ kind: 'merge-review', userId, picked, categoryMatch, accountMatch });
    } catch (err) {
      setStep({ kind: 'error', message: err instanceof Error ? err.message : 'Could not check your account.' });
    }
  }

  async function applyAndFinish(
    userId: string,
    picked: PickedIdentity,
    categoryMatch: CategoryMatchResult,
    accountMatch: AccountMatchResult | null,
    manualResolutions: Record<string, ManualResolution>,
  ) {
    const categoryRewrites = resolveCategoryRewrites(store.categories, categoryMatch, manualResolutions);
    const accountRewrites = accountMatch ? resolveAccountRewrites(store.accounts, accountMatch, manualResolutions) : [];
    await store.applySignInMergePlan({
      categoryRewrites,
      accountRewrites,
      // docs/48 D177: identity only ever rewrites onto an *existing*
      // profile — a brand-new one is already this device's own id.
      identity: picked.kind === 'existing' ? { newId: picked.profile.id } : null,
    });
    await finish(userId);
  }

  async function finish(userId: string) {
    setAuthAccount({ userId, email: takePendingEmail() });
    // docs/48 D176 — refresh this device's own devices row right after
    // connecting, on every sign-in path that reaches here (new signup,
    // repeat sign-in, or either profile-picker branch).
    void connectSync().then(() => store.touchDevice());
    setStep({ kind: 'done' });
  }

  async function discardAndFinish(userId: string) {
    await store.discardAndAdoptAccountId(userId);
    await finish(userId);
  }

  const allManualResolved = (step: Extract<Step, { kind: 'merge-review' }>) => {
    const catIds = step.categoryMatch.manual.map((m) => m.local.id);
    const acctIds = step.accountMatch?.manual.map((m) => m.local.id) ?? [];
    return [...catIds, ...acctIds].every((id) => resolutions[id]);
  };

  return (
    <main className="home">
      <div className="app-bar">
        <span className="wordmark">Sign in</span>
      </div>

      {step.kind === 'confirm' && (
        <div className="qr-stage">
          <p className="qr-caption">Tap below to finish signing in.</p>
          <button className="save-btn" onClick={() => void confirmSignIn(step.token)}>
            Sign in
          </button>
        </div>
      )}

      {(step.kind === 'verifying' || step.kind === 'syncing') && (
        <div className="qr-stage">
          <div className="spinner" aria-hidden="true" />
          <p className="qr-caption">
            {step.kind === 'verifying'
              ? 'Signing you in…'
              : "Downloading your account — this can take a moment on a real account's worth of data."}
          </p>
        </div>
      )}

      {step.kind === 'profile-picker' && (
        <ProfilePicker
          step={step}
          onPickExisting={(profile) => void choosePickedIdentity(step.userId, { kind: 'existing', profile })}
          onPickNew={(displayName) => void choosePickedIdentity(step.userId, { kind: 'new', displayName })}
          onDiscard={() => void discardAndFinish(step.userId)}
        />
      )}

      {step.kind === 'merge-review' && (
        <div className="merge-review">
          <p className="section-label">A few things need your call</p>
          <div className="merge-conflicts">
            {step.categoryMatch.manual.map((m) => (
              <CategoryConflict
                key={m.local.id}
                conflict={m}
                resolution={resolutions[m.local.id]}
                onResolve={(r) => setResolutions((prev) => ({ ...prev, [m.local.id]: r }))}
              />
            ))}
            {step.accountMatch?.manual.map((m) => (
              <AccountConflict
                key={m.local.id}
                conflict={m}
                resolution={resolutions[m.local.id]}
                onResolve={(r) => setResolutions((prev) => ({ ...prev, [m.local.id]: r }))}
              />
            ))}
          </div>
          <button
            className="save-btn"
            disabled={!allManualResolved(step)}
            onClick={() => void applyAndFinish(step.userId, step.picked, step.categoryMatch, step.accountMatch, resolutions)}
          >
            Continue
          </button>
        </div>
      )}

      {step.kind === 'done' && (
        <div className="qr-stage">
          <div className="confirm-check">✓</div>
          <p className="qr-caption">Signed in. Sync will continue in the background.</p>
          <button className="save-btn" onClick={() => navigate('/settings')}>
            Done
          </button>
        </div>
      )}

      {step.kind === 'error' && (
        <div className="qr-stage">
          <p className="qr-caption">{step.message}</p>
          <button className="save-btn" onClick={() => navigate('/settings')}>
            Back to Settings
          </button>
        </div>
      )}
    </main>
  );
}

// docs/48 D177 — replaces the old fixed own-device/someone-else binary
// with a list of every existing profile plus "someone new." Picking an
// existing profile subsumes what used to be exactly one hardcoded choice
// ("my own device") — any known profile, not just the account owner's,
// can now be picked directly by whoever's device this is.
function ProfilePicker({
  step,
  onPickExisting,
  onPickNew,
  onDiscard,
}: {
  step: Extract<Step, { kind: 'profile-picker' }>;
  onPickExisting: (profile: Profile) => void;
  onPickNew: (displayName: string) => void;
  onDiscard: () => void;
}) {
  const [addingNew, setAddingNew] = useState(false);
  const [newName, setNewName] = useState('');

  if (addingNew) {
    return (
      <div className="qr-stage">
        <p className="qr-caption">What's their name?</p>
        <input className="text-input" placeholder="e.g. Wife" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button className="save-btn" disabled={!newName.trim()} onClick={() => onPickNew(newName.trim())}>
          Continue
        </button>
        <button className="chip ghost" onClick={() => setAddingNew(false)}>
          Back
        </button>
      </div>
    );
  }

  return (
    <div className="qr-stage">
      <p className="qr-caption">
        This device already has {step.existingAccounts} account{step.existingAccounts === 1 ? '' : 's'} and{' '}
        {step.existingTransactions} transaction{step.existingTransactions === 1 ? '' : 's'}. Whose device is this?
      </p>
      {step.profiles.map((p) => (
        <button key={p.id} className="save-btn" onClick={() => onPickExisting(p)}>
          This is {p.displayName}'s device
        </button>
      ))}
      <button className="chip ghost" onClick={() => setAddingNew(true)}>
        Someone new
      </button>
      {/* docs/05 D14, unchanged from before: typing this email and
          tapping the magic link IS the explicit "this is me" signal —
          discard is for the common real case of a never-touched device
          whose only "existing data" is seedIfEmpty()'s own demo
          placeholders, nothing worth reconciling either way. */}
      <button className="text-link" onClick={onDiscard}>
        Discard this device's data & sign in
      </button>
    </div>
  );
}

// docs/46 D169 — manual, always, with enough context to actually decide:
// both versions side by side, plus which was touched more recently
// (Phase 1's local `updatedAt`, now round-tripped from the server via the
// snapshot endpoint). "Keep mine"/"Keep theirs" map directly onto
// mergeMatch.ts's 'local'/'server' resolutions — a split and a "keep
// mine" are the same operation there, same for merge/"keep theirs".
function CategoryConflict({
  conflict,
  resolution,
  onResolve,
}: {
  conflict: CategoryManualCandidate;
  resolution: ManualResolution | undefined;
  onResolve: (r: ManualResolution) => void;
}) {
  return (
    <div className="merge-conflict">
      <p className="merge-conflict-title">"{conflict.local.name}" vs. "{conflict.server.name}"</p>
      <p className="merge-conflict-detail">Both are categorized under a different parent — probably not the same thing, but worth a glance.</p>
      <div className="parse-fields">
        <div className="parse-field">
          <span className="k">Yours</span>
          <span className="v">{conflict.local.name}</span>
          <span className="defaulted">edited {formatDateTime(conflict.local.updatedAt)}</span>
        </div>
        <div className="parse-field">
          <span className="k">Theirs</span>
          <span className="v">{conflict.server.name}</span>
          <span className="defaulted">edited {formatDateTime(conflict.server.updatedAt)}</span>
        </div>
      </div>
      <div className="chip-row">
        <button className={`chip ${resolution === 'local' ? 'picked' : ''}`} onClick={() => onResolve('local')}>
          Keep mine
        </button>
        <button className={`chip ${resolution === 'server' ? 'picked' : ''}`} onClick={() => onResolve('server')}>
          Keep theirs
        </button>
      </div>
    </div>
  );
}

function AccountConflict({
  conflict,
  resolution,
  onResolve,
}: {
  conflict: AccountManualCandidate;
  resolution: ManualResolution | undefined;
  onResolve: (r: ManualResolution) => void;
}) {
  return (
    <div className="merge-conflict">
      <p className="merge-conflict-title">
        "{conflict.local.institution ?? ''} {conflict.local.name}" vs. "{conflict.server.institution ?? ''} {conflict.server.name}"
      </p>
      <p className="merge-conflict-detail">Same name, different account type — probably not the same account, but worth a glance.</p>
      <div className="parse-fields">
        <div className="parse-field">
          <span className="k">Yours</span>
          <span className="v">{conflict.local.kind}</span>
          <span className="defaulted">edited {formatDateTime(conflict.local.updatedAt)}</span>
        </div>
        <div className="parse-field">
          <span className="k">Theirs</span>
          <span className="v">{conflict.server.kind}</span>
          <span className="defaulted">edited {formatDateTime(conflict.server.updatedAt)}</span>
        </div>
      </div>
      <div className="chip-row">
        <button className={`chip ${resolution === 'local' ? 'picked' : ''}`} onClick={() => onResolve('local')}>
          Keep mine
        </button>
        <button className={`chip ${resolution === 'server' ? 'picked' : ''}`} onClick={() => onResolve('server')}>
          Keep theirs
        </button>
      </div>
    </div>
  );
}

import { useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { connectSync, db } from '../lib/db';
import { formatDateTime } from '../lib/format';
import { getDeviceRole, getLocalUserId, setDeviceRole } from '../lib/identity';
import type { DeviceRole } from '../lib/identity';
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

// docs/41's flagged followup: the app-side half of docs/05's sign-up/
// second-device flow. GET /api/auth/verify itself is real (docs/41); this
// screen is the "app's own JS" that doc's interpretation-call #1 says the
// emailed link depends on, since a raw browser navigation can't supply
// localUserId/deviceId on its own.
//
// docs/46 replaces the old bare merge-prompt with a real sequence: ask
// own-device-vs-household-member first (D165/D166, mirrors docs/25
// D125-127/D138-139's already-shipped P2P pattern) → connect and wait for
// a real first download (D164, closes the exact race that caused the
// reported vanished-data bug) → run the merge-matching cascade (D167/
// D168) against the account's real state → only when something needs a
// human's judgment, show it for review (D169) before applying anything.
type Step =
  | { kind: 'confirm'; token: string }
  | { kind: 'verifying' }
  | { kind: 'household-fork'; userId: string; existingAccounts: number; existingTransactions: number }
  | { kind: 'syncing' }
  | {
      kind: 'merge-review';
      userId: string;
      role: DeviceRole;
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
      // case can possibly need the fork/merge sequence below — a
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

        // docs/46 D166: a device that's already answered this question
        // (this sign-in or a previous one) doesn't get asked again.
        const remembered = getDeviceRole();
        if (remembered) {
          await proceedWithRole(result.userId, remembered);
        } else {
          setStep({ kind: 'household-fork', userId: result.userId, existingAccounts, existingTransactions });
        }
        return;
      }

      await finish(result.userId);
    } catch (err) {
      setStep({ kind: 'error', message: err instanceof Error ? err.message : 'Sign-in failed.' });
    }
  }

  async function chooseRole(userId: string, role: DeviceRole) {
    setDeviceRole(role);
    await proceedWithRole(userId, role);
  }

  // docs/46 D164: connect and wait for a real first download *before*
  // touching any local row — this is the actual fix for the reported bug.
  // The old flow rewrote local ownership and started uploading before
  // this device had ever seen the account's real state; that race is
  // exactly what let a category collision silently vanish data instead of
  // surfacing as a conflict.
  async function proceedWithRole(userId: string, role: DeviceRole) {
    setStep({ kind: 'syncing' });
    try {
      await connectSync();
      await db.waitForFirstSync();
      const snapshot = await fetchServerSnapshot();

      if (!snapshot) {
        // Real network hiccup — don't block sign-in forever over it.
        // "own device" still gets identity unified (same as the old,
        // simpler flow); "someone else" needed the snapshot for anything
        // meaningful here anyway, so there's genuinely nothing more to do.
        if (role === 'own') await store.adoptAccountId(userId);
        await finish(userId);
        return;
      }

      const categoryMatch = matchCategories(store.categories, snapshot.categories);
      // D168's hard rule: account matching only ever runs for "my own
      // device" — never "someone else," where every local account stays
      // distinct by construction (this is the actual fix for two
      // household members' identically-named accounts never being
      // conflated).
      const accountMatch = role === 'own' ? matchAccounts(store.accounts, snapshot.accounts) : null;

      const needsReview = categoryMatch.manual.length > 0 || (accountMatch?.manual.length ?? 0) > 0;
      if (!needsReview) {
        await applyAndFinish(userId, role, categoryMatch, accountMatch, {});
        return;
      }
      setResolutions({});
      setStep({ kind: 'merge-review', userId, role, categoryMatch, accountMatch });
    } catch (err) {
      setStep({ kind: 'error', message: err instanceof Error ? err.message : 'Could not check your account.' });
    }
  }

  async function applyAndFinish(
    userId: string,
    role: DeviceRole,
    categoryMatch: CategoryMatchResult,
    accountMatch: AccountMatchResult | null,
    manualResolutions: Record<string, ManualResolution>,
  ) {
    const categoryRewrites = resolveCategoryRewrites(store.categories, categoryMatch, manualResolutions);
    const accountRewrites = accountMatch ? resolveAccountRewrites(store.accounts, accountMatch, manualResolutions) : [];
    await store.applySignInMergePlan({
      categoryRewrites,
      accountRewrites,
      // D165: identity only ever unifies for "my own device."
      identity: role === 'own' ? { newId: userId } : null,
    });
    await finish(userId);
  }

  async function finish(userId: string) {
    setAuthAccount({ userId, email: takePendingEmail() });
    void connectSync();
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
          <p className="qr-caption">{step.kind === 'verifying' ? 'Signing you in…' : 'Checking your account…'}</p>
        </div>
      )}

      {step.kind === 'household-fork' && (
        <div className="qr-stage">
          <p className="qr-caption">
            This device already has {step.existingAccounts} account{step.existingAccounts === 1 ? '' : 's'} and{' '}
            {step.existingTransactions} transaction{step.existingTransactions === 1 ? '' : 's'}. Is this your own
            device, or is someone else in your household signing in?
          </p>
          <button className="save-btn" onClick={() => void chooseRole(step.userId, 'own')}>
            This is my own device
          </button>
          <button className="chip ghost" onClick={() => void chooseRole(step.userId, 'someone-else')}>
            Someone else in my household
          </button>
          {/* docs/05 D14, unchanged from before: typing this email and
              tapping the magic link IS the explicit "this is me" signal —
              discard is for the common real case of a never-touched
              device whose only "existing data" is seedIfEmpty()'s own
              demo placeholders, nothing worth reconciling either way. */}
          <button className="text-link" onClick={() => void discardAndFinish(step.userId)}>
            Discard this device's data & sign in
          </button>
        </div>
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
            onClick={() => void applyAndFinish(step.userId, step.role, step.categoryMatch, step.accountMatch, resolutions)}
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

import { useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { connectSync, db } from '../lib/db';
import { getLocalUserId } from '../lib/identity';
import { takePendingEmail, useAuthAccount, verifyMagicLink } from '../lib/auth';
import { useStore } from '../lib/store';

// docs/41's flagged followup: the app-side half of docs/05's sign-up/
// second-device flow. GET /api/auth/verify itself is real (docs/41); this
// screen is the "app's own JS" that doc's interpretation-call #1 says the
// emailed link depends on, since a raw browser navigation can't supply
// localUserId/deviceId on its own.
type Step =
  | { kind: 'confirm'; token: string }
  | { kind: 'verifying' }
  | { kind: 'merge-prompt'; userId: string; existingAccounts: number; existingTransactions: number }
  | { kind: 'done' }
  | { kind: 'declined' }
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
      // case can possibly have a conflict to ask about — a brand-new
      // account (isNewUser) was created *using* this device's own local
      // id (D11), so there's nothing to reconcile.
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
        if (existingAccounts === 0 && existingTransactions === 0) {
          await finish(result.userId);
        } else {
          setStep({ kind: 'merge-prompt', userId: result.userId, existingAccounts, existingTransactions });
        }
        return;
      }

      await finish(result.userId);
    } catch (err) {
      setStep({ kind: 'error', message: err instanceof Error ? err.message : 'Sign-in failed.' });
    }
  }

  async function finish(userId: string) {
    setAuthAccount({ userId, email: takePendingEmail() });
    void connectSync();
    setStep({ kind: 'done' });
  }

  async function mergeAndFinish(userId: string) {
    await store.adoptAccountId(userId);
    await finish(userId);
  }

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

      {step.kind === 'verifying' && (
        <div className="qr-stage">
          <p className="qr-caption">Signing you in…</p>
        </div>
      )}

      {step.kind === 'merge-prompt' && (
        <div className="qr-stage">
          <p className="qr-caption">
            This device already has {step.existingAccounts} account{step.existingAccounts === 1 ? '' : 's'} and{' '}
            {step.existingTransactions} transaction{step.existingTransactions === 1 ? '' : 's'}. Merge them into your
            account, or keep this device separate?
          </p>
          <button className="save-btn" onClick={() => void mergeAndFinish(step.userId)}>
            Merge into my account
          </button>
          <button className="text-link" onClick={() => setStep({ kind: 'declined' })}>
            Keep this device separate
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

      {step.kind === 'declined' && (
        <div className="qr-stage">
          <p className="qr-caption">Not signed in — this device's data was left untouched.</p>
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

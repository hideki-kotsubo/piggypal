import { useEffect, useRef, useState } from 'react';
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
  | { kind: 'verifying' }
  | { kind: 'merge-prompt'; userId: string; existingAccounts: number; existingTransactions: number }
  | { kind: 'done' }
  | { kind: 'declined' }
  | { kind: 'error'; message: string };

export function AuthVerifyScreen() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const store = useStore();
  const [, setAuthAccount] = useAuthAccount();
  const [step, setStep] = useState<Step>({ kind: 'verifying' });
  // React StrictMode double-invokes effects in dev (mount → cleanup →
  // mount) — a real bug, hit while first testing this screen: the token
  // is single-use (docs/41), so the second invocation's verify call
  // always fails with "already consumed," and its error state landed
  // after the first call's real success/merge-prompt state, clobbering
  // it. Same bug class as docs/25 D136, different fix — this is a
  // one-shot effect, not a shared DOM node, so a ref guard is enough.
  const verifiedRef = useRef(false);

  useEffect(() => {
    if (verifiedRef.current) return;
    verifiedRef.current = true;

    const token = searchParams.get('token');
    if (!token) {
      setStep({ kind: 'error', message: 'This link is missing its sign-in token.' });
      return;
    }

    (async () => {
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
          // after their first result actually lands, so this effect can
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
    })();
    // Runs once against this load's token, deliberately not on every
    // searchParams/store change — a second run would try to consume an
    // already-consumed single-use magic link (docs/41).
  }, []);

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

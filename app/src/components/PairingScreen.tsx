import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';
import QrScanner from 'qr-scanner';
import { answerOffer, completeOffer, exchangeHello, exchangeJson, startOffer } from '../lib/pairing';
import type { AnswerSession, OfferSession } from '../lib/pairing';
import { getLocalUserId } from '../lib/identity';
import { usePairedPeers } from '../lib/peers';
import { useStore } from '../lib/store';
import type { MergeSummary, PeerDataset } from '../lib/types';

// docs/27's sketch (frames 2-5), implemented for real, now with docs/24's
// actual merge wired in (previously stubbed — see docs/00-backlog). One
// deliberate deviation from the sketch, flagged when this was first
// built: the sketch drew "show your code" and "scan + confirm" as two
// different devices' single screens. A real handshake needs *both*
// devices to both show and scan — whoever goes first shows-then-scans,
// the other scans-then-shows-back — so this adds a "who goes first"
// choice the sketch simplified away.

type IdentityChoice = 'own-device' | 'someone-else';
type Role = 'show-first' | 'scan-first';

type Step =
  | { kind: 'choice' }
  | { kind: 'role' }
  | { kind: 'show-offer'; session: OfferSession }
  | { kind: 'scan-for-answer'; session: OfferSession }
  | { kind: 'scan-for-offer' }
  | { kind: 'show-answer'; session: AnswerSession }
  | { kind: 'merge-prompt'; channel: RTCDataChannel; peerLabel: string; existingAccounts: number; existingTransactions: number }
  | { kind: 'merging' }
  | { kind: 'synced'; peerLabel: string; summary: MergeSummary }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string };

function guessDeviceLabel(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android device';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows PC';
  return 'This device';
}

export function PairingScreen() {
  const navigate = useNavigate();
  const store = useStore();
  const [, recordSync] = usePairedPeers();
  const [identity, setIdentity] = useState<IdentityChoice | null>(null);
  const [step, setStep] = useState<Step>({ kind: 'choice' });

  function chooseIdentity(choice: IdentityChoice) {
    setIdentity(choice);
    setStep({ kind: 'role' });
  }

  async function chooseRole(role: Role) {
    if (role === 'show-first') {
      try {
        const session = await startOffer();
        setStep({ kind: 'show-offer', session });
      } catch {
        setStep({ kind: 'error', message: 'Could not start pairing on this device.' });
      }
    } else {
      setStep({ kind: 'scan-for-offer' });
    }
  }

  // Runs the actual docs/24 merge: exchange full local datasets over the
  // now-open channel, apply the peer's data with store.applyPeerDataset,
  // land on a real "synced" summary instead of the placeholder copy this
  // screen originally shipped with.
  async function performMerge(channel: RTCDataChannel, peerLabel: string, adoptPeerIdentity: boolean) {
    setStep({ kind: 'merging' });
    try {
      const localDataset: PeerDataset = {
        localUserId: getLocalUserId(),
        categories: store.categories,
        accounts: store.accounts,
        transactions: store.transactions,
        budgets: store.budgets,
      };
      const peerDataset = await exchangeJson<PeerDataset>(channel, localDataset);
      const summary = await store.applyPeerDataset(peerDataset, adoptPeerIdentity);
      recordSync(peerLabel);
      setStep({ kind: 'synced', peerLabel, summary });
    } catch {
      setStep({ kind: 'error', message: 'Connection dropped before syncing finished.' });
    }
  }

  // Shared by both roles once their data channel is open — docs/25 D125:
  // only the *joining* device in "my own device" mode (the one that
  // scanned someone else's already-showing code) ever unifies identity;
  // the device that showed its code first stays canonical. "someone
  // else" mode never unifies identity at all, regardless of role.
  async function afterHandshake(channel: RTCDataChannel, role: 'offerer' | 'answerer') {
    try {
      const { peerLabel, peerLocalUserId } = await exchangeHello(channel, guessDeviceLabel(), getLocalUserId());

      // Already the same identity (e.g. re-pairing after an earlier
      // own-device merge already unified them) — nothing to ask about or
      // rewrite, skip straight to a plain merge.
      const isJoiningDeviceInOwnDeviceMode =
        identity === 'own-device' && role === 'answerer' && peerLocalUserId !== getLocalUserId();
      if (isJoiningDeviceInOwnDeviceMode) {
        // docs/25 D126: ask before rewriting this device's existing data
        // — but only if there's anything to ask about. Skips straight to
        // the merge for a genuinely fresh device, matching D126's "a
        // fresh device with no prior data skips this sheet entirely."
        const existingAccounts = store.accounts.length;
        const existingTransactions = store.transactions.length;
        if (existingAccounts > 0 || existingTransactions > 0) {
          setStep({ kind: 'merge-prompt', channel, peerLabel, existingAccounts, existingTransactions });
          return;
        }
        await performMerge(channel, peerLabel, true);
        return;
      }

      await performMerge(channel, peerLabel, false);
    } catch {
      setStep({ kind: 'error', message: 'Connection dropped before syncing finished.' });
    }
  }

  async function handleScannedOffer(offerPayload: string) {
    try {
      const session = await answerOffer(offerPayload);
      setStep({ kind: 'show-answer', session });
      const channel = await session.channelPromise;
      await afterHandshake(channel, 'answerer');
    } catch {
      setStep({ kind: 'error', message: "Couldn't complete pairing — try again." });
    }
  }

  async function handleScannedAnswer(session: OfferSession, answerPayload: string) {
    try {
      await completeOffer(session, answerPayload);
      const channel = await session.channelPromise;
      await afterHandshake(channel, 'offerer');
    } catch {
      setStep({ kind: 'error', message: 'Connection dropped before syncing finished.' });
    }
  }

  return (
    <main className="home">
      <div className="app-bar">
        {step.kind === 'choice' ? (
          <Link to="/settings" className="back-link">
            ← Cancel
          </Link>
        ) : (
          <button className="back-link" onClick={() => setStep({ kind: 'choice' })}>
            ← Cancel
          </button>
        )}
      </div>

      {step.kind === 'choice' && (
        <>
          <div className="section-label">who are you connecting with?</div>
          <div className="choice-stack">
            <button className="choice-card" onClick={() => chooseIdentity('own-device')}>
              <span className="choice-title">This is my own device</span>
              <span className="choice-sub">Phone, tablet, laptop — all you.</span>
            </button>
            <button className="choice-card" onClick={() => chooseIdentity('someone-else')}>
              <span className="choice-title">Someone else's device</span>
              <span className="choice-sub">A partner, roommate, or family member.</span>
            </button>
          </div>
        </>
      )}

      {step.kind === 'role' && (
        <>
          <div className="section-label">which device is this?</div>
          <div className="choice-stack">
            <button className="choice-card" onClick={() => chooseRole('show-first')}>
              <span className="choice-title">Show my code first</span>
              <span className="choice-sub">The other device will scan it.</span>
            </button>
            <button className="choice-card" onClick={() => chooseRole('scan-first')}>
              <span className="choice-title">Scan their code first</span>
              <span className="choice-sub">The other device is showing a code now.</span>
            </button>
          </div>
        </>
      )}

      {step.kind === 'show-offer' && (
        <QrShowStep
          payload={step.session.offerPayload}
          caption="Have the other device scan this code."
          onNext={() => setStep({ kind: 'scan-for-answer', session: step.session })}
          nextLabel="I've shown it — scan their code back"
        />
      )}

      {step.kind === 'scan-for-answer' && (
        <QrScanStep
          caption="Now scan the code the other device is showing."
          onResult={(text) => void handleScannedAnswer(step.session, text)}
        />
      )}

      {step.kind === 'scan-for-offer' && (
        <QrScanStep caption="Point at the other device's code." onResult={(text) => void handleScannedOffer(text)} />
      )}

      {step.kind === 'show-answer' && (
        <QrShowStep payload={step.session.answerPayload} caption="Show this back to the first device." />
      )}

      {step.kind === 'merge-prompt' && (
        <div className="qr-stage">
          <p className="qr-caption">
            This device already has {step.existingAccounts} account{step.existingAccounts === 1 ? '' : 's'} and{' '}
            {step.existingTransactions} transaction{step.existingTransactions === 1 ? '' : 's'}. Merge them into your
            account, or keep this device separate?
          </p>
          <button className="save-btn" onClick={() => void performMerge(step.channel, step.peerLabel, true)}>
            Merge into my account
          </button>
          <button className="text-link" onClick={() => setStep({ kind: 'cancelled' })}>
            Keep this device separate
          </button>
        </div>
      )}

      {step.kind === 'merging' && (
        <div className="qr-stage">
          <p className="qr-caption">Syncing…</p>
        </div>
      )}

      {step.kind === 'synced' && (
        <div className="qr-stage">
          <div className="confirm-check">✓</div>
          <p className="qr-caption">
            Synced with <b>{step.peerLabel}</b>. Added {step.summary.categoriesAdded} categories,{' '}
            {step.summary.accountsAdded} accounts, {step.summary.transactionsAdded} transactions,{' '}
            {step.summary.budgetsAdded} budgets
            {step.summary.budgetsUpdated > 0 ? ` (${step.summary.budgetsUpdated} updated)` : ''}.
          </p>
          <button className="save-btn" onClick={() => navigate('/settings')}>
            Done
          </button>
        </div>
      )}

      {step.kind === 'cancelled' && (
        <div className="qr-stage">
          <p className="qr-caption">Pairing cancelled — nothing on this device was changed.</p>
          <button className="save-btn" onClick={() => navigate('/settings')}>
            Done
          </button>
        </div>
      )}

      {step.kind === 'error' && (
        <div className="qr-stage">
          <p className="qr-caption">{step.message}</p>
          <button className="save-btn" onClick={() => setStep({ kind: 'choice' })}>
            Try again
          </button>
        </div>
      )}
    </main>
  );
}

function QrShowStep({
  payload,
  caption,
  onNext,
  nextLabel,
}: {
  payload: string;
  caption: string;
  onNext?: () => void;
  nextLabel?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    // docs/25 D132: level L (not M) at a larger render size — a real
    // device test found M too dense to scan quickly on weaker hardware.
    void QRCode.toCanvas(canvasRef.current, payload, { errorCorrectionLevel: 'L', width: 280 });
  }, [payload]);

  return (
    <div className="qr-stage">
      <canvas ref={canvasRef} className="qr-canvas" />
      <p className="qr-caption">{caption}</p>
      {onNext && (
        <button className="save-btn" onClick={onNext}>
          {nextLabel}
        </button>
      )}
    </div>
  );
}

function QrScanStep({ caption, onResult }: { caption: string; onResult: (text: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!videoRef.current) return;
    const scanner = new QrScanner(videoRef.current, (result) => onResultRef.current(result.data), {
      highlightScanRegion: true,
      highlightCodeOutline: true,
    });
    scanner.start().catch(() => setError('Camera access is needed to scan a code.'));
    return () => {
      scanner.stop();
      scanner.destroy();
    };
  }, []);

  return (
    <div className="camera-view">
      <video ref={videoRef} className="camera-video" />
      <p className="camera-caption">{error ?? caption}</p>
    </div>
  );
}

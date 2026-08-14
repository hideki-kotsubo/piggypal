import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';
import QrScanner from 'qr-scanner';
import { answerOffer, completeOffer, exchangeHello, startOffer } from '../lib/pairing';
import type { AnswerSession, OfferSession } from '../lib/pairing';
import { usePairedPeers } from '../lib/peers';

// docs/27's sketch (frames 2-5), implemented for real. One deliberate
// deviation from the sketch, flagged when this was built: the sketch drew
// "show your code" and "scan + confirm" as two different devices' single
// screens. A real handshake needs *both* devices to both show and scan —
// whoever goes first shows-then-scans, the other scans-then-shows-back —
// so this adds a "who goes first" choice the sketch simplified away.
//
// docs/25 D125-D127 (own-device identity unification) and docs/24's
// actual data merge are explicitly NOT implemented here yet — this proves
// the transport and the UI flow. "Synced" below means the two devices
// really connected and confirmed a hello/ack over a real WebRTC data
// channel (D118), not that any transaction/account/category data moved.

type IdentityChoice = 'own-device' | 'someone-else';
type Role = 'show-first' | 'scan-first';

type Step =
  | { kind: 'choice' }
  | { kind: 'role' }
  | { kind: 'show-offer'; session: OfferSession }
  | { kind: 'scan-for-answer'; session: OfferSession }
  | { kind: 'scan-for-offer' }
  | { kind: 'show-answer'; session: AnswerSession }
  | { kind: 'connecting' }
  | { kind: 'synced'; peerLabel: string }
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

  const handleScannedOffer = useCallback(
    async (offerPayload: string) => {
      try {
        const session = await answerOffer(offerPayload);
        setStep({ kind: 'show-answer', session });
        const channel = await session.channelPromise;
        const { peerLabel } = await exchangeHello(channel, guessDeviceLabel());
        recordSync(peerLabel);
        setStep({ kind: 'synced', peerLabel });
      } catch {
        setStep({ kind: 'error', message: "Couldn't complete pairing — try again." });
      }
    },
    [recordSync],
  );

  const handleScannedAnswer = useCallback(
    async (session: OfferSession, answerPayload: string) => {
      try {
        await completeOffer(session, answerPayload);
        setStep({ kind: 'connecting' });
        const channel = await session.channelPromise;
        const { peerLabel } = await exchangeHello(channel, guessDeviceLabel());
        recordSync(peerLabel);
        setStep({ kind: 'synced', peerLabel });
      } catch {
        setStep({ kind: 'error', message: 'Connection dropped before syncing finished.' });
      }
    },
    [recordSync],
  );

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

      {step.kind === 'connecting' && (
        <div className="qr-stage">
          <p className="qr-caption">Connecting…</p>
        </div>
      )}

      {step.kind === 'synced' && (
        <div className="qr-stage">
          <div className="confirm-check">✓</div>
          <p className="qr-caption">
            Connected to <b>{step.peerLabel}</b>. {identity === 'own-device' ? 'Identity unification' : 'Household data merge'} isn't
            wired up yet — this confirms the connection and handshake work end to end.
          </p>
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
    // docs/25's own flagged risk, confirmed by a real device: level M was
    // dense enough (module count, not physical size) to slow scanning on
    // weaker hardware. Dropping to L is the mitigation that doc already
    // named as the right first move — a screen-to-screen scan is a clean
    // signal source, not worn/dirty like print, so the lower redundancy
    // is a reasonable trade. Larger render size too, so each module is
    // physically bigger for the same module count.
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

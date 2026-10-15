import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { deviceLinkPayload, startDeviceLink } from '../lib/auth';
import { useStore } from '../lib/store';
import { QrCanvas } from './Qr';

// docs/71 D255 (docs/48 D178) — the signed-in side of QR device linking:
// shows a single-use code for a few minutes. The new device scans it from
// Settings' "Scan a code" (ScanDeviceLinkScreen). Distinct from docs/25's
// "Connect a device", which syncs directly over WebRTC with no account.
type State =
  | { kind: 'loading' }
  | { kind: 'showing'; token: string; expiresAt: number }
  | { kind: 'expired' }
  | { kind: 'error'; message: string };

export function DeviceLinkScreen() {
  const store = useStore();
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  // Every device row already known when this screen opened — a new id
  // appearing means the scanning device finished signing in (its row is
  // written once it has picked its profile), so this side can say so.
  const knownDeviceIds = useRef(new Set(store.devices.map((d) => d.id)));
  const added = store.devices.find((d) => !knownDeviceIds.current.has(d.id));

  useEffect(() => {
    // Each start retires the previous code server-side, so only the
    // latest request's code may be shown — StrictMode's double effect
    // otherwise races two of them.
    let cancelled = false;
    setState({ kind: 'loading' });
    startDeviceLink()
      .then(({ token, expiresAt }) => {
        if (!cancelled) setState({ kind: 'showing', token, expiresAt: new Date(expiresAt).getTime() });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ kind: 'error', message: err instanceof Error ? err.message : 'Could not create a code.' });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  useEffect(() => {
    if (state.kind !== 'showing') return;
    const timer = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= state.expiresAt) setState({ kind: 'expired' });
    }, 1000);
    return () => clearInterval(timer);
  }, [state]);

  return (
    <main className="home">
      <div className="app-bar">
        <Link to="/settings/household" className="back-link">← Back</Link>
        <span className="wordmark">Add a device</span>
        <span style={{ width: '3rem' }} />
      </div>

      <div className="qr-stage">
        {added ? (
          <>
            <div className="confirm-check">✓</div>
            <p className="qr-caption">“{added.label}” is signed in to this account.</p>
            <button className="save-btn" onClick={() => navigate('/settings/household')}>
              Done
            </button>
          </>
        ) : state.kind === 'loading' ? (
          <div className="spinner" aria-hidden="true" />
        ) : state.kind === 'showing' ? (
          <>
            <QrCanvas payload={deviceLinkPayload(state.token)} />
            <p className="qr-caption">
              On the new device, open Flowtab → Settings → <b>Scan a code from a signed-in device</b>, and point it
              here. Anyone who can see this code can join your account, so only show it to people in your household.
            </p>
            <p className="device-link-countdown">
              Works once · expires in {formatCountdown(Math.max(0, state.expiresAt - now))}
            </p>
          </>
        ) : (
          <>
            <p className="qr-caption">{state.kind === 'expired' ? 'That code expired.' : state.message}</p>
            <button className="save-btn" onClick={() => setAttempt((n) => n + 1)}>
              Show a new code
            </button>
          </>
        )}
      </div>
    </main>
  );
}

function formatCountdown(ms: number): string {
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

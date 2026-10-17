import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
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
        if (!cancelled) setState({ kind: 'error', message: err instanceof Error ? err.message : t('deviceLink.createFailed') });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  useEffect(() => {
    if (state.kind !== 'showing') return;
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= state.expiresAt) setState({ kind: 'expired' });
    }, 1000);
    return () => clearInterval(timer);
  }, [state]);

  return (
    <main className="home">
      <div className="app-bar">
        <Link to="/settings/household" className="back-link">← {t('common.back')}</Link>
        <span className="wordmark">{t('deviceLink.title')}</span>
        <span style={{ width: '3rem' }} />
      </div>

      <div className="qr-stage">
        {added ? (
          <>
            <div className="confirm-check">✓</div>
            <p className="qr-caption">{t('deviceLink.added', { label: added.label })}</p>
            <button className="save-btn" onClick={() => navigate('/settings/household')}>
              {t('common.done')}
            </button>
          </>
        ) : state.kind === 'loading' ? (
          <div className="spinner" aria-hidden="true" />
        ) : state.kind === 'showing' ? (
          <>
            <QrCanvas payload={deviceLinkPayload(state.token)} />
            <p className="qr-caption">
              <Trans i18nKey="deviceLink.instructions" components={{ b: <b /> }} />
            </p>
            <p className="device-link-countdown">
              {t('deviceLink.countdown', { time: formatCountdown(Math.max(0, state.expiresAt - now)) })}
            </p>
          </>
        ) : (
          <>
            <p className="qr-caption">{state.kind === 'expired' ? t('deviceLink.expired') : state.message}</p>
            <button className="save-btn" onClick={() => setAttempt((n) => n + 1)}>
              {t('deviceLink.newCode')}
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

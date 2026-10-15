import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { parseDeviceLinkPayload } from '../lib/auth';
import { QrScanStep } from './Qr';

// docs/71 D255 — the new device's side of QR device linking: scan the code
// a signed-in device shows (DeviceLinkScreen), then hand it to
// AuthVerifyScreen, which claims it and runs the usual "whose device is
// this?" picker and merge (docs/48 D177) — scanning still doesn't say
// whose device this is.
export function ScanDeviceLinkScreen() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  // Remounts the scanner for another try — QrScanStep handles one decode.
  const [attempt, setAttempt] = useState(0);

  return (
    <main className="home">
      <div className="app-bar">
        <Link to="/settings" className="back-link">← Back</Link>
        <span className="wordmark">Scan a code</span>
        <span style={{ width: '3rem' }} />
      </div>

      {error ? (
        <div className="qr-stage">
          <p className="qr-caption">{error}</p>
          <button
            className="save-btn"
            onClick={() => {
              setError(null);
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </button>
        </div>
      ) : (
        <QrScanStep
          key={attempt}
          caption="On a device that's already signed in, open Settings → Household → Add a device, then point the camera at the code."
          onResult={(text) => {
            const token = parseDeviceLinkPayload(text);
            if (!token) {
              setError("That isn't a Flowtab sign-in code. Use the one from Household → Add a device.");
              return;
            }
            navigate('/auth/verify', { replace: true, state: { deviceLink: token } });
          }}
        />
      )}
    </main>
  );
}

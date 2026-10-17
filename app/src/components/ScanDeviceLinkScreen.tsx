import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { parseDeviceLinkPayload } from '../lib/auth';
import { QrScanStep } from './Qr';

// docs/71 D255 — the new device's side of QR device linking: scan the code
// a signed-in device shows (DeviceLinkScreen), then hand it to
// AuthVerifyScreen, which claims it and runs the usual "whose device is
// this?" picker and merge (docs/48 D177) — scanning still doesn't say
// whose device this is.
export function ScanDeviceLinkScreen() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  // Remounts the scanner for another try — QrScanStep handles one decode.
  const [attempt, setAttempt] = useState(0);

  return (
    <main className="home">
      <div className="app-bar">
        <Link to="/settings" className="back-link">← {t('common.back')}</Link>
        <span className="wordmark">{t('deviceLink.scanTitle')}</span>
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
            {t('common.tryAgain')}
          </button>
        </div>
      ) : (
        <QrScanStep
          key={attempt}
          caption={t('deviceLink.scanCaption')}
          onResult={(text) => {
            const token = parseDeviceLinkPayload(text);
            if (!token) {
              setError(t('deviceLink.notACode'));
              return;
            }
            navigate('/auth/verify', { replace: true, state: { deviceLink: token } });
          }}
        />
      )}
    </main>
  );
}

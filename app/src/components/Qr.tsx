import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import QrScanner from 'qr-scanner';

// Shared by docs/25's P2P pairing (PairingScreen) and docs/71's QR device
// linking (DeviceLinkScreen, ScanDeviceLinkScreen).

// docs/25 D132: level L (not M) at a larger render size — a real device
// test found M too dense to scan quickly on weaker hardware. Shared by
// the QR pairing flow and the relay's "show code" screen (docs/28) —
// same rendering either way, just a much shorter payload for the code.
export function QrCanvas({ payload }: { payload: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    void QRCode.toCanvas(canvasRef.current, payload, { errorCorrectionLevel: 'L', width: 280 });
  }, [payload]);

  return <canvas ref={canvasRef} className="qr-canvas" />;
}

export function QrScanStep({ caption, onResult }: { caption: string; onResult: (text: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // A fresh <video> element per effect run, created imperatively rather
    // than a persistent JSX-bound ref — found necessary, not stylistic.
    // React StrictMode's dev-mode double-invoke (mount -> cleanup ->
    // mount, on every mount, not just the first) creates two QrScanner
    // instances in immediate succession; if they shared one <video>
    // element (the original design), the second instance's camera
    // stream never attached at all, even though neither start() call
    // threw — confirmed by directly reproducing the exact sequence
    // outside of React, isolated from this component. Giving each
    // instance a DOM node no other instance has ever touched removes
    // the possibility of that contention entirely, regardless of timing.
    const video = document.createElement('video');
    video.className = 'camera-video';
    containerRef.current.appendChild(video);

    // A real bug, found on real hardware: qr-scanner's decode callback
    // fires on every frame that successfully reads the code, not once —
    // holding the phone steady for even a fraction of a second after a
    // good scan fires it several times. Each call ran the full
    // completeOffer/answerOffer flow again, and since the underlying
    // RTCPeerConnection can only accept setRemoteDescription once per
    // signaling-state transition, every call after the first threw —
    // caught and shown as "Connection dropped before syncing finished,"
    // even though the first call may have already succeeded. `handled`
    // makes the first decode the only one that counts; pausing the
    // scanner immediately also stops the wasted decode cycles instead of
    // just ignoring their output.
    let handled = false;
    const scanner = new QrScanner(
      video,
      (result) => {
        if (handled) return;
        handled = true;
        void scanner.pause(true);
        onResultRef.current(result.data);
      },
      { highlightScanRegion: true, highlightCodeOutline: true },
    );
    scanner.start().catch(() => setError('Camera access is needed to scan a code.'));

    return () => {
      // qr-scanner's plain stop()/destroy() defer the actual camera-track
      // release by 300ms internally (presumably to avoid flicker on quick
      // pause/resume) — fine for a single stable mount, but a fast
      // remount (a failed scan's retry, or the StrictMode double-invoke
      // above) can start a brand-new getUserMedia() request before the
      // old stream is actually released — camera contention, the
      // still-lit recording indicator the user reported. pause(true)
      // forces the release synchronously instead of waiting out that
      // grace period. Confirmed directly: track.readyState reads
      // "ended" immediately after pause(true), vs. still "live" at the
      // same point with plain stop().
      void scanner.pause(true);
      scanner.destroy();
      video.remove();
    };
  }, []);

  return (
    <div className="camera-view" ref={containerRef}>
      <p className="camera-caption">{error ?? caption}</p>
    </div>
  );
}

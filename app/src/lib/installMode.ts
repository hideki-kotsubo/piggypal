// docs/56 D201 — which "install Flowtab" affordance Settings should offer,
// kept pure (no window/Capacitor access) so it's testable under vitest's
// plain Node environment; installPrompt.ts gathers the real inputs.

export type InstallMode =
  // Already running as an installed app (home-screen PWA or native shell).
  | 'installed'
  // Chromium handed us a beforeinstallprompt event — we can show its dialog.
  | 'prompt'
  // iOS has no install API at all; the only path is Share → Add to Home Screen.
  | 'ios-instructions'
  // Anything else (Firefox desktop, prompt already used/dismissed, …).
  | 'unavailable';

export function resolveInstallMode(input: { installed: boolean; canPrompt: boolean; ios: boolean }): InstallMode {
  if (input.installed) return 'installed';
  if (input.canPrompt) return 'prompt';
  if (input.ios) return 'ios-instructions';
  return 'unavailable';
}

// iPadOS 13+ reports a desktop Mac user agent by default, so a Mac UA with
// multi-touch is treated as an iPad (no real Mac has maxTouchPoints > 1).
export function isIosUserAgent(userAgent: string, maxTouchPoints: number): boolean {
  if (/iPad|iPhone|iPod/.test(userAgent)) return true;
  return /Macintosh/.test(userAgent) && maxTouchPoints > 1;
}

import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { isIosUserAgent, resolveInstallMode, type InstallMode } from './installMode';

// docs/56 D201 — Chromium fires beforeinstallprompt once, often before
// React has mounted anything, so it's captured here at module load
// (main.tsx imports this file for its side effect) and held until
// Settings' "Install Flowtab" row asks for it. Not in lib.dom.d.ts —
// Chromium-only, hence the local type.
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installedThisSession = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

window.addEventListener('beforeinstallprompt', (e) => {
  // Suppresses Chrome's own mini-infobar — the Settings row is the
  // app's one install affordance, not a nag on first visit.
  e.preventDefault();
  deferredPrompt = e as BeforeInstallPromptEvent;
  notify();
});

window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  installedThisSession = true;
  notify();
});

export function isIosDevice(): boolean {
  return isIosUserAgent(navigator.userAgent, navigator.maxTouchPoints ?? 0);
}

// True when this page *is* the installed app: a home-screen PWA
// (display-mode: standalone, or iOS's own legacy navigator.standalone)
// or the native Capacitor shell.
export function isRunningInstalled(): boolean {
  return (
    Capacitor.isNativePlatform() ||
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function currentMode(): InstallMode {
  return resolveInstallMode({
    installed: installedThisSession || isRunningInstalled(),
    canPrompt: deferredPrompt !== null,
    ios: isIosDevice(),
  });
}

export function useInstallPrompt(): { mode: InstallMode; install: () => Promise<void> } {
  const [mode, setMode] = useState<InstallMode>(currentMode);

  useEffect(() => {
    const update = () => setMode(currentMode());
    listeners.add(update);
    // The event can land between first render and this effect.
    update();
    return () => {
      listeners.delete(update);
    };
  }, []);

  async function install() {
    const event = deferredPrompt;
    if (!event) return;
    // A BeforeInstallPromptEvent can only be prompted once, accepted or not.
    deferredPrompt = null;
    await event.prompt();
    await event.userChoice;
    notify();
  }

  return { mode, install };
}

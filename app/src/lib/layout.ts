import { useSyncExternalStore } from 'react';

// docs/80 P1 — which layout the window gets. Decided by the window's own
// size, never the device: desktop windows resize live, and a later iPad
// build gets Split View. Below 600px wide is today's phone app, untouched.
// A short window is compact too (D317): a phone browser in landscape is
// ~850×390 and must keep the phone layout, since a web page can't lock
// its orientation the way the native apps do.
export type WidthClass = 'compact' | 'medium' | 'expanded';

export const MEDIUM_MIN_WIDTH = 600;
export const EXPANDED_MIN_WIDTH = 1024;
export const WIDE_MIN_HEIGHT = 480;

export function classify(width: number, height: number): WidthClass {
  if (width < MEDIUM_MIN_WIDTH || height < WIDE_MIN_HEIGHT) return 'compact';
  return width < EXPANDED_MIN_WIDTH ? 'medium' : 'expanded';
}

function subscribe(onChange: () => void) {
  window.addEventListener('resize', onChange);
  return () => window.removeEventListener('resize', onChange);
}

function snapshot(): WidthClass {
  return classify(window.innerWidth, window.innerHeight);
}

// A string snapshot, so React only re-renders when the class itself
// changes, not on every resize event.
export function useWidthClass(): WidthClass {
  return useSyncExternalStore(subscribe, snapshot, () => 'compact');
}

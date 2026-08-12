import { useState } from 'react';

export type AccountPickerMode = 'grouped' | 'capped';

// docs/13 D65 — below this many accounts, the picker is just a flat chip
// row regardless of the Grouped/Capped setting; the setting itself only
// shows in Settings once the user is actually above it (D69).
export const ACCOUNT_PICKER_SCALE_THRESHOLD = 6;

const ACCOUNT_PICKER_MODE_KEY = 'piggypal:account-picker-mode';

function readAccountPickerMode(): AccountPickerMode {
  return localStorage.getItem(ACCOUNT_PICKER_MODE_KEY) === 'capped' ? 'capped' : 'grouped'; // D66 default: grouped
}

// Local-device-only preferences — never synced, same "pure client concern"
// reasoning as docs/09 (UI language) and docs/10 D39 (primary currency).
// Plain localStorage rather than the PowerSync/SQLite layer: this never
// needs to leave the device, so it sits outside the synced-data schema
// entirely (docs/13 D66).
export function useAccountPickerMode(): [AccountPickerMode, (mode: AccountPickerMode) => void] {
  const [mode, setModeState] = useState<AccountPickerMode>(readAccountPickerMode);
  function setMode(next: AccountPickerMode) {
    localStorage.setItem(ACCOUNT_PICKER_MODE_KEY, next);
    setModeState(next);
  }
  return [mode, setMode];
}

export type ThemeMode = 'system' | 'light' | 'dark';

const THEME_MODE_KEY = 'piggypal:theme-mode';

function readThemeMode(): ThemeMode {
  const stored = localStorage.getItem(THEME_MODE_KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

// tokens.css keys dark/light overrides off this attribute (guarding the
// existing prefers-color-scheme block with :not([data-theme="light"])).
// 'system' means "no override" — remove the attribute so the media query
// alone decides.
function applyThemeMode(mode: ThemeMode) {
  if (mode === 'system') {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = mode;
  }
}

// Runs on import, before first paint, so the stored preference applies
// immediately rather than flashing system-default and then switching once
// SettingsScreen mounts — main.tsx imports this module for its side effect.
applyThemeMode(readThemeMode());

export function useThemeMode(): [ThemeMode, (mode: ThemeMode) => void] {
  const [mode, setModeState] = useState<ThemeMode>(readThemeMode);
  function setMode(next: ThemeMode) {
    localStorage.setItem(THEME_MODE_KEY, next);
    applyThemeMode(next);
    setModeState(next);
  }
  return [mode, setMode];
}

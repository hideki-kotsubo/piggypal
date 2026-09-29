import { describe, expect, it } from 'vitest';
import { isIosUserAgent, resolveInstallMode } from './installMode';

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';

describe('isIosUserAgent', () => {
  it('detects iPhone', () => {
    expect(isIosUserAgent(IPHONE_UA, 5)).toBe(true);
  });
  it('detects iPadOS posing as a Mac via touch points', () => {
    expect(isIosUserAgent(IPAD_DESKTOP_UA, 5)).toBe(true);
  });
  it('does not flag a real Mac', () => {
    expect(isIosUserAgent(IPAD_DESKTOP_UA, 0)).toBe(false);
  });
  it('does not flag Android', () => {
    expect(isIosUserAgent(ANDROID_UA, 5)).toBe(false);
  });
});

describe('resolveInstallMode', () => {
  it('installed wins over everything', () => {
    expect(resolveInstallMode({ installed: true, canPrompt: true, ios: true })).toBe('installed');
  });
  it('prefers the native prompt when one is available', () => {
    expect(resolveInstallMode({ installed: false, canPrompt: true, ios: false })).toBe('prompt');
  });
  it('falls back to manual instructions on iOS', () => {
    expect(resolveInstallMode({ installed: false, canPrompt: false, ios: true })).toBe('ios-instructions');
  });
  it('is unavailable otherwise', () => {
    expect(resolveInstallMode({ installed: false, canPrompt: false, ios: false })).toBe('unavailable');
  });
});

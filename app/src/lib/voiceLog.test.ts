import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearVoiceLog, formatVoiceLog, readVoiceLog, startVoiceLog } from './voiceLog';

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  });
});

describe('voice log', () => {
  it('records a session as soon as it starts, then each event', () => {
    const log = startVoiceLog('web', 'ja-JP');
    expect(readVoiceLog()).toEqual([expect.objectContaining({ lang: 'ja-JP', events: [] })]);
    log('audiostart');
    log('timeout');
    expect(readVoiceLog()[0].events.map((e) => e.split(' ')[0])).toEqual(['audiostart', 'timeout']);
  });

  it('keeps only the newest ten sessions, newest first', () => {
    for (let i = 0; i < 12; i++) startVoiceLog('web', `l${i}`);
    const log = readVoiceLog();
    expect(log).toHaveLength(10);
    expect(log[0].lang).toBe('l11');
  });

  it('formats one line per session and clears', () => {
    startVoiceLog('native', 'es-MX')('end');
    expect(formatVoiceLog(readVoiceLog())).toMatch(/native es-MX: end \d+\.\ds$/);
    clearVoiceLog();
    expect(readVoiceLog()).toEqual([]);
  });

  it('works without storage', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(() => startVoiceLog('web', 'en-US')('end')).not.toThrow();
    expect(readVoiceLog()).toEqual([]);
  });
});

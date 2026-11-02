// The last few voice sessions, kept on this device only and shown in
// About, so a voice entry that hangs on a real phone can be read back
// instead of guessed at (2026-11-01: Japanese on iPhone timed out 5+
// times, then worked, with nothing to tell why). Records what the
// recognizer reported and when — never what was said.

export interface VoiceLogEntry {
  at: string; // ISO time the session started
  engine: 'web' | 'native';
  lang: string;
  events: string[]; // "speechstart 1.2s"
}

const KEY = 'flowtab:voice-log';
const MAX_ENTRIES = 10;
const MAX_EVENTS = 30;

export function readVoiceLog(): VoiceLogEntry[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed as VoiceLogEntry[]) : [];
  } catch {
    return [];
  }
}

function save(log: VoiceLogEntry[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(log));
  } catch {
    // No storage — the log is a convenience, voice works without it.
  }
}

export function clearVoiceLog() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}

// Starts an entry right away, so a session that never answers is still
// on record, and returns a function that appends one event to it.
export function startVoiceLog(engine: VoiceLogEntry['engine'], lang: string): (event: string) => void {
  const started = Date.now();
  const entry: VoiceLogEntry = { at: new Date(started).toISOString(), engine, lang, events: [] };
  save([entry, ...readVoiceLog()].slice(0, MAX_ENTRIES));
  return (event) => {
    if (entry.events.length >= MAX_EVENTS) return;
    entry.events.push(`${event} ${((Date.now() - started) / 1000).toFixed(1)}s`);
    // Rewritten by its start time: other sessions may have been saved since.
    save(readVoiceLog().map((e) => (e.at === entry.at && e.lang === entry.lang ? entry : e)));
  };
}

export function formatVoiceLog(log: VoiceLogEntry[]): string {
  return log.map((e) => `${e.at} ${e.engine} ${e.lang}: ${e.events.join(' · ') || '(no events)'}`).join('\n');
}

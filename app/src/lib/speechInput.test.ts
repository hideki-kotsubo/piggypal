import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A stand-in for the browser's SpeechRecognition. `script` decides what
// each start() does; `instances` counts constructions, which is how the
// tests see whether a session reused the shared instance or got a fresh one.
type Script = (r: FakeRecognition) => void;
let script: Script = () => {};
const instances: FakeRecognition[] = [];

class FakeRecognition {
  lang = '';
  interimResults = false;
  maxAlternatives = 1;
  onresult: ((event: { results: { 0: { transcript: string } }[] }) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  aborted = 0;
  constructor() {
    instances.push(this);
  }
  start() {
    script(this);
  }
  stop() {}
  abort() {
    this.aborted++;
    this.onerror?.({ error: 'aborted' });
    this.onend?.();
  }
  say(text: string) {
    this.onresult?.({ results: [{ 0: { transcript: text } }] });
    this.onend?.();
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  instances.length = 0;
  vi.stubGlobal('window', { SpeechRecognition: FakeRecognition });
  vi.stubGlobal('navigator', { language: 'pt-BR', languages: ['pt-BR'] });
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function load() {
  return import('./speechInput');
}

function handlers() {
  return { onResult: vi.fn(), onError: vi.fn(), onEnd: vi.fn() };
}

describe('web speech sessions', () => {
  it('reuses the instance after a successful session (docs/16 D149)', async () => {
    const { startSpeechInput } = await load();
    script = (r) => r.say('30 reais em mercado');
    const first = handlers();
    startSpeechInput(first);
    expect(first.onResult).toHaveBeenCalledWith('30 reais em mercado');
    expect(first.onEnd).toHaveBeenCalledTimes(1);
    startSpeechInput(handlers());
    expect(instances).toHaveLength(1);
  });

  it('reports "no-speech" and starts fresh after a session that heard nothing', async () => {
    const { startSpeechInput } = await load();
    script = (r) => r.onend?.();
    const silent = handlers();
    startSpeechInput(silent);
    expect(silent.onError).toHaveBeenCalledWith('no-speech');
    expect(silent.onEnd).toHaveBeenCalledTimes(1);

    script = (r) => r.say('40 dólares em gasolina');
    const next = handlers();
    startSpeechInput(next);
    expect(instances).toHaveLength(2);
    expect(next.onResult).toHaveBeenCalledWith('40 dólares em gasolina');
  });

  it('gives up on an instance that never answers (the iPhone freeze)', async () => {
    const { startSpeechInput } = await load();
    script = () => {}; // started, then silence: no result, no error, no end
    const stuck = handlers();
    startSpeechInput(stuck);
    expect(stuck.onEnd).not.toHaveBeenCalled();
    vi.advanceTimersByTime(15_000);
    expect(stuck.onError).toHaveBeenCalledWith('no-speech');
    expect(stuck.onEnd).toHaveBeenCalledTimes(1);
    expect(instances[0].aborted).toBe(1);

    script = (r) => r.say('ok');
    startSpeechInput(handlers());
    expect(instances).toHaveLength(2);
  });

  it('keeps the instance when the user cancels, and stays quiet about it', async () => {
    const { startSpeechInput } = await load();
    script = () => {};
    const h = handlers();
    const session = startSpeechInput(h)!;
    session.abort();
    expect(h.onError).toHaveBeenCalledWith('aborted');
    expect(h.onEnd).toHaveBeenCalledTimes(1);
    startSpeechInput(handlers());
    expect(instances).toHaveLength(1);
  });

  it('ignores late events from a discarded instance', async () => {
    const { startSpeechInput } = await load();
    script = (r) => r.onerror?.({ error: 'network' });
    const h = handlers();
    startSpeechInput(h);
    instances[0].onend?.(); // the browser's own end event, after the error
    instances[0].onresult?.({ results: [{ 0: { transcript: 'late' } }] });
    expect(h.onError).toHaveBeenCalledTimes(1);
    expect(h.onEnd).toHaveBeenCalledTimes(1);
    expect(h.onResult).not.toHaveBeenCalled();
  });

  it('listens in the voice language', async () => {
    const { startSpeechInput } = await load();
    script = (r) => r.say('x');
    startSpeechInput(handlers());
    expect(instances[0].lang).toBe('pt-BR');
  });
});

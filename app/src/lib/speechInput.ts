// docs/16 — a thin wrapper around the browser's built-in speech-to-text
// (Web Speech API), used purely to fill EntryZone's existing typed-text
// field. Voice never gets a separate parse path: whatever lands in the
// text field goes through the same Tier 1 parser (parser.ts) typed input
// already does.
//
// Not declared in every TS lib.dom target and never prefixed consistently
// across browsers, so this hand-rolls the handful of members actually
// used rather than depending on ambient ones being present.
//
// Worth knowing, not a blocker: despite costing nothing on our side,
// most browsers' built-in recognizer still round-trips through the
// browser vendor's own cloud service — this isn't genuinely offline
// speech-to-text, just free of *our* AI cost. A fully offline in-browser
// model is a much bigger undertaking, out of scope here.

interface SpeechRecognitionResultLike {
  0: { transcript: string };
}
interface SpeechRecognitionEventLike {
  results: SpeechRecognitionResultLike[];
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isSpeechInputSupported(): boolean {
  return typeof window !== 'undefined' && getSpeechRecognitionCtor() !== null;
}

export interface SpeechInputHandlers {
  onResult: (transcript: string) => void;
  onError?: (error: string) => void;
  onEnd?: () => void;
}

// No language toggle exists yet (docs/09 is spec-only) — navigator.language
// is a best-effort default, genuinely imperfect if the OS locale doesn't
// match what the user actually speaks. Revisit once docs/09 ships.
export function startSpeechInput(handlers: SpeechInputHandlers): { stop: () => void; abort: () => void } | null {
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) return null;

  const recognition = new Ctor();
  recognition.lang = navigator.language;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.onresult = (event) => {
    // continuous is unset (false), which per spec should auto-stop the
    // mic once a final result comes in — but several real implementations
    // (notably Android Chrome) don't honor that and keep the mic open
    // indefinitely, waiting for an explicit stop(). Calling it here
    // ourselves is what actually turns the mic off; the browser doing it
    // too is harmless (stop() on an already-stopping session is a no-op).
    recognition.stop();
    const transcript = event.results[0]?.[0]?.transcript ?? '';
    handlers.onResult(transcript);
  };
  recognition.onerror = (event) => handlers.onError?.(event.error);
  recognition.onend = () => handlers.onEnd?.();
  recognition.start();

  return {
    stop: () => recognition.stop(),
    // For the user bailing out mid-recording: abort() cuts the mic
    // immediately and discards whatever's been captured so far, unlike
    // stop() which still tries to deliver a final (possibly garbled,
    // half-spoken) result via onresult.
    abort: () => recognition.abort(),
  };
}

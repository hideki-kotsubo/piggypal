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

// One recognition object, reused for the life of the page rather than
// constructed fresh per tap. Chrome ties the mic grant to the origin, so
// this wouldn't matter there — but Safari (notably iOS) doesn't reliably
// do that for SpeechRecognition specifically (unlike its getUserMedia
// grant, which *is* remembered per-origin): in practice the permission
// behaves as if it's scoped to the recognition instance, so a fresh
// instance each tap looks like a never-before-seen consumer and gets
// re-prompted every time. Reusing one instance is the standard mitigation.
let sharedRecognition: SpeechRecognitionLike | null = null;

function configuredRecognition(handlers: SpeechInputHandlers): SpeechRecognitionLike | null {
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) return null;
  const recognition = sharedRecognition ?? new Ctor();
  // No language toggle exists yet (docs/09 is spec-only) — navigator.language
  // is a best-effort default, genuinely imperfect if the OS locale doesn't
  // match what the user actually speaks. Revisit once docs/09 ships.
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
  return recognition;
}

export function startSpeechInput(handlers: SpeechInputHandlers): { stop: () => void; abort: () => void } | null {
  let recognition = configuredRecognition(handlers);
  if (!recognition) return null;
  try {
    recognition.start();
  } catch {
    // Reusing one instance (above) is what stops the repeat mic prompt,
    // but it means a fast abort-then-restart can race ahead of the
    // previous session's `end` event, which throws InvalidStateError on
    // an instance that thinks it's still active. Discard and retry on a
    // fresh instance rather than leaving the tap dead.
    sharedRecognition = null;
    recognition = configuredRecognition(handlers);
    if (!recognition) return null;
    recognition.start();
  }
  sharedRecognition = recognition;

  return {
    stop: () => recognition!.stop(),
    // For the user bailing out mid-recording: abort() cuts the mic
    // immediately and discards whatever's been captured so far, unlike
    // stop() which still tries to deliver a final (possibly garbled,
    // half-spoken) result via onresult.
    abort: () => recognition!.abort(),
  };
}

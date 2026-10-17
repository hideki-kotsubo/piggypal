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
//
// docs/73 D269: the Android app uses the native recognizer instead
// (@capacitor-community/speech-recognition), since Android's WebView has
// no Web Speech. The iOS app keeps WebKit's (the plugin can't join its
// Swift Package Manager project, see capacitor.config.ts). Both paths
// listen in the Voice language setting's language (voiceLanguage.ts) and
// report errors with the Web Speech API's codes.

import { Capacitor } from '@capacitor/core';
import { SpeechRecognition as NativeSpeech } from '@capacitor-community/speech-recognition';
import { currentSpeechTag } from './voiceLanguage';

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

const isNativeSpeech = () => Capacitor.getPlatform() === 'android';

export function isSpeechInputSupported(): boolean {
  return typeof window !== 'undefined' && (isNativeSpeech() || getSpeechRecognitionCtor() !== null);
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

function configuredRecognition(): SpeechRecognitionLike | null {
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) return null;
  const recognition = sharedRecognition ?? new Ctor();
  recognition.lang = currentSpeechTag();
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  return recognition;
}

// Real iPhone report (2026-10-16, home-screen PWA, XR and 12): after a
// session that heard nothing, every later tap on the reused instance
// started "listening" and never answered — no result, no error, no end.
// So the reuse above only lasts while sessions succeed: a session that
// ends without a result (nothing heard, an error, or the watchdog below)
// throws its instance away, and the next tap starts a fresh one. A fresh
// instance can mean one more permission prompt on iOS, which beats a
// dead mic button. A cancel the user tapped keeps the instance.
const SESSION_TIMEOUT_MS = 15_000;

// docs/16 D161 tried priming with a getUserMedia call before ever
// touching SpeechRecognition, on the theory that its grant persists per-
// origin on Safari where SpeechRecognition's own doesn't (D149's
// diagnosis) — tested on a real iPhone (PWA build) 2026-08-19: the
// prompt still appeared on every app open. Reverted rather than keep the
// added async plumbing for a mitigation confirmed not to work; see
// docs/16 for the full note and what's now believed to actually be going
// on (likely a broader iOS standalone-PWA permission-persistence
// limitation, not something either reuse-the-instance or prime-with-
// getUserMedia can fix from the web side).

// The plugin's Android error texts (its SpeechRecognition.java), mapped
// onto the Web Speech API's error codes so callers handle one set.
function nativeErrorCode(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/permission/i.test(message)) return 'not-allowed';
  if (/network|server/i.test(message)) return 'network';
  if (/no match|no speech/i.test(message)) return 'no-speech';
  if (/not available/i.test(message)) return 'service-not-allowed';
  return 'unknown';
}

function startNativeSpeech(handlers: SpeechInputHandlers): { stop: () => void; abort: () => void } {
  let aborted = false;
  void (async () => {
    try {
      let permission = (await NativeSpeech.checkPermissions()).speechRecognition;
      if (permission !== 'granted') permission = (await NativeSpeech.requestPermissions()).speechRecognition;
      if (permission !== 'granted') {
        handlers.onError?.('not-allowed');
        return;
      }
      const { matches } = await NativeSpeech.start({
        language: currentSpeechTag(),
        maxResults: 1,
        partialResults: false,
        popup: false,
      });
      if (aborted) return;
      if (matches?.[0]) handlers.onResult(matches[0]);
      else handlers.onError?.('no-speech');
    } catch (err) {
      if (!aborted) handlers.onError?.(nativeErrorCode(err));
    } finally {
      handlers.onEnd?.();
    }
  })();
  return {
    stop: () => void NativeSpeech.stop(),
    abort: () => {
      aborted = true;
      void NativeSpeech.stop();
    },
  };
}

export function startSpeechInput(handlers: SpeechInputHandlers): { stop: () => void; abort: () => void } | null {
  if (isNativeSpeech()) return startNativeSpeech(handlers);
  return startWebSpeech(handlers);
}

function startWebSpeech(handlers: SpeechInputHandlers): { stop: () => void; abort: () => void } | null {
  let recognition = configuredRecognition();
  if (!recognition) return null;

  // One session per tap. Handlers on a reused instance are replaced by the
  // next session's, and `settled` stops a discarded instance's late
  // events from reaching the caller twice.
  let settled = false;
  let gotResult = false;
  let userAborted = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const finish = (error: string | null) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (error) {
      if (!(error === 'aborted' && userAborted) && sharedRecognition === recognition) sharedRecognition = null;
      handlers.onError?.(error);
    }
    handlers.onEnd?.();
  };
  const attach = (r: SpeechRecognitionLike) => {
    r.onresult = (event) => {
      if (settled) return;
      gotResult = true;
      // continuous is unset (false), which per spec should auto-stop the
      // mic once a final result comes in — but several real
      // implementations (notably Android Chrome) don't honor that and
      // keep the mic open indefinitely, waiting for an explicit stop().
      // Calling it here ourselves is what actually turns the mic off.
      r.stop();
      handlers.onResult(event.results[0]?.[0]?.transcript ?? '');
      finish(null);
    };
    r.onerror = (event) => finish(event.error);
    r.onend = () => finish(gotResult ? null : userAborted ? 'aborted' : 'no-speech');
  };

  attach(recognition);
  // Shared before start(): a session can end inside start() itself, and
  // finish() only discards the instance it finds here.
  sharedRecognition = recognition;
  try {
    recognition.start();
  } catch {
    // Reusing one instance is what stops the repeat mic prompt, but a
    // fast abort-then-restart can race ahead of the previous session's
    // `end` event, which throws InvalidStateError on an instance that
    // thinks it's still active. Discard and retry on a fresh instance
    // rather than leaving the tap dead.
    sharedRecognition = null;
    recognition = configuredRecognition();
    if (!recognition) return null;
    attach(recognition);
    sharedRecognition = recognition;
    recognition.start();
  }
  const session = recognition;
  if (!settled) {
    timer = setTimeout(() => {
      if (settled) return;
      // Report first: the abort below fires its own "aborted" event,
      // which must not pass for a cancel the user tapped.
      finish('no-speech');
      if (sharedRecognition === session) sharedRecognition = null;
      try {
        session.abort();
      } catch {
        // Already dead — the point is to stop waiting on it.
      }
    }, SESSION_TIMEOUT_MS);
  }

  return {
    stop: () => session.stop(),
    // For the user bailing out mid-recording: abort() cuts the mic
    // immediately and discards whatever's been captured so far, unlike
    // stop() which still tries to deliver a final (possibly garbled,
    // half-spoken) result via onresult.
    abort: () => {
      userAborted = true;
      session.abort();
    },
  };
}

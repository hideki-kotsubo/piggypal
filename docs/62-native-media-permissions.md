# 62 — Mic and camera in the native apps; the iOS PWA mic prompt

Investigated 2026-10-09 from the backlog bug "mic permission prompt still
appears on every app open" (reported 2026-08-19; docs/16 D149 and D161
both failed to fix it on a real iPhone).

## Findings

**The iOS home-screen PWA prompt is a platform limitation.** WebKit has a
long record of installed web apps not keeping camera/mic grants across
backgrounding and relaunch ([WebKit 233315](https://bugs.webkit.org/show_bug.cgi?id=233315),
[233629](https://bugs.webkit.org/show_bug.cgi?id=233629),
[236509](https://bugs.webkit.org/show_bug.cgi?id=236509)). WebKit's answer
is that the *embedding app* decides permissions through `WKUIDelegate`; a
home-screen web app has no embedding app of its own, so nothing in the web
code can make iOS remember the grant. That's consistent with D149 (reuse
one recognition instance) and D161 (prime with `getUserMedia`) failing
the same way.

**The native iOS app avoids it, but wasn't configured for it.**
Capacitor's `WebViewDelegationHandler.swift` already answers WebKit's
media requests with `decisionHandler(.grant)`, so after the one-time iOS
permission the web view never prompts again. But `Info.plist` had no
usage descriptions, and WebKit refuses speech recognition in an embedding
app without `NSSpeechRecognitionUsageDescription`
(`service-not-allowed`, [WebKit 239816](https://bugs.webkit.org/show_bug.cgi?id=239816)).
Mic and camera need `NSMicrophoneUsageDescription` and
`NSCameraUsageDescription` the same way. So voice entry and QR pairing
would not have worked in the iOS app, and App Review rejects apps that
use these without the strings.

**Android had no media permissions.** `AndroidManifest.xml` declared only
`INTERNET`. Capacitor's `BridgeWebChromeClient` asks at runtime for
`CAMERA`, `RECORD_AUDIO` and `MODIFY_AUDIO_SETTINGS` when the web view
wants them, and Android only allows asking for declared permissions.
Whether Android System WebView actually supports `webkitSpeechRecognition`
is unverified: MDN's compat data marks WebView as mirroring Chrome, but
that's derived rather than tested, and developer reports are mixed.

## What changed

| # | Decision | Why |
|---|---|---|
| D234 | iOS `Info.plist` declares `NSMicrophoneUsageDescription`, `NSSpeechRecognitionUsageDescription` and `NSCameraUsageDescription`, in plain user-facing English | Required for voice entry and QR pairing in the iOS app, and for App Review |
| D235 | Android declares `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS` and `CAMERA`, with camera and microphone hardware marked `required="false"` | What Capacitor's WebView asks for at runtime; devices without them can still install and type |
| D236 | The iOS PWA re-prompt is accepted as a platform limitation, not fixed in web code; the native iOS app is the fix | Two web-side mitigations already failed; WebKit puts permission persistence in the embedding app |

## Not verified

Nothing native can be built here (no Xcode or Android SDK). On a device:

- iOS app: the three permission prompts appear once, with the strings
  above; voice entry works; it doesn't prompt again on the next launch;
  QR pairing scans.
- Android app: mic and camera prompts appear; QR pairing scans; voice
  entry works. If speech fails in the WebView, the fallback is a native
  plugin (e.g. `@capacitor-community/speech-recognition`), a separate
  piece of work.

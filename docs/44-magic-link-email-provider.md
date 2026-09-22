# 44 — Magic-Link Email Provider: ACS → Resend → SMTP2GO

## What this closes

docs/41's own flagged followup, "real Azure Communication Services
sending" — and then immediately reopens/revises docs/05 D15's provider
choice itself, both in one session, at the user's explicit request.

## What happened, in order

1. **Real ACS send implemented.** `api/src/auth/email.ts`'s
   `sendMagicLinkEmail` — previously a placeholder that threw once a
   connection string was set — got a real `@azure/communication-email`
   `EmailClient.beginSend()` call, gated behind
   `AZURE_COMMUNICATION_CONNECTION_STRING` (unset → still logs the link,
   same fallback as before, so this was safe to ship immediately without
   an ACS account existing yet). Walked the user through the actual Azure
   Portal steps (create the Communication Services resource, get a
   sending domain — Azure-managed for a fast start or a custom domain
   with SPF/DKIM records — connect it, copy the connection string) since
   that part is real external account setup this repo can't do
   unattended (docs/39 step 5 already flagged this).
2. **User asked for alternatives** before actually doing that Portal
   setup. Compared Resend, Postmark, SendGrid, and Amazon SES on setup
   friction and free-tier fit for a solo/beta-stage app; recommended
   Resend (lowest setup friction, generous free tier, switching away
   later is exactly as cheap per D15's own adapter-boundary reasoning).
3. **User picked Resend.** Same day: `@azure/communication-email` removed,
   `resend` installed, `sendMagicLinkEmail`'s body rewritten against
   `Resend.emails.send()` — same function signature, same call sites in
   `routes.ts`, zero changes needed anywhere else. This is D15's own
   same-day-swap claim actually exercised for real, not just designed
   for.

## What's implemented (final state)

- **`api/src/auth/email.ts`** — `RESEND_API_KEY` unset → logs the link
  (unchanged fallback behavior from before either provider existed).
  Set → sends via Resend, requires `RESEND_FROM_ADDRESS` too (throws a
  clear config error if the key is set but the sender isn't — same
  "don't invent a silent default" reasoning as docs/41's own deviceId
  requirement). A rejected send (`{ error }` in Resend's response shape,
  rather than a thrown exception) is turned into a real thrown error, not
  swallowed — so a misconfigured sender/domain surfaces as a 500 during
  setup instead of `request-link` returning 200 while nothing was
  actually sent.
- **`api/.env.example`** — `AZURE_COMMUNICATION_CONNECTION_STRING`/
  `AZURE_COMMUNICATION_FROM_ADDRESS` replaced with `RESEND_API_KEY`/
  `RESEND_FROM_ADDRESS`, including Resend's own onboarding-domain note
  (`onboarding@resend.dev` works immediately with no DNS setup, for
  testing before a custom domain is verified).
- **docs/05's D15 row** — revised in place (not silently rewritten):
  records both the original ACS choice and the same-day Resend swap,
  and why.

## Verified

Both providers' fallback path (unset API key → console log) was
confirmed live against the running `api/` dev server before and after
the swap — a real `POST /api/auth/request-link` call, checked that the
link still logs correctly and the route still returns `{ ok: true }`.
`tsc --noEmit` clean on `api` after each step (ACS implementation, then
the Resend swap).

**Not verified: an actual real send through either provider.** No real
ACS account was ever created (the Portal walkthrough was given, not
completed) and no real Resend API key exists yet either — this pass
proves the code paths compile and the safe-fallback behavior holds, not
that an email has ever actually left this app. That's the next real step
whenever the user creates a Resend account and sets `RESEND_API_KEY`/
`RESEND_FROM_ADDRESS` on the real `api-beta` host.

## Not in scope, still open

- A real Resend account/API key/verified sending domain — external setup
  only the user can do, same as docs/39 step 5 always said.
- Deploying `RESEND_API_KEY`/`RESEND_FROM_ADDRESS` to the real `api-beta`
  host — this sandbox has no access to that host (docs/39's own
  standing constraint).

**2026-08-22.**

## Revised 2026-09-21: swapped to SMTP2GO

At the user's request, `resend` (npm) removed, `sendMagicLinkEmail`
rewritten against SMTP2GO's HTTP API (`POST
https://api.smtp2go.com/v3/email/send`, plain `fetch`, no new
dependency — chosen over SMTP2GO's SMTP-relay option specifically to
avoid pulling in `nodemailer` for a single call site). Same
adapter-boundary claim proven a second time: no changes to
`routes.ts`'s call site, only `email.ts`'s body and the two env var
names.

- `RESEND_API_KEY`/`RESEND_FROM_ADDRESS` → `SMTP2GO_API_KEY`/
  `SMTP2GO_FROM_ADDRESS` across `api/.env.example`, `deploy/.env.example`,
  `deploy/docker-compose.yaml`, and `deploy/README.md`. Unset-key →
  logs-the-link fallback is unchanged.
- SMTP2GO's send response is HTTP 200 with a `data.error` field (or
  `data.failed > 0`) on a rejected send, not a non-2xx status or a
  Resend-style `{ error }` object — `sendMagicLinkEmail` checks
  `result.data?.error`/`succeeded` explicitly and throws, same
  don't-swallow-a-failed-send reasoning as the Resend/ACS versions.
- One real difference from Resend worth flagging: SMTP2GO has no
  zero-setup onboarding sender like `onboarding@resend.dev` — a verified
  sender/domain has to exist under smtp2go.com before
  `SMTP2GO_FROM_ADDRESS` will work, even for a first test send.
- docs/45's click-tracking lesson (Resend's Amazon SES routing
  auto-consumed the single-use magic-link token) isn't SMTP2GO-specific,
  but the same hazard applies to any provider with link/click tracking on
  by default — worth checking SMTP2GO's dashboard settings for this
  address once a real send is attempted, not yet verified either way.

**Not verified: an actual real send through SMTP2GO.** No real
`SMTP2GO_API_KEY` exists in this session — `api/.env`'s key was left
blank (same safe fallback as before), so only the logs-the-link path has
been exercised. Next real step is the user creating a SMTP2GO account,
verifying a sender/domain, and setting `SMTP2GO_API_KEY`/
`SMTP2GO_FROM_ADDRESS` for real (locally in `api/.env`, and eventually on
the real `api-beta` host per docs/39).

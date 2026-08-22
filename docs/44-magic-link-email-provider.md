# 44 — Magic-Link Email Provider: ACS Implemented, Then Swapped to Resend

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

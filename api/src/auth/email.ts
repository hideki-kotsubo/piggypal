// docs/05 D15: magic-link email behind a one-function adapter so swapping
// providers later is a same-day change — only this function's body moves,
// nothing about the token/hashing/expiry model above it. Proved out twice:
// 2026-08-22 (Azure Communication Services -> Resend) and 2026-09-21
// (Resend -> SMTP2GO) — no callers changed either time,
// SMTP2GO_API_KEY/SMTP2GO_FROM_ADDRESS just replace the Resend equivalents.
// Until SMTP2GO_API_KEY is set, this logs the link instead of sending real
// email, which is also just what local dev needs anyway (no inbox to
// check, the link is right there in the server log).
//
// SMTP2GO has an SMTP relay too, but the HTTP API needs no extra
// dependency (just fetch, already global) and matches this adapter's
// existing shape closer than pulling in nodemailer would.

import { magicLinkEmail, pinResetCodeEmail, pinResetNoticeEmail, type EmailLanguage } from './emailTemplates.js';

const SMTP2GO_SEND_URL = 'https://api.smtp2go.com/v3/email/send';

interface Smtp2goResponse {
  data?: {
    succeeded?: number;
    failed?: number;
    error?: string;
  };
}

export async function sendMagicLinkEmail(
  email: string,
  verifyUrl: string,
  code: string,
  language: EmailLanguage = 'en',
): Promise<void> {
  // Copy and HTML-safety notes live in emailTemplates.ts (docs/73 D271).
  await sendEmail(email, magicLinkEmail(verifyUrl, code, language), `magic link for ${email} (${language}): ${verifyUrl} (code ${code})`);
}

// docs/77 D302/D303 — the owner's PIN reset code, and the notice that
// someone else reset the owner's PIN. Same adapter, same fallback.
export async function sendPinResetCodeEmail(email: string, code: string, language: EmailLanguage = 'en'): Promise<void> {
  await sendEmail(email, pinResetCodeEmail(code, language), `PIN reset code for ${email} (${language}): ${code}`);
}

export async function sendPinResetNoticeEmail(
  email: string,
  byName: string,
  deviceLabel: string,
  language: EmailLanguage = 'en',
): Promise<void> {
  await sendEmail(email, pinResetNoticeEmail(byName, deviceLabel, language), `PIN reset notice for ${email}: by ${byName} on ${deviceLabel}`);
}

async function sendEmail(email: string, message: { subject: string; text: string; html: string }, logLine: string): Promise<void> {
  const apiKey = process.env.SMTP2GO_API_KEY;
  if (!apiKey) {
    console.log(`[auth] ${logLine}`);
    return;
  }

  const sender = process.env.SMTP2GO_FROM_ADDRESS;
  if (!sender) {
    throw new Error('SMTP2GO_FROM_ADDRESS is not set — required once SMTP2GO_API_KEY is configured (see .env.example)');
  }

  const response = await fetch(SMTP2GO_SEND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      to: [email],
      sender,
      subject: message.subject,
      text_body: message.text,
      html_body: message.html,
    }),
  });

  // SMTP2GO returns HTTP 200 with a data.error field (or data.failed > 0)
  // on a rejected send (bad api key, unverified sender, etc.) rather than
  // a non-2xx status — checked explicitly here so a failed send surfaces
  // as a real throw, same reasoning as the Resend/ACS versions this
  // replaced: a 500 during setup is worth more than request-link looking
  // identical to "email sent" when it wasn't. docs/45's click-tracking
  // lesson also applies to any new provider — keep link/click tracking
  // off for this address if SMTP2GO's dashboard offers it, since a
  // tracking-wrapped redirect can auto-consume a single-use token.
  const result = (await response.json()) as Smtp2goResponse;
  if (!response.ok || result.data?.error || !result.data?.succeeded) {
    throw new Error(`SMTP2GO did not accept the email: ${result.data?.error ?? response.statusText}`);
  }
}

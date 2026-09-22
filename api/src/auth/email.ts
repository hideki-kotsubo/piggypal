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

const SMTP2GO_SEND_URL = 'https://api.smtp2go.com/v3/email/send';

interface Smtp2goResponse {
  data?: {
    succeeded?: number;
    failed?: number;
    error?: string;
  };
}

export async function sendMagicLinkEmail(email: string, verifyUrl: string): Promise<void> {
  const apiKey = process.env.SMTP2GO_API_KEY;
  if (!apiKey) {
    console.log(`[auth] magic link for ${email}: ${verifyUrl}`);
    return;
  }

  const sender = process.env.SMTP2GO_FROM_ADDRESS;
  if (!sender) {
    throw new Error('SMTP2GO_FROM_ADDRESS is not set — required once SMTP2GO_API_KEY is configured (see .env.example)');
  }

  // verifyUrl's token segment is base64url (A-Za-z0-9-_ only, generated
  // by crypto.ts) and appBaseUrl is an env var, not user input — safe to
  // interpolate directly into the HTML body with no escaping.
  const response = await fetch(SMTP2GO_SEND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      to: [email],
      sender,
      subject: 'Sign in to Flowtab',
      text_body: `Tap the link below to sign in to Flowtab:\n\n${verifyUrl}\n\nThis link expires in 15 minutes. If you didn't request this, you can ignore it.`,
      html_body: `<p>Tap the link below to sign in to Flowtab:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p><p>This link expires in 15 minutes. If you didn't request this, you can ignore it.</p>`,
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

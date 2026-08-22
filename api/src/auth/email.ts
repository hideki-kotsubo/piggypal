import { Resend } from 'resend';

// docs/05 D15: magic-link email behind a one-function adapter so swapping
// providers later is a same-day change — only this function's body moves,
// nothing about the token/hashing/expiry model above it. Proved out for
// real 2026-08-22: originally built against Azure Communication Services,
// swapped to Resend the same day at the user's request — no callers
// changed, RESEND_API_KEY/RESEND_FROM_ADDRESS just replace the Azure
// equivalents. Until RESEND_API_KEY is set, this logs the link instead of
// sending real email, which is also just what local dev needs anyway (no
// inbox to check, the link is right there in the server log).

// Lazy singleton, same reasoning as db.ts's pool() — constructed from an
// env var read at call time, not module-load time, so it can't race
// index.ts's own process.loadEnvFile().
let cachedClient: Resend | undefined;
function client(apiKey: string): Resend {
  cachedClient ??= new Resend(apiKey);
  return cachedClient;
}

export async function sendMagicLinkEmail(email: string, verifyUrl: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(`[auth] magic link for ${email}: ${verifyUrl}`);
    return;
  }

  const from = process.env.RESEND_FROM_ADDRESS;
  if (!from) {
    throw new Error('RESEND_FROM_ADDRESS is not set — required once RESEND_API_KEY is configured (see .env.example)');
  }

  // verifyUrl's token segment is base64url (A-Za-z0-9-_ only, generated
  // by crypto.ts) and appBaseUrl is an env var, not user input — safe to
  // interpolate directly into the HTML body with no escaping.
  const { error } = await client(apiKey).emails.send({
    from,
    to: email,
    subject: 'Sign in to piggypal',
    text: `Tap the link below to sign in to piggypal:\n\n${verifyUrl}\n\nThis link expires in 15 minutes. If you didn't request this, you can ignore it.`,
    html: `<p>Tap the link below to sign in to piggypal:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p><p>This link expires in 15 minutes. If you didn't request this, you can ignore it.</p>`,
  });

  // Resend's send() resolves with { data, error } rather than throwing on
  // a rejected send (bad domain, unverified sender, etc.) — surfaced here
  // as a real throw so it isn't silently swallowed, same reasoning as the
  // ACS version this replaced: a 500 during setup is worth more than
  // request-link looking identical to "email sent" when it wasn't.
  if (error) {
    throw new Error(`Resend did not accept the email: ${error.message}`);
  }
}

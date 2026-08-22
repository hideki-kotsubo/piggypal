// docs/05 D15: magic-link email behind a one-function adapter so swapping
// providers later is a same-day change — only this function's body would
// move, nothing about the token/hashing/expiry model above it. Azure
// Communication Services credentials don't exist yet (docs/39 open
// question #5) — until AZURE_COMMUNICATION_CONNECTION_STRING is set,
// this logs the link instead of sending real email, which is also just
// what local dev needs anyway (no inbox to check, the link is right
// there in the server log).
export async function sendMagicLinkEmail(email: string, verifyUrl: string): Promise<void> {
  const connectionString = process.env.AZURE_COMMUNICATION_CONNECTION_STRING;
  if (!connectionString) {
    console.log(`[auth] magic link for ${email}: ${verifyUrl}`);
    return;
  }
  // Real Azure Communication Services send — not implemented yet, no
  // account exists to test against (docs/39 open question #5). Land this
  // once that account is real; the adapter boundary above is what makes
  // this a same-day change rather than a design change.
  throw new Error('AZURE_COMMUNICATION_CONNECTION_STRING is set but the real ACS send path is not implemented yet');
}

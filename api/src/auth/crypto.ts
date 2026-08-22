import { createHash, randomBytes } from 'node:crypto';

// Opaque bearer tokens (magic-link tokens, refresh tokens) — docs/05 D12:
// "opaque (not JWT), hashed at rest." Only the hash is ever stored; the
// plaintext exists only in the URL/cookie sent to the client, exactly
// once. 32 random bytes, base64url so it's URL-safe with no padding to
// strip.
export function generateOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

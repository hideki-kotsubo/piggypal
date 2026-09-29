import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

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

// docs/56 D204: the 6-digit code emailed alongside the magic link.
// randomInt is uniform (no modulo bias); zero-padded so every code is
// exactly six digits. Low entropy on its own — what makes it safe is the
// 15-minute TTL plus routes.ts's 5-attempt cap per issued link.
export function generateSignInCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

// Constant-time comparison of two hex digests from hashToken().
export function hashesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

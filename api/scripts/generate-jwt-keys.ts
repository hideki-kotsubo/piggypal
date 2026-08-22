import { generateKeyPair } from 'node:crypto';
import { promisify } from 'node:util';

// One-off: `npm run -w api generate-jwt-keys`. Prints .env-ready lines
// (real newlines escaped to \n, per jwt.ts's readPem comment) — paste
// directly into api/.env for local dev, or into wherever docs/39's
// secrets question ends up landing for production. Never run this at
// server boot (see jwt.ts's comment on why) — this script is the only
// place a keypair gets generated.
const generateKeyPairAsync = promisify(generateKeyPair);

const { privateKey, publicKey } = await generateKeyPairAsync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const escape = (pem: string) => pem.trim().replace(/\n/g, '\\n');

console.log('# Paste into api/.env (local dev) — never commit these.');
console.log(`JWT_PRIVATE_KEY="${escape(privateKey)}"`);
console.log(`JWT_PUBLIC_KEY="${escape(publicKey)}"`);

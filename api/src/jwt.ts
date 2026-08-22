import { createHash } from 'node:crypto';
import { exportJWK, importPKCS8, importSPKI, jwtVerify, SignJWT, type CryptoKey, type JWK } from 'jose';

// docs/05 D13: RS256 access JWT, PowerSync verifies it via our own JWKS
// (docs/39 step 4) rather than a shared secret between the two
// deployments. Keys are generated once (`npm run -w api generate-jwt-keys`)
// and supplied via JWT_PRIVATE_KEY/JWT_PUBLIC_KEY env vars (docs/39's
// secrets table) — this module only ever reads them, never generates a
// throwaway pair at boot, so a restart never silently invalidates every
// outstanding token.
const ALG = 'RS256';
// 15 min per docs/05's "Server issues an access JWT (RS256, ~15 min TTL,
// sub=user_id)" line.
const ACCESS_TOKEN_TTL = '15m';
// docs/39's client_auth.audience in deploy/powersync/service.yaml.
const AUDIENCE = 'piggypal';

function readPem(envVar: string): string {
  const raw = process.env[envVar];
  if (!raw) {
    throw new Error(`${envVar} is not set — run \`npm run -w api generate-jwt-keys\` and set it (see .env.example)`);
  }
  // A PEM stored in a single-line env var typically arrives with literal
  // "\n" escape sequences instead of real newlines (most host env-var
  // UIs, and shell `export`, don't preserve multi-line values) — PKCS8/
  // SPKI parsing requires the real newlines back.
  return raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
}

let cachedPrivateKey: CryptoKey | undefined;
let cachedPublicKey: CryptoKey | undefined;
let cachedKid: string | undefined;

async function privateKey(): Promise<CryptoKey> {
  cachedPrivateKey ??= await importPKCS8(readPem('JWT_PRIVATE_KEY'), ALG);
  return cachedPrivateKey;
}

async function publicKey(): Promise<CryptoKey> {
  cachedPublicKey ??= await importSPKI(readPem('JWT_PUBLIC_KEY'), ALG);
  return cachedPublicKey;
}

// Stable, deterministic key id — derived from the public key itself so it
// never needs separate configuration and automatically changes if the
// keypair is ever rotated (a new public key produces a new kid, so old
// and new keys can coexist in the JWKS response during a rotation window
// — not wired up yet, single-key only for now, but this keeps the door
// open without extra work later).
async function kid(): Promise<string> {
  if (!cachedKid) {
    cachedKid = createHash('sha256').update(readPem('JWT_PUBLIC_KEY')).digest('hex').slice(0, 16);
  }
  return cachedKid;
}

// docs/05: "sub=user_id". Only the claims docs/05 actually specifies —
// no extra scope/role claims invented here.
export async function signAccessToken(userId: string): Promise<string> {
  const key = await privateKey();
  return new SignJWT({})
    .setProtectedHeader({ alg: ALG, kid: await kid() })
    .setSubject(userId)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_TTL)
    .sign(key);
}

// Self-verification for our own routes that require a valid access token
// (docs/05's "PowerSync token" endpoint, and any future gated route) —
// checks against our own public key directly rather than round-tripping
// through the public JWKS HTTP endpoint we serve to PowerSync. Throws on
// anything invalid (expired, wrong audience, bad signature); callers
// don't need to distinguish why, an auth middleware just turns any throw
// into a 401.
export async function verifyAccessToken(token: string): Promise<{ userId: string }> {
  const key = await publicKey();
  const { payload } = await jwtVerify(token, key, { audience: AUDIENCE, algorithms: [ALG] });
  if (!payload.sub) throw new Error('Token has no subject');
  return { userId: payload.sub };
}

// GET /.well-known/jwks.json — PowerSync's client_auth.jwks_uri
// (deploy/powersync/service.yaml) fetches this to verify tokens above,
// with no shared secret between the two deployments (docs/05 D13).
export async function getJwks(): Promise<{ keys: JWK[] }> {
  const jwk = await exportJWK(await publicKey());
  jwk.use = 'sig';
  jwk.alg = ALG;
  jwk.kid = await kid();
  return { keys: [jwk] };
}

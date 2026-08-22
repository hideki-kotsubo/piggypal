import { existsSync } from 'node:fs';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import { createServer } from 'node:http';
import { attachRelay } from './relay.js';
import { authRouter } from './auth/routes.js';
import { syncRouter } from './sync/routes.js';
import { getJwks } from './jwt.js';
import { API_VERSION } from './version.js';

// Node's own .env support (stable since 20.6, no dotenv dependency
// needed) — resolves relative to process.cwd(), which is api/ when this
// runs via `npm run dev:api` from the repo root (npm workspaces set cwd
// to the workspace directory). Guarded rather than calling it
// unconditionally: .env is gitignored, so a fresh clone with no local
// override should still start cleanly on defaults, not crash.
if (existsSync('.env')) {
  process.loadEnvFile();
}

const app = express();
const port = process.env.PORT ?? 3000;

// docs/05's refresh cookie needs credentials sent on cross-origin
// requests from app/ (a different subdomain — app.piggypal.codexbase.dev
// vs api-beta.piggypal.codexbase.dev). A single hard-coded CORS_ORIGIN
// default was a real gap, only surfaced once docs/42's sign-in flow
// shipped: it's the first code ever to make an HTTP fetch() from
// app-beta to api-beta — everything before it (docs/28's relay) was
// WebSocket, which never triggers a CORS preflight at all, so a wrong
// default here went unnoticed since docs/28. CORS_ORIGIN now accepts a
// comma-separated list; unset falls back to every origin vite.config.ts's
// own allowedHosts already anticipates (both app subdomains) plus the
// dev server's own origin, instead of hard-coding just one.
const DEFAULT_CORS_ORIGINS = [
  'http://localhost:3001',
  'https://app.piggypal.codexbase.dev',
  'https://app-beta.piggypal.codexbase.dev',
];
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
  : DEFAULT_CORS_ORIGINS;
app.use(cors({ origin: corsOrigins, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.use('/api/auth', authRouter);
app.use('/api/sync', syncRouter);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: API_VERSION });
});

// docs/05 D13 / docs/39 step 4 — PowerSync Service's client_auth.jwks_uri
// (deploy/powersync/service.yaml) fetches this to verify access JWTs
// signAccessToken (jwt.ts) issues, with no shared secret between the two
// deployments. Cache-Control matches the JWKS convention of "fine to
// cache, just not forever" — this app never rotates keys automatically.
app.get('/.well-known/jwks.json', async (_req, res) => {
  try {
    res.set('Cache-Control', 'public, max-age=3600');
    res.json(await getJwks());
  } catch (err) {
    // Missing JWT_PUBLIC_KEY env var, most likely (see jwt.ts's readPem) —
    // a real 500 here is correct: PowerSync depends on this route existing
    // to do anything at all, silently returning an empty key set would
    // just turn a loud startup failure into a confusing runtime one.
    res.status(500).json({ error: (err as Error).message });
  }
});

// Still to come:
//   /api/parse             — docs/04-ai-entry-pipeline.md
//   /api/stripe/webhook    — docs/06-subscription-and-billing.md

// docs/28 — anonymous WebRTC signaling relay, no auth. Shares this same
// HTTP server/port (WebSocket upgrade on /relay) rather than a separate
// process, since it's this lightweight.
const server = createServer(app);
attachRelay(server);

server.listen(port, () => {
  console.log(`api listening on :${port}`);
});

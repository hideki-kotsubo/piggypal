import { existsSync } from 'node:fs';
import express from 'express';
import { createServer } from 'node:http';
import { attachRelay } from './relay.js';
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

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: API_VERSION });
});

// Future routes land here as they're built out:
//   /api/auth/*            — docs/05-auth-and-devices.md
//   /api/sync/upload       — docs/03-schema-and-sync-rules.md
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

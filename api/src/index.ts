import express from 'express';

const app = express();
const port = process.env.PORT ?? 3000;

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Future routes land here as they're built out:
//   /api/auth/*            — docs/05-auth-and-devices.md
//   /api/sync/upload       — docs/03-schema-and-sync-rules.md
//   /api/parse             — docs/04-ai-entry-pipeline.md
//   /api/stripe/webhook    — docs/06-subscription-and-billing.md

app.listen(port, () => {
  console.log(`api listening on :${port}`);
});

import { defineConfig } from 'vitest/config';

// Standalone, not merged with vite.config.ts — nothing under test needs
// the React/PWA/PowerSync-worker plugins that config carries, and
// PowerSync's own web-worker + WASM setup (see vite.config.ts's own
// comment) has no place in a plain Node test run.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});

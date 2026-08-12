import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // wa-sqlite's WASM (~7MB across sync/async + multi-cipher variants,
        // the latter unused since we don't pass an encryptionKey — worth
        // trimming later, not now) exceeds the 2MB default precache limit.
        // It needs to be precached, not skipped: this app is meant to work
        // fully offline from a cold start (docs/01 D1), and the SQLite
        // engine itself has to be available before any query can run.
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
      manifest: {
        // Name/colors are placeholders — branding is explicitly parked
        // (docs/01, item 5). Real icons + name land once that's resolved.
        name: 'piggypal',
        short_name: 'piggypal',
        description: 'Simple, light, private budgeting — type or say what you spent.',
        theme_color: '#3f7d69',
        background_color: '#eef0ea',
        display: 'standalone',
        icons: [
          // TODO: replace with real PNG icons once branding is decided.
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
    }),
  ],
  server: {
    port: 3001, // Set the development server port to 3000
    host: "0.0.0.0",
    allowedHosts: ["app.piggypal.codexbase.dev","app-beta.piggypal.codexbase.dev"],
  },
  // @powersync/web ships web workers + WASM (wa-sqlite) — must be excluded
  // from pre-bundling and workers built as ES modules, or the WASM/worker
  // assets get mangled. Per PowerSync's own example Vite config.
  optimizeDeps: {
    exclude: ['@powersync/web'],
  },
  worker: {
    format: 'es',
  },
})

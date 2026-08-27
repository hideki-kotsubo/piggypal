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
        // wa-sqlite ships 4 build variants (sync/async × plain/multi-cipher)
        // because @powersync/web's vfs.ts picks between them via a runtime
        // `if (encryptionKey)` branch it can't statically eliminate — Vite
        // bundles both arms into dist/, but only ever *runs* one. db.ts
        // never sets an encryptionKey (no SQLCipher use here), so the
        // mc-wa-sqlite* ("multi-cipher") files are unreachable dead weight
        // from this app's perspective — real bytes, just never fetched.
        // globIgnores drops them from the precache manifest (the sync/async
        // split still can't be narrowed the same way — that one really is
        // chosen per-browser, based on OPFS sync-access-handle support).
        // This app is meant to work fully offline from a cold start
        // (docs/01 D1), so what's left (wa-sqlite-async.wasm, ~2.3MB) still
        // needs to be precached, not skipped.
        globIgnores: ['**/mc-wa-sqlite*'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
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

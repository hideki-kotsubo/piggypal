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
        // Name and icons are both real now (docs/53's rename, docs/52's
        // Flowtab wave-mark icon set below) — theme_color/background_color
        // are the only pieces still the old piggypal placeholders
        // (docs/01 item 5), pending real brand colors.
        name: 'Flowtab',
        short_name: 'Flowtab',
        description: 'Simple, light, private budgeting — type or say what you spent.',
        theme_color: '#3f7d69',
        background_color: '#eef0ea',
        display: 'standalone',
        icons: [
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml' },
          { src: 'icons/icon-48.webp', sizes: '48x48', type: 'image/webp' },
          { src: 'icons/icon-72.webp', sizes: '72x72', type: 'image/webp' },
          { src: 'icons/icon-96.webp', sizes: '96x96', type: 'image/webp' },
          { src: 'icons/icon-128.webp', sizes: '128x128', type: 'image/webp' },
          // 192/512 are the two sizes install prompts actually use, and the
          // icon's design was verified to survive a circular safe-zone crop
          // (docs/52), so "maskable" is genuinely safe here, not just copied.
          { src: 'icons/icon-192.webp', sizes: '192x192', type: 'image/webp', purpose: 'any maskable' },
          { src: 'icons/icon-256.webp', sizes: '256x256', type: 'image/webp' },
          { src: 'icons/icon-512.webp', sizes: '512x512', type: 'image/webp', purpose: 'any maskable' },
        ],
      },
    }),
  ],
  server: {
    port: 3001, // Set the development server port to 3000
    host: "0.0.0.0",
    // Both piggypal.* (still live) and flowtab.* (new) kept during the
    // rebrand transition (docs/53) — additive, not a hard cutover.
    allowedHosts: [
      "app.piggypal.codexbase.dev","app-beta.piggypal.codexbase.dev",
      "app.flowtab.codexbase.dev","app-beta.flowtab.codexbase.dev",
    ],
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

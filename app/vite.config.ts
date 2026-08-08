import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
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
    allowedHosts: ["app.piggypal.codexbase.dev"],
  },
})

import type { CapacitorConfig } from '@capacitor/cli';

// appId is essentially permanent once uploaded to TestFlight/Play Console —
// confirmed with the user directly (com.myflowtab.app), not derived from the
// "piggypal" brand, which is still parked (docs/01 item 5). appName is left
// as the same placeholder used in vite.config.ts's PWA manifest since it's
// trivial to change later, unlike appId.
const config: CapacitorConfig = {
  appId: 'com.myflowtab.app',
  appName: 'piggypal', // TODO: replace once branding/naming is resolved
  webDir: 'dist',
};

export default config;

import type { CapacitorConfig } from '@capacitor/cli';

// appId is essentially permanent once uploaded to TestFlight/Play Console —
// confirmed with the user directly (com.myflowtab.app). appName is the
// display name under the icon (docs/60); `cap sync` doesn't copy it into
// already-created native projects, so strings.xml / Info.plist carry it too.
const config: CapacitorConfig = {
  appId: 'com.myflowtab.app',
  appName: 'Flowtab',
  webDir: 'dist',
};

export default config;

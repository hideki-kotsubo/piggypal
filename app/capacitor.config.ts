import type { CapacitorConfig } from '@capacitor/cli';

// appId is essentially permanent once uploaded to TestFlight/Play Console —
// confirmed with the user directly (com.myflowtab.app). appName is the
// display name under the icon (docs/60); `cap sync` doesn't copy it into
// already-created native projects, so strings.xml / Info.plist carry it too.
const config: CapacitorConfig = {
  appId: 'com.myflowtab.app',
  appName: 'Flowtab',
  webDir: 'dist',
  // docs/73 D269: @capacitor-community/speech-recognition has no
  // Package.swift, so it can't join this Swift Package Manager iOS project.
  // iOS keeps WebKit's own speech recognition (docs/62 D234); only Android
  // gets the native plugin. This allowlist is every iOS plugin except that
  // one; add new iOS plugins here too.
  ios: {
    includePlugins: ['@capacitor-community/sqlite', '@capacitor/app', '@powersync/capacitor', 'capacitor-secure-storage-plugin'],
  },
};

export default config;

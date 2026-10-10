import { Capacitor } from '@capacitor/core';
import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin';

// docs/68: in the iOS/Android apps the web view runs at capacitor://localhost
// / https://localhost, cross-site to the api, so WebKit never keeps the
// refresh cookie (docs/05 D13) there and every refresh came back 401 — sync
// silently stopped once the 15-minute access token was gone. The api hands
// native clients the refresh token in the response body instead, and it
// lives here: the iOS Keychain / Android Keystore, never localStorage. On
// the web this whole module is a no-op and the httpOnly cookie stays the
// only place the token exists.
const KEY = 'flowtab.refresh-token';

export const usesNativeRefreshToken = Capacitor.isNativePlatform();

export async function loadRefreshToken(): Promise<string | null> {
  if (!usesNativeRefreshToken) return null;
  try {
    const { value } = await SecureStoragePlugin.get({ key: KEY });
    return value || null;
  } catch {
    // The plugin rejects when the key doesn't exist — i.e. never signed in
    // on this device, or signed out since.
    return null;
  }
}

export async function saveRefreshToken(token: string): Promise<void> {
  if (!usesNativeRefreshToken) return;
  await SecureStoragePlugin.set({ key: KEY, value: token });
}

export async function forgetRefreshToken(): Promise<void> {
  if (!usesNativeRefreshToken) return;
  try {
    await SecureStoragePlugin.remove({ key: KEY });
  } catch {
    // Already gone.
  }
}

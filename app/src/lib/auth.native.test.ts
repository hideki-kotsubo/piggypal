import { beforeEach, describe, expect, it, vi } from 'vitest';

// docs/68: the native apps' refresh token lives in the Keychain (mocked
// here as a Map) and travels in request bodies, never a cookie.
const keychain = vi.hoisted(() => {
  const store = new Map<string, string>();
  const local = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => local.get(k) ?? null,
    setItem: (k: string, v: string) => void local.set(k, v),
    removeItem: (k: string) => void local.delete(k),
    clear: () => local.clear(),
    key: () => null,
    length: 0,
  } as Storage;
  return store;
});

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }));
vi.mock('capacitor-secure-storage-plugin', () => ({
  SecureStoragePlugin: {
    get: async ({ key }: { key: string }) => {
      if (!keychain.has(key)) throw new Error('Item with given key does not exist');
      return { value: keychain.get(key)! };
    },
    set: async ({ key, value }: { key: string; value: string }) => {
      keychain.set(key, value);
      return { value: true };
    },
    remove: async ({ key }: { key: string }) => {
      if (!keychain.has(key)) throw new Error('Item with given key does not exist');
      keychain.delete(key);
      return { value: true };
    },
  },
}));

const auth = await import('./auth');
const KEY = 'flowtab.refresh-token';

type Call = { path: string; init?: RequestInit };
let calls: Call[];
let responses: Response[];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
  keychain.clear();
  localStorage.clear();
  calls = [];
  responses = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({ path: new URL(url).pathname, init });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected fetch ${url}`);
    return next;
  });
});

function signedInMarker() {
  localStorage.setItem('flowtab:auth-account', JSON.stringify({ userId: 'u1', email: 'a@b.c' }));
}

describe('native refresh token (docs/68)', () => {
  it('keeps the refresh token from sign-in in the Keychain', async () => {
    responses.push(json(200, { accessToken: 'a1', userId: 'u1', isNewUser: false, refreshToken: 'r1' }));
    await auth.verifyMagicCode('a@b.c', '123456');
    expect(keychain.get(KEY)).toBe('r1');
  });

  it('refreshes with the stored token in the body and saves the rotated one', async () => {
    keychain.set(KEY, 'r1');
    responses.push(json(200, { accessToken: 'a2', refreshToken: 'r2' }));
    expect(await auth.refreshAccessToken()).toBe('a2');
    expect(calls[0].path).toBe('/api/auth/refresh');
    expect(JSON.parse(calls[0].init!.body as string)).toEqual({ refreshToken: 'r1' });
    expect(keychain.get(KEY)).toBe('r2');
  });

  it('coalesces concurrent refreshes into one request, so the rotating token is used once', async () => {
    keychain.set(KEY, 'r1');
    responses.push(json(200, { accessToken: 'a2', refreshToken: 'r2' }));
    const [x, y] = await Promise.all([auth.refreshAccessToken(), auth.refreshAccessToken()]);
    expect([x, y]).toEqual(['a2', 'a2']);
    expect(calls).toHaveLength(1);
  });

  it('with no stored token, makes no request and marks the session expired if signed in', async () => {
    signedInMarker();
    expect(await auth.refreshAccessToken()).toBeNull();
    expect(calls).toHaveLength(0);
    expect(auth.isSessionExpired()).toBe(true);
    responses.push(json(200, { accessToken: 'a1', userId: 'u1', isNewUser: false, refreshToken: 'r1' }));
    await auth.verifyMagicCode('a@b.c', '123456');
    expect(auth.isSessionExpired()).toBe(false);
  });

  it('forgets the token on a 401', async () => {
    signedInMarker();
    keychain.set(KEY, 'dead');
    responses.push(json(401, { error: 'Unknown refresh token' }));
    expect(await auth.refreshAccessToken()).toBeNull();
    expect(keychain.has(KEY)).toBe(false);
    expect(auth.isSessionExpired()).toBe(true);
    auth.clearAuthAccount();
    expect(auth.isSessionExpired()).toBe(false);
  });

  it('keeps the token on a server error, for the next try', async () => {
    keychain.set(KEY, 'r1');
    responses.push(json(503, { error: 'unavailable' }));
    expect(await auth.refreshAccessToken()).toBeNull();
    expect(keychain.get(KEY)).toBe('r1');
  });

  it('PowerSync credentials work again after an app restart (no access token in memory)', async () => {
    keychain.set(KEY, 'r1');
    responses.push(json(200, { accessToken: 'a2', refreshToken: 'r2' }));
    responses.push(json(200, { token: 'ps' }));
    // A fresh module stands in for a relaunched app: nothing in memory.
    vi.resetModules();
    const fresh = await import('./auth');
    expect(await fresh.fetchPowerSyncCredentials()).toEqual({ token: 'ps' });
    expect(calls.map((c) => c.path)).toEqual(['/api/auth/refresh', '/api/auth/powersync-token']);
  });

  it('sign-out revokes the stored token server-side and removes it locally', async () => {
    keychain.set(KEY, 'r1');
    responses.push(new Response(null, { status: 204 }));
    await auth.signOut();
    expect(calls[0].path).toBe('/api/auth/logout');
    expect(JSON.parse(calls[0].init!.body as string)).toEqual({ refreshToken: 'r1' });
    expect(keychain.has(KEY)).toBe(false);
  });
});

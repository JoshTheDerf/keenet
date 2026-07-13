import { describe, it, expect, beforeEach } from 'vitest';
import {
  secretStore,
  registerSecretBackend,
  resetSecretStoreForTests,
  oauthTokenKey,
  WEBDAV_PASSWORD_KEY,
  type SecretBackend
} from './secret-store';

const WEB_PREFIX = 'keeweb-secret:';

/** In-memory backend standing in for a platform keychain. */
function memoryBackend(): SecretBackend & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: (key) => Promise.resolve(data.get(key) ?? null),
    set: (key, value) => {
      data.set(key, value);
      return Promise.resolve();
    },
    remove: (key) => {
      data.delete(key);
      return Promise.resolve();
    }
  };
}

beforeEach(() => {
  localStorage.clear();
  resetSecretStoreForTests();
});

describe('secretStore (web backend)', () => {
  it('round-trips a secret through prefixed localStorage', async () => {
    await secretStore.set('foo', 'bar');
    expect(localStorage.getItem(`${WEB_PREFIX}foo`)).toBe('bar');
    expect(await secretStore.get('foo')).toBe('bar');

    await secretStore.remove('foo');
    expect(localStorage.getItem(`${WEB_PREFIX}foo`)).toBeNull();
    expect(await secretStore.get('foo')).toBeNull();
  });

  it('returns null for missing keys', async () => {
    expect(await secretStore.get('nope')).toBeNull();
    expect(secretStore.getCached('nope')).toBeNull();
  });

  it('serves cached values and exposes them synchronously via getCached', async () => {
    localStorage.setItem(`${WEB_PREFIX}a`, '1');
    expect(secretStore.getCached('a')).toBeNull(); // not loaded yet
    expect(await secretStore.get('a')).toBe('1');
    expect(secretStore.getCached('a')).toBe('1');

    // Mutating the backing store does not bypass the cache.
    localStorage.setItem(`${WEB_PREFIX}a`, '2');
    expect(await secretStore.get('a')).toBe('1');
  });

  it('updates the cache synchronously on set/remove', () => {
    void secretStore.set('sync', 'now');
    expect(secretStore.getCached('sync')).toBe('now');
    void secretStore.remove('sync');
    expect(secretStore.getCached('sync')).toBeNull();
  });

  it('preload warms the cache for the given keys', async () => {
    localStorage.setItem(WEB_PREFIX + WEBDAV_PASSWORD_KEY, 'pw');
    await secretStore.preload();
    expect(secretStore.getCached(WEBDAV_PASSWORD_KEY)).toBe('pw');
  });
});

describe('legacy plaintext migration', () => {
  it('moves old oauth token localStorage keys into the backend and deletes the originals', async () => {
    const token = JSON.stringify({ access_token: 'at', refresh_token: 'rt', expiry: 123 });
    localStorage.setItem('keeweb-oauth-dropbox', token);
    localStorage.setItem('keeweb-oauth-gdrive', 'g-token');

    expect(await secretStore.get(oauthTokenKey('dropbox'))).toBe(token);
    expect(await secretStore.get(oauthTokenKey('gdrive'))).toBe('g-token');
    expect(await secretStore.get(oauthTokenKey('onedrive'))).toBeNull();

    expect(localStorage.getItem('keeweb-oauth-dropbox')).toBeNull();
    expect(localStorage.getItem('keeweb-oauth-gdrive')).toBeNull();
    expect(localStorage.getItem(WEB_PREFIX + oauthTokenKey('dropbox'))).toBe(token);
  });

  it('does not overwrite a value the backend already holds', async () => {
    localStorage.setItem(WEB_PREFIX + oauthTokenKey('dropbox'), 'current');
    localStorage.setItem('keeweb-oauth-dropbox', 'stale-legacy');

    expect(await secretStore.get(oauthTokenKey('dropbox'))).toBe('current');
    expect(localStorage.getItem('keeweb-oauth-dropbox')).toBeNull();
  });

  it('extracts the webdav password from the settings blob and scrubs the blob', async () => {
    localStorage.setItem(
      'keeweb-settings',
      JSON.stringify({
        theme: 'dark',
        webdav: { url: 'https://dav.example.com', user: 'joe', password: 's3cret' }
      })
    );

    expect(await secretStore.get(WEBDAV_PASSWORD_KEY)).toBe('s3cret');

    const blob = JSON.parse(localStorage.getItem('keeweb-settings')!) as {
      theme: string;
      webdav: Record<string, string>;
    };
    expect(blob.webdav).toEqual({ url: 'https://dav.example.com', user: 'joe' });
    expect(blob.theme).toBe('dark'); // rest of the blob is untouched
    expect(JSON.stringify(blob)).not.toContain('s3cret');
  });

  it('runs the migration before a first set (legacy value cannot resurrect)', async () => {
    localStorage.setItem('keeweb-oauth-onedrive', 'legacy');
    await secretStore.set('unrelated', 'x');
    expect(localStorage.getItem('keeweb-oauth-onedrive')).toBeNull();
    expect(await secretStore.get(oauthTokenKey('onedrive'))).toBe('legacy');
  });
});

describe('registerSecretBackend', () => {
  it('routes get/set/remove to the platform backend', async () => {
    const backend = memoryBackend();
    registerSecretBackend(backend);

    await secretStore.set('k', 'v');
    expect(backend.data.get('k')).toBe('v');
    // Nothing lands in localStorage when a platform backend is registered.
    expect(localStorage.getItem(`${WEB_PREFIX}k`)).toBeNull();

    expect(await secretStore.get('k')).toBe('v');
    await secretStore.remove('k');
    expect(backend.data.has('k')).toBe(false);
  });

  it('migrates web-fallback values into a newly registered platform backend', async () => {
    // A previous run stored secrets via the web fallback (e.g. before the
    // native backend existed); they must move into the keychain.
    localStorage.setItem(WEB_PREFIX + WEBDAV_PASSWORD_KEY, 'pw');
    localStorage.setItem('keeweb-oauth-dropbox', 'legacy-token');

    const backend = memoryBackend();
    registerSecretBackend(backend);

    expect(await secretStore.get(WEBDAV_PASSWORD_KEY)).toBe('pw');
    expect(await secretStore.get(oauthTokenKey('dropbox'))).toBe('legacy-token');
    expect(backend.data.get(WEBDAV_PASSWORD_KEY)).toBe('pw');
    expect(backend.data.get(oauthTokenKey('dropbox'))).toBe('legacy-token');
    expect(localStorage.getItem(WEB_PREFIX + WEBDAV_PASSWORD_KEY)).toBeNull();
    expect(localStorage.getItem('keeweb-oauth-dropbox')).toBeNull();
  });

  it('clears the cache so values are re-read from the new backend', async () => {
    await secretStore.set('k', 'web-value');
    expect(secretStore.getCached('k')).toBe('web-value');

    const backend = memoryBackend();
    backend.data.set('k', 'native-value');
    registerSecretBackend(backend);

    expect(secretStore.getCached('k')).toBeNull();
    expect(await secretStore.get('k')).toBe('native-value');
  });
});

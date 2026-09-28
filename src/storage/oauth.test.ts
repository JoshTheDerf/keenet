// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getValidAccessToken, isTokenValid, setToken, getToken } from './oauth';
import { registerSecretBackend, resetSecretStoreForTests } from './secret-store';

const ENDPOINT = { tokenUrl: 'https://auth.example.com/token', clientId: 'cid' };

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  const data = new Map<string, string>();
  registerSecretBackend({
    get: (k) => Promise.resolve(data.get(k) ?? null),
    set: (k, v) => {
      data.set(k, v);
      return Promise.resolve();
    },
    remove: (k) => {
      data.delete(k);
      return Promise.resolve();
    }
  });
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetSecretStoreForTests();
});

function expired(refresh?: string) {
  return { access_token: 'old', refresh_token: refresh, expiry: Date.now() - 1000 };
}

function tokenResponse(): Response {
  return new Response(JSON.stringify({ access_token: 'new', expires_in: 3600 }), { status: 200 });
}

describe('oauth tokens', () => {
  it('treats an expired but refreshable token as authorized', async () => {
    await setToken('dropbox', expired('r1'));
    expect(isTokenValid('dropbox')).toBe(true);
    await setToken('dropbox', expired());
    expect(isTokenValid('dropbox')).toBe(false);
  });

  it('shares one refresh between concurrent callers and keeps the refresh token', async () => {
    await setToken('gdrive', expired('r1'));
    fetchMock.mockResolvedValue(tokenResponse());
    const [a, b] = await Promise.all([
      getValidAccessToken('gdrive', ENDPOINT),
      getValidAccessToken('gdrive', ENDPOINT)
    ]);
    expect([a, b]).toEqual(['new', 'new']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getToken('gdrive')?.refresh_token).toBe('r1');
  });

  it('keeps the session on a transient refresh failure', async () => {
    await setToken('onedrive', expired('r1'));
    fetchMock.mockRejectedValueOnce(new TypeError('network down'));
    await expect(getValidAccessToken('onedrive', ENDPOINT)).rejects.toThrow('network down');
    expect(getToken('onedrive')?.refresh_token).toBe('r1');

    fetchMock.mockResolvedValueOnce(tokenResponse());
    await expect(getValidAccessToken('onedrive', ENDPOINT)).resolves.toBe('new');
  });

  it('clears the session when the refresh token is rejected', async () => {
    await setToken('dropbox', expired('r1'));
    fetchMock.mockResolvedValue(new Response('{"error":"invalid_grant"}', { status: 400 }));
    await expect(getValidAccessToken('dropbox', ENDPOINT)).rejects.toThrow('Session expired');
    expect(getToken('dropbox')).toBeNull();
  });
});

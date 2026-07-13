// @vitest-environment node
// Uses Node's real WebCrypto for SHA-1 (happy-dom's SubtleCrypto is incomplete);
// the network is mocked via a stubbed global fetch.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkPwned, checkManyPwned } from './hibp';

/** Independent SHA-1 (upper-case hex) so the tests verify hibp's hashing too. */
async function sha1Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

function response(body: string, ok = true, status = 200): Response {
  return { ok, status, text: async () => body } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('checkPwned', () => {
  it('sends only the 5-char SHA-1 prefix (k-anonymity)', async () => {
    const hash = await sha1Hex('correct horse battery staple');
    fetchMock.mockResolvedValue(response('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:1'));

    await checkPwned('correct horse battery staple');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toBe(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`);
    // Neither the full hash nor any part of the suffix may leave the device.
    expect(url).not.toContain(hash.slice(5, 10));
  });

  it('matches the local suffix and returns its breach count', async () => {
    const hash = await sha1Hex('password');
    const suffix = hash.slice(5);
    const body = [
      '0018A45C4D1DEF81644B54AB7F969B88D65:3',
      `${suffix}:42`,
      '011053FD0102E94D6AE2F8B83D76FAF94F6:9'
    ].join('\r\n');
    fetchMock.mockResolvedValue(response(body));

    await expect(checkPwned('password')).resolves.toBe(42);
  });

  it('returns 0 when the suffix is not in the range response', async () => {
    fetchMock.mockResolvedValue(response('0018A45C4D1DEF81644B54AB7F969B88D65:3'));
    await expect(checkPwned('some unbreached password')).resolves.toBe(0);
  });

  it('returns 0 for an empty password without any request', async () => {
    await expect(checkPwned('')).resolves.toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws on a non-OK response', async () => {
    fetchMock.mockResolvedValue(response('', false, 503));
    await expect(checkPwned('whatever')).rejects.toThrow('503');
  });
});

describe('checkManyPwned', () => {
  it('de-duplicates identical passwords and maps every id, skipping clean ones', async () => {
    const breachedSuffix = (await sha1Hex('reused-breached')).slice(5);
    fetchMock.mockImplementation(async () => response(`${breachedSuffix}:7`));

    const result = await checkManyPwned([
      { id: 'e1', password: 'reused-breached' },
      { id: 'e2', password: 'reused-breached' },
      { id: 'e3', password: 'unique-clean' },
      { id: 'e4', password: '' }
    ]);

    // One request per unique non-empty password: 2, not 3 (and none for '').
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.get('e1')).toBe(7);
    expect(result.get('e2')).toBe(7);
    // 'unique-clean' has a different suffix, so it does not match → excluded.
    expect(result.has('e3')).toBe(false);
    expect(result.has('e4')).toBe(false);
  });

  it('skips passwords whose lookup fails instead of rejecting', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    const result = await checkManyPwned([{ id: 'e1', password: 'x' }]);
    expect(result.size).toBe(0);
  });
});

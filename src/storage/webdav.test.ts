// @vitest-environment node
// The network is mocked via a stubbed global fetch (same pattern as hibp.test.ts).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { webdavProvider } from './webdav';
import { StorageConflictError, StorageNotFoundError } from './errors';

const BYTES = new TextEncoder().encode('kdbx-bytes');

function response(
  status: number,
  headers: Record<string, string> = {},
  body: BodyInit | null = null
): Response {
  return new Response(body, { status, headers });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function requestOf(call: number): { url: string; init: RequestInit } {
  const [url, init] = fetchMock.mock.calls[call] as [string, RequestInit | undefined];
  return { url: String(url), init: init ?? {} };
}

function headersOf(call: number): Record<string, string> {
  return (requestOf(call).init.headers ?? {}) as Record<string, string>;
}

describe('webdav load', () => {
  it('returns data plus rev (etag) and modified on success', async () => {
    fetchMock.mockResolvedValue(
      response(
        200,
        { etag: '"rev-1"', 'last-modified': 'Wed, 01 Jan 2025 12:00:00 GMT' },
        BYTES
      )
    );

    const result = await webdavProvider.load('https://dav.example.com/vault.kdbx');

    expect(new Uint8Array(result.data)).toEqual(BYTES);
    expect(result.stat.rev).toBe('"rev-1"');
    expect(result.stat.modified).toBe(Date.parse('Wed, 01 Jan 2025 12:00:00 GMT'));
  });

  it('leaves rev/modified undefined when headers are missing', async () => {
    fetchMock.mockResolvedValue(response(200, {}, BYTES));
    const result = await webdavProvider.load('https://dav.example.com/vault.kdbx');
    expect(result.stat.rev).toBeUndefined();
    expect(result.stat.modified).toBeUndefined();
  });

  it('throws StorageNotFoundError on 404', async () => {
    fetchMock.mockResolvedValue(response(404));
    await expect(webdavProvider.load('https://dav.example.com/nope.kdbx')).rejects.toBeInstanceOf(
      StorageNotFoundError
    );
  });

  it('throws a generic error carrying the status on other failures', async () => {
    fetchMock.mockResolvedValue(response(500));
    await expect(webdavProvider.load('https://dav.example.com/vault.kdbx')).rejects.toThrow('500');
  });
});

describe('webdav auth header', () => {
  it('sends Basic auth with base64(user:pass)', async () => {
    fetchMock.mockResolvedValue(response(200, {}, BYTES));
    await webdavProvider.load('vault.kdbx', {
      url: 'https://dav.example.com',
      user: 'joe',
      password: 's3cret:with:colons'
    });

    expect(headersOf(0).Authorization).toBe(`Basic ${btoa('joe:s3cret:with:colons')}`);
  });

  it('treats a missing password as empty, keeping the user:pass shape', async () => {
    fetchMock.mockResolvedValue(response(200, {}, BYTES));
    await webdavProvider.load('vault.kdbx', { url: 'https://dav.example.com', user: 'joe' });
    expect(headersOf(0).Authorization).toBe(`Basic ${btoa('joe:')}`);
  });

  it('sends no Authorization header without a user', async () => {
    fetchMock.mockResolvedValue(response(200, {}, BYTES));
    await webdavProvider.load('vault.kdbx', { url: 'https://dav.example.com' });
    expect(headersOf(0).Authorization).toBeUndefined();
  });
});

describe('webdav url joining', () => {
  it.each([
    ['https://dav.example.com', 'vault.kdbx'],
    ['https://dav.example.com/', 'vault.kdbx'],
    ['https://dav.example.com', '/vault.kdbx'],
    ['https://dav.example.com/', '/vault.kdbx']
  ])('joins base %s and path %s with exactly one slash', async (base, path) => {
    fetchMock.mockResolvedValue(response(200, {}, BYTES));
    await webdavProvider.load(path, { url: base });
    expect(requestOf(0).url).toBe('https://dav.example.com/vault.kdbx');
  });

  it('uses an absolute path as-is, ignoring the configured base', async () => {
    fetchMock.mockResolvedValue(response(200, {}, BYTES));
    await webdavProvider.load('https://other.example.com/dir/vault.kdbx', {
      url: 'https://dav.example.com/'
    });
    expect(requestOf(0).url).toBe('https://other.example.com/dir/vault.kdbx');
  });
});

describe('webdav save', () => {
  const data = BYTES.buffer.slice(0) as ArrayBuffer;

  it('PUTs the data and returns the new etag as rev', async () => {
    fetchMock.mockResolvedValue(response(201, { etag: '"rev-2"' }));

    const stat = await webdavProvider.save('vault.kdbx', data, { url: 'https://dav.example.com' });

    expect(stat.rev).toBe('"rev-2"');
    const { url, init } = requestOf(0);
    expect(url).toBe('https://dav.example.com/vault.kdbx');
    expect(init.method).toBe('PUT');
    expect(init.body).toBe(data);
    expect(headersOf(0)['Content-Type']).toBe('application/octet-stream');
    expect(headersOf(0)['If-Match']).toBeUndefined(); // unconditional without rev
  });

  it('sends If-Match when a rev is given and maps 412 to StorageConflictError', async () => {
    fetchMock.mockResolvedValue(response(412));

    await expect(
      webdavProvider.save('vault.kdbx', data, { url: 'https://dav.example.com' }, '"rev-1"')
    ).rejects.toBeInstanceOf(StorageConflictError);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(headersOf(0)['If-Match']).toBe('"rev-1"');
  });

  it('creates missing parent collections on 409 and retries the PUT once', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'MKCOL') return response(201);
      if (init?.method === 'PUT') {
        return fetchMock.mock.calls.filter((c) => (c[1] as RequestInit)?.method === 'PUT').length > 1
          ? response(201, { etag: '"rev-3"' })
          : response(409);
      }
      throw new Error(`unexpected ${init?.method} ${url}`);
    });

    const stat = await webdavProvider.save(
      'https://dav.example.com/backups/2026/vault.kdbx',
      data,
      { user: 'joe', password: 'pw' }
    );

    expect(stat.rev).toBe('"rev-3"');
    const mkcols = fetchMock.mock.calls.filter((c) => (c[1] as RequestInit).method === 'MKCOL');
    // one MKCOL per ancestor directory (not for the file itself), with auth
    expect(mkcols.map((c) => String(c[0]))).toEqual([
      'https://dav.example.com/backups/',
      'https://dav.example.com/backups/2026/'
    ]);
    for (const c of mkcols) {
      const headers = (c[1] as RequestInit).headers as Record<string, string>;
      expect(headers.Authorization).toBe(`Basic ${btoa('joe:pw')}`);
    }
    expect(fetchMock.mock.calls.filter((c) => (c[1] as RequestInit).method === 'PUT')).toHaveLength(2);
  });

  it('throws a generic error on other save failures', async () => {
    fetchMock.mockResolvedValue(response(507));
    await expect(
      webdavProvider.save('vault.kdbx', data, { url: 'https://dav.example.com' })
    ).rejects.toThrow('507');
  });
});

describe('webdav stat and remove', () => {
  it('stat uses HEAD and returns rev/modified', async () => {
    fetchMock.mockResolvedValue(
      response(200, { etag: '"rev-9"', 'last-modified': 'Thu, 02 Jan 2025 00:00:00 GMT' })
    );
    const stat = await webdavProvider.stat?.('vault.kdbx', { url: 'https://dav.example.com' });
    expect(requestOf(0).init.method).toBe('HEAD');
    expect(stat?.rev).toBe('"rev-9"');
    expect(stat?.modified).toBe(Date.parse('Thu, 02 Jan 2025 00:00:00 GMT'));
  });

  it('stat throws StorageNotFoundError on 404', async () => {
    fetchMock.mockResolvedValue(response(404));
    await expect(
      webdavProvider.stat?.('vault.kdbx', { url: 'https://dav.example.com' })
    ).rejects.toBeInstanceOf(StorageNotFoundError);
  });

  it('remove tolerates 404 but throws on other failures', async () => {
    fetchMock.mockResolvedValue(response(404));
    await expect(
      webdavProvider.remove?.('vault.kdbx', { url: 'https://dav.example.com' })
    ).resolves.toBeUndefined();
    expect(requestOf(0).init.method).toBe('DELETE');

    fetchMock.mockResolvedValue(response(423, {}, null));
    await expect(
      webdavProvider.remove?.('vault.kdbx', { url: 'https://dav.example.com' })
    ).rejects.toThrow('423');
  });
});

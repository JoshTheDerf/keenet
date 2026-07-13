/** WebDAV storage provider using fetch + Basic auth. */
import type {
  StorageProvider,
  StorageLoadResult,
  StorageFileStat,
  StorageConfigField
} from './types';
import { StorageConflictError, StorageNotFoundError } from './errors';

function authHeader(config?: Record<string, string>): Record<string, string> {
  if (config?.user) {
    const token = btoa(`${config.user}:${config.password ?? ''}`);
    return { Authorization: `Basic ${token}` };
  }
  return {};
}

function fullUrl(path: string, config?: Record<string, string>): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base = (config?.url ?? '').replace(/\/$/, '');
  return `${base}/${path.replace(/^\//, '')}`;
}

/** Create each missing ancestor collection of `url` via MKCOL (best-effort). */
async function ensureCollections(url: string, config?: Record<string, string>): Promise<void> {
  const u = new URL(url);
  const segments = u.pathname.split('/').filter(Boolean);
  segments.pop(); // drop the file name; only create directories
  let prefix = `${u.origin}`;
  for (const seg of segments) {
    prefix += `/${seg}`;
    // 201 = created, 405 = already exists — both are fine to continue past.
    await fetch(`${prefix}/`, { method: 'MKCOL', headers: { ...authHeader(config) } }).catch(
      () => undefined
    );
  }
}

export const webdavProvider: StorageProvider = {
  type: 'webdav',
  title: 'WebDAV',
  icon: 'i-lucide-server',
  enabled: true,
  needsConfig: true,
  configFields: [
    { id: 'url', title: 'File URL', type: 'url', placeholder: 'https://dav.example.com/vault.kdbx', required: true },
    { id: 'user', title: 'Username', type: 'text' },
    { id: 'password', title: 'Password', type: 'password' }
  ] as StorageConfigField[],

  async load(path: string, config?: Record<string, string>): Promise<StorageLoadResult> {
    const url = fullUrl(path, config);
    const res = await fetch(url, { headers: { ...authHeader(config) } });
    if (res.status === 404) throw new StorageNotFoundError('webdav');
    if (!res.ok) throw new Error(`WebDAV load failed: ${res.status} ${res.statusText}`);
    const data = await res.arrayBuffer();
    return {
      data,
      stat: {
        rev: res.headers.get('etag') ?? undefined,
        modified: Date.parse(res.headers.get('last-modified') ?? '') || undefined
      }
    };
  },

  async save(
    path: string,
    data: ArrayBuffer,
    config?: Record<string, string>,
    rev?: string
  ): Promise<StorageFileStat> {
    const url = fullUrl(path, config);
    const headers: Record<string, string> = {
      ...authHeader(config),
      'Content-Type': 'application/octet-stream'
    };
    // Conditional write: only overwrite the revision we last saw.
    if (rev) headers['If-Match'] = rev;

    let res = await fetch(url, { method: 'PUT', headers, body: data });
    // 409 usually means an intermediate collection is missing (e.g. a backup
    // subfolder). Create the parents and retry once.
    if (res.status === 409) {
      await ensureCollections(url, config);
      res = await fetch(url, { method: 'PUT', headers, body: data });
    }
    if (res.status === 412) throw new StorageConflictError('webdav');
    if (!res.ok) throw new Error(`WebDAV save failed: ${res.status} ${res.statusText}`);
    return { rev: res.headers.get('etag') ?? undefined };
  },

  async stat(path: string, config?: Record<string, string>): Promise<StorageFileStat> {
    const url = fullUrl(path, config);
    const res = await fetch(url, { method: 'HEAD', headers: { ...authHeader(config) } });
    if (res.status === 404) throw new StorageNotFoundError('webdav');
    if (!res.ok) throw new Error(`WebDAV stat failed: ${res.status}`);
    return {
      rev: res.headers.get('etag') ?? undefined,
      modified: Date.parse(res.headers.get('last-modified') ?? '') || undefined
    };
  },

  async remove(path: string, config?: Record<string, string>): Promise<void> {
    const url = fullUrl(path, config);
    const res = await fetch(url, { method: 'DELETE', headers: { ...authHeader(config) } });
    if (!res.ok && res.status !== 404) {
      throw new Error(`WebDAV delete failed: ${res.status} ${res.statusText}`);
    }
  }
};

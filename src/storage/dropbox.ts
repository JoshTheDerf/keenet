/** Dropbox storage provider (OAuth 2.0 Authorization Code + PKCE). */
import type {
  StorageProvider,
  StorageLoadResult,
  StorageFileStat,
  StorageDirEntry
} from './types';
import { createOAuthProviderAuth } from './oauth-provider';
import { StorageConflictError, StorageNotFoundError } from './errors';

const AUTH_URL = 'https://www.dropbox.com/oauth2/authorize';
const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';

const auth = createOAuthProviderAuth({
  provider: 'dropbox',
  title: 'Dropbox',
  authUrl: AUTH_URL,
  tokenUrl: TOKEN_URL,
  scope: '',
  defaultClientId: import.meta.env.VITE_DROPBOX_CLIENT_ID ?? '',
  credentialLabel: 'Dropbox app key',
  extraAuthParams: { token_access_type: 'offline' }
});

/** Override the embedded client id (e.g. for a self-hosted origin). */
export function configureDropbox(overrides: { clientId?: string }): void {
  auth.configure(overrides);
}

interface DropboxEntry {
  '.tag': 'file' | 'folder' | 'deleted';
  name: string;
  path_lower?: string;
  path_display?: string;
  rev?: string;
  server_modified?: string;
}

interface DropboxListResult {
  entries: DropboxEntry[];
}

interface DropboxMetadata {
  rev?: string;
  server_modified?: string;
}

function entryPath(e: DropboxEntry): string {
  return e.path_display ?? e.path_lower ?? `/${e.name}`;
}

async function rpc<T>(url: string, arg: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...(await auth.authHeader()), 'Content-Type': 'application/json' },
    body: JSON.stringify(arg)
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Dropbox request failed: ${res.status} ${res.statusText} ${text}`.trim());
  }
  return (await res.json()) as T;
}

export const dropboxProvider: StorageProvider = {
  type: 'dropbox',
  title: 'Dropbox',
  icon: 'i-lucide-cloud',
  enabled: true,
  oauth: true,
  needsConfig: false,

  isAuthorized(): boolean {
    return auth.isAuthorized();
  },

  authorize(): Promise<void> {
    return auth.authorize();
  },

  logout(): void {
    auth.logout();
  },

  async list(dir: string): Promise<StorageDirEntry[]> {
    // Dropbox uses "" for the root, not "/".
    const path = dir && dir !== '/' ? dir : '';
    const result = await rpc<DropboxListResult>(
      'https://api.dropboxapi.com/2/files/list_folder',
      { path }
    );
    return result.entries
      .filter((e) => e['.tag'] === 'file' || e['.tag'] === 'folder')
      .map((e) => ({
        name: e.name,
        path: entryPath(e),
        dir: e['.tag'] === 'folder',
        rev: e.rev
      }));
  },

  async load(path: string): Promise<StorageLoadResult> {
    const res = await fetch('https://content.dropboxapi.com/2/files/download', {
      method: 'POST',
      headers: {
        ...(await auth.authHeader()),
        'Dropbox-API-Arg': JSON.stringify({ path })
      }
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (res.status === 409 && text.includes('not_found')) {
        throw new StorageNotFoundError('dropbox');
      }
      throw new Error(`Dropbox load failed: ${res.status} ${res.statusText} ${text}`.trim());
    }
    const data = await res.arrayBuffer();
    let rev: string | undefined;
    let modified: number | undefined;
    const resultHeader = res.headers.get('Dropbox-API-Result');
    if (resultHeader) {
      const meta = JSON.parse(resultHeader) as DropboxMetadata;
      rev = meta.rev;
      modified = meta.server_modified ? Date.parse(meta.server_modified) || undefined : undefined;
    }
    return { data, stat: { rev, modified } };
  },

  async save(
    path: string,
    data: ArrayBuffer,
    _config?: Record<string, string>,
    rev?: string
  ): Promise<StorageFileStat> {
    // With a rev, upload in `update` mode: Dropbox rejects (409 path/conflict)
    // if the file has moved on from that rev instead of forking a
    // "conflicted copy". Without one, plain overwrite.
    const mode = rev ? { '.tag': 'update', update: rev } : 'overwrite';
    const res = await fetch('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: {
        ...(await auth.authHeader()),
        'Dropbox-API-Arg': JSON.stringify({ path, mode, mute: true }),
        'Content-Type': 'application/octet-stream'
      },
      body: data
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (res.status === 409 && text.includes('conflict')) {
        throw new StorageConflictError('dropbox');
      }
      throw new Error(`Dropbox save failed: ${res.status} ${res.statusText} ${text}`.trim());
    }
    const meta = (await res.json()) as DropboxMetadata;
    return {
      rev: meta.rev,
      modified: meta.server_modified ? Date.parse(meta.server_modified) || undefined : undefined
    };
  },

  async remove(path: string): Promise<void> {
    try {
      await rpc('https://api.dropboxapi.com/2/files/delete_v2', { path });
    } catch (e) {
      // Already gone is fine; anything else propagates.
      if (!(e instanceof Error && e.message.includes('not_found'))) throw e;
    }
  },

  async stat(path: string): Promise<StorageFileStat> {
    const meta = await rpc<DropboxMetadata>(
      'https://api.dropboxapi.com/2/files/get_metadata',
      { path }
    );
    return {
      rev: meta.rev,
      modified: meta.server_modified ? Date.parse(meta.server_modified) || undefined : undefined
    };
  }
};

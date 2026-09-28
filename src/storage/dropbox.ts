/** Dropbox storage provider (OAuth 2.0 Authorization Code + PKCE). */
import type {
  StorageProvider,
  StorageLoadResult,
  StorageFileStat,
  StorageDirEntry
} from './types';
import { createOAuthProviderAuth, parseTimestamp, statusOf } from './oauth-provider';
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
  cursor: string;
  has_more: boolean;
}

interface DropboxMetadata {
  rev?: string;
  server_modified?: string;
}

function entryPath(e: DropboxEntry): string {
  return e.path_display ?? e.path_lower ?? `/${e.name}`;
}

function toStat(meta: DropboxMetadata): StorageFileStat {
  return { rev: meta.rev, modified: parseTimestamp(meta.server_modified) };
}

/**
 * Whether `e` is a Dropbox endpoint error (HTTP 409) whose error summary
 * contains `tag` (e.g. `not_found`, `conflict`). apiFetch puts the response
 * body in the message.
 */
function isApiError(e: unknown, tag: string): boolean {
  return statusOf(e) === 409 && e instanceof Error && e.message.includes(tag);
}

async function rpc<T>(url: string, arg: unknown): Promise<T> {
  const res = await auth.apiFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(arg)
  });
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
    let result = await rpc<DropboxListResult>('https://api.dropboxapi.com/2/files/list_folder', {
      path
    });
    const entries = [...result.entries];
    while (result.has_more) {
      result = await rpc<DropboxListResult>(
        'https://api.dropboxapi.com/2/files/list_folder/continue',
        { cursor: result.cursor }
      );
      entries.push(...result.entries);
    }
    return entries
      .filter((e) => e['.tag'] === 'file' || e['.tag'] === 'folder')
      .map((e) => ({
        name: e.name,
        path: entryPath(e),
        dir: e['.tag'] === 'folder',
        rev: e.rev
      }));
  },

  async load(path: string): Promise<StorageLoadResult> {
    let res: Response;
    try {
      res = await auth.apiFetch('https://content.dropboxapi.com/2/files/download', {
        method: 'POST',
        headers: { 'Dropbox-API-Arg': JSON.stringify({ path }) }
      });
    } catch (e) {
      if (isApiError(e, 'not_found')) throw new StorageNotFoundError('dropbox');
      throw e;
    }
    const data = await res.arrayBuffer();
    const resultHeader = res.headers.get('Dropbox-API-Result');
    const stat = resultHeader ? toStat(JSON.parse(resultHeader) as DropboxMetadata) : {};
    return { data, stat };
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
    let res: Response;
    try {
      res = await auth.apiFetch('https://content.dropboxapi.com/2/files/upload', {
        method: 'POST',
        headers: {
          'Dropbox-API-Arg': JSON.stringify({ path, mode, mute: true }),
          'Content-Type': 'application/octet-stream'
        },
        body: data
      });
    } catch (e) {
      if (isApiError(e, 'conflict')) throw new StorageConflictError('dropbox');
      throw e;
    }
    return toStat((await res.json()) as DropboxMetadata);
  },

  async remove(path: string): Promise<void> {
    try {
      await rpc('https://api.dropboxapi.com/2/files/delete_v2', { path });
    } catch (e) {
      // Already gone is fine; anything else propagates.
      if (!isApiError(e, 'not_found')) throw e;
    }
  },

  async stat(path: string): Promise<StorageFileStat> {
    try {
      return toStat(
        await rpc<DropboxMetadata>('https://api.dropboxapi.com/2/files/get_metadata', { path })
      );
    } catch (e) {
      if (isApiError(e, 'not_found')) throw new StorageNotFoundError('dropbox');
      throw e;
    }
  }
};

/** OneDrive storage provider (OAuth 2.0 Authorization Code + PKCE, public client). */
import type {
  StorageProvider,
  StorageLoadResult,
  StorageFileStat,
  StorageDirEntry
} from './types';
import { createOAuthProviderAuth, statusOf } from './oauth-provider';
import { StorageConflictError, StorageNotFoundError } from './errors';

const AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const SCOPE = 'files.readwrite offline_access';
const BASE = 'https://graph.microsoft.com/v1.0/me';

const auth = createOAuthProviderAuth({
  provider: 'onedrive',
  title: 'OneDrive',
  authUrl: AUTH_URL,
  tokenUrl: TOKEN_URL,
  scope: SCOPE,
  defaultClientId: import.meta.env.VITE_ONEDRIVE_CLIENT_ID ?? '',
  credentialLabel: 'Azure app client ID'
});

/** Override the embedded client id (e.g. for a self-hosted origin). */
export function configureOneDrive(overrides: { clientId?: string }): void {
  auth.configure(overrides);
}

const apiFetch = auth.apiFetch;

interface DriveItem {
  id: string;
  name: string;
  eTag?: string;
  lastModifiedDateTime?: string;
  folder?: { childCount?: number };
  '@microsoft.graph.downloadUrl'?: string;
}

interface DriveItemList {
  value: DriveItem[];
}

/** A path containing a slash is treated as a drive path; otherwise as an item id. */
function itemUrl(path: string): string {
  if (path.includes('/')) {
    return `${BASE}/drive/root:/${path.replace(/^\/+/, '')}:`;
  }
  return `${BASE}/drive/items/${encodeURIComponent(path)}`;
}

function toStat(item: DriveItem): StorageFileStat {
  return {
    rev: item.eTag,
    modified: item.lastModifiedDateTime
      ? Date.parse(item.lastModifiedDateTime) || undefined
      : undefined
  };
}

export const onedriveProvider: StorageProvider = {
  type: 'onedrive',
  title: 'OneDrive',
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
    const url = dir
      ? `${BASE}/drive/root:/${dir.replace(/^\/+/, '')}:/children`
      : `${BASE}/drive/root/children`;
    const res = await apiFetch(url);
    const json = (await res.json()) as DriveItemList;
    return json.value.map((item) => ({
      name: item.name,
      path: item.id,
      dir: !!item.folder,
      rev: item.eTag
    }));
  },

  async load(path: string): Promise<StorageLoadResult> {
    // Fetch metadata first (for stat + a pre-authenticated download URL).
    let metaRes: Response;
    try {
      metaRes = await apiFetch(itemUrl(path));
    } catch (e) {
      if (statusOf(e) === 404) throw new StorageNotFoundError('onedrive');
      throw e;
    }
    const item = (await metaRes.json()) as DriveItem;
    const downloadUrl = item['@microsoft.graph.downloadUrl'];

    let data: ArrayBuffer;
    if (downloadUrl) {
      // downloadUrl is pre-authenticated; do not send the bearer token.
      const dlRes = await fetch(downloadUrl);
      if (!dlRes.ok) {
        throw new Error(`OneDrive load failed: ${dlRes.status} ${dlRes.statusText}`);
      }
      data = await dlRes.arrayBuffer();
    } else {
      const contentRes = await apiFetch(`${itemUrl(path)}/content`);
      data = await contentRes.arrayBuffer();
    }
    return { data, stat: toStat(item) };
  },

  async save(
    path: string,
    data: ArrayBuffer,
    _config?: Record<string, string>,
    rev?: string
  ): Promise<StorageFileStat> {
    const url = path.includes('/')
      ? `${BASE}/drive/root:/${path.replace(/^\/+/, '')}:/content`
      : `${BASE}/drive/items/${encodeURIComponent(path)}/content`;
    const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream' };
    // Conditional overwrite: 412 if the eTag moved on since our merge base.
    if (rev) headers['If-Match'] = rev;
    let res: Response;
    try {
      res = await apiFetch(url, { method: 'PUT', headers, body: data });
    } catch (e) {
      if (statusOf(e) === 412) throw new StorageConflictError('onedrive');
      throw e;
    }
    const item = (await res.json()) as DriveItem;
    return toStat(item);
  },

  async stat(path: string): Promise<StorageFileStat> {
    const res = await apiFetch(itemUrl(path));
    const item = (await res.json()) as DriveItem;
    return toStat(item);
  },

  async remove(path: string): Promise<void> {
    const url = path.includes('/')
      ? `${BASE}/drive/root:/${path.replace(/^\/+/, '')}:`
      : `${BASE}/drive/items/${encodeURIComponent(path)}`;
    try {
      await apiFetch(url, { method: 'DELETE' });
    } catch (e) {
      if (statusOf(e) !== 404) throw e;
    }
  }
};

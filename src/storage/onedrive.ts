/** OneDrive storage provider (OAuth 2.0 Authorization Code + PKCE, public client). */
import type {
  StorageProvider,
  StorageLoadResult,
  StorageFileStat,
  StorageDirEntry
} from './types';
import { createOAuthProviderAuth, parseTimestamp, statusOf } from './oauth-provider';
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
  '@odata.nextLink'?: string;
}

/**
 * A path containing a slash is treated as a drive path (a leading slash makes a
 * top-level name a path, e.g. `/Backups`); otherwise as an item id, which is
 * what {@link onedriveProvider.list} hands out.
 */
function itemUrl(path: string): string {
  if (path.includes('/')) {
    const segments = path.split('/').filter(Boolean).map(encodeURIComponent);
    return `${BASE}/drive/root:/${segments.join('/')}:`;
  }
  return `${BASE}/drive/items/${encodeURIComponent(path)}`;
}

function toStat(item: DriveItem): StorageFileStat {
  return { rev: item.eTag, modified: parseTimestamp(item.lastModifiedDateTime) };
}

/** GET item metadata, mapping 404 to {@link StorageNotFoundError}. */
async function getItem(path: string): Promise<DriveItem> {
  try {
    return (await (await apiFetch(itemUrl(path))).json()) as DriveItem;
  } catch (e) {
    if (statusOf(e) === 404) throw new StorageNotFoundError('onedrive');
    throw e;
  }
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
    // `dir` is either empty (root), an item id from a previous listing, or a
    // slash path (backup rotation). Graph pages children via @odata.nextLink.
    let url: string | undefined = dir ? `${itemUrl(dir)}/children` : `${BASE}/drive/root/children`;
    const items: DriveItem[] = [];
    while (url) {
      const json = (await (await apiFetch(url)).json()) as DriveItemList;
      items.push(...json.value);
      url = json['@odata.nextLink'];
    }
    return items.map((item) => ({
      name: item.name,
      path: item.id,
      dir: !!item.folder,
      rev: item.eTag
    }));
  },

  async load(path: string): Promise<StorageLoadResult> {
    // Fetch metadata first (for stat + a pre-authenticated download URL).
    const item = await getItem(path);
    const downloadUrl = item['@microsoft.graph.downloadUrl'];

    let data: ArrayBuffer;
    if (downloadUrl) {
      // downloadUrl is pre-authenticated; do not send the bearer token.
      const dlRes = await fetch(downloadUrl, { cache: 'no-store' });
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
    const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream' };
    // Conditional overwrite: 412 if the eTag moved on since our merge base.
    if (rev) headers['If-Match'] = rev;
    let res: Response;
    try {
      res = await apiFetch(`${itemUrl(path)}/content`, { method: 'PUT', headers, body: data });
    } catch (e) {
      if (statusOf(e) === 412) throw new StorageConflictError('onedrive');
      throw e;
    }
    return toStat((await res.json()) as DriveItem);
  },

  async stat(path: string): Promise<StorageFileStat> {
    return toStat(await getItem(path));
  },

  async remove(path: string): Promise<void> {
    try {
      await apiFetch(itemUrl(path), { method: 'DELETE' });
    } catch (e) {
      if (statusOf(e) !== 404) throw e;
    }
  }
};

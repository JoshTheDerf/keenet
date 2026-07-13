/** Google Drive storage provider (OAuth 2.0 Authorization Code + PKCE). */
import type {
  StorageProvider,
  StorageLoadResult,
  StorageFileStat,
  StorageDirEntry
} from './types';
import { createOAuthProviderAuth, statusOf } from './oauth-provider';
import { StorageConflictError, StorageNotFoundError } from './errors';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const BASE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

const auth = createOAuthProviderAuth({
  provider: 'gdrive',
  title: 'Google Drive',
  authUrl: AUTH_URL,
  tokenUrl: TOKEN_URL,
  scope: SCOPE,
  defaultClientId: import.meta.env.VITE_GDRIVE_CLIENT_ID ?? '',
  credentialLabel: 'Google OAuth client ID',
  extraAuthParams: { access_type: 'offline', prompt: 'consent' }
});

/** Override the embedded client id (e.g. for a self-hosted origin). */
export function configureGDrive(overrides: { clientId?: string }): void {
  auth.configure(overrides);
}

const apiFetch = auth.apiFetch;

interface DriveFile {
  id: string;
  name: string;
  mimeType?: string;
  modifiedTime?: string;
  headRevisionId?: string;
}

interface DriveFileList {
  files?: DriveFile[];
}

export const gdriveProvider: StorageProvider = {
  type: 'gdrive',
  title: 'Google Drive',
  icon: 'i-lucide-hard-drive',
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
    const clauses = ['trashed = false'];
    if (dir) {
      // `dir` is a Drive file id — enforce that shape rather than trying to
      // escape arbitrary strings into the query language.
      if (!/^[\w-]+$/.test(dir)) {
        throw new Error(`Invalid Google Drive folder id: ${dir}`);
      }
      clauses.push(`'${dir}' in parents`);
    }
    // Folders (for navigation) plus .kdbx files.
    clauses.push(`(mimeType = '${FOLDER_MIME}' or name contains '.kdbx')`);
    const params = new URLSearchParams({
      q: clauses.join(' and '),
      fields: 'files(id,name,mimeType,modifiedTime)',
      pageSize: '1000'
    });
    const res = await apiFetch(`${BASE}/files?${params.toString()}`);
    const json = (await res.json()) as DriveFileList;
    return (json.files ?? []).map((f) => ({
      name: f.name,
      path: f.id,
      dir: f.mimeType === FOLDER_MIME,
      rev: f.headRevisionId
    }));
  },

  async load(path: string): Promise<StorageLoadResult> {
    try {
      const res = await apiFetch(`${BASE}/files/${encodeURIComponent(path)}?alt=media`);
      const data = await res.arrayBuffer();
      const stat = await this.stat!(path);
      return { data, stat };
    } catch (e) {
      if (statusOf(e) === 404) throw new StorageNotFoundError('gdrive');
      throw e;
    }
  },

  async save(
    path: string,
    data: ArrayBuffer,
    _config?: Record<string, string>,
    rev?: string
  ): Promise<StorageFileStat> {
    if (path) {
      // Drive v3 doesn't expose the HTTP ETag through the API, so optimistic
      // concurrency is a check-then-write: compare the current head revision to
      // the one we based our merge on and bail if it moved. (Small TOCTOU
      // window; the sync loop re-pulls and retries on conflict.)
      if (rev) {
        const current = await this.stat!(path);
        if (current.rev && current.rev !== rev) throw new StorageConflictError('gdrive');
      }
      // Update existing file contents by id.
      await apiFetch(`${UPLOAD}/files/${encodeURIComponent(path)}?uploadType=media`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: data
      });
      return this.stat!(path);
    }

    // Create a new file: multipart (metadata + media).
    const name = _config?.name ?? 'database.kdbx';
    const boundary = `keeweb-${Math.random().toString(36).slice(2)}`;
    const metadata = JSON.stringify({ name });
    const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`;
    const tail = `\r\n--${boundary}--`;
    const enc = new TextEncoder();
    const headBytes = enc.encode(head);
    const tailBytes = enc.encode(tail);
    const dataBytes = new Uint8Array(data);
    const bodyBytes = new Uint8Array(headBytes.length + dataBytes.length + tailBytes.length);
    bodyBytes.set(headBytes, 0);
    bodyBytes.set(dataBytes, headBytes.length);
    bodyBytes.set(tailBytes, headBytes.length + dataBytes.length);

    const res = await apiFetch(`${UPLOAD}/files?uploadType=multipart&fields=id,modifiedTime,headRevisionId`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: bodyBytes
    });
    const created = (await res.json()) as DriveFile;
    return {
      rev: created.headRevisionId,
      modified: created.modifiedTime ? Date.parse(created.modifiedTime) || undefined : undefined
    };
  },

  async stat(path: string): Promise<StorageFileStat> {
    const res = await apiFetch(
      `${BASE}/files/${encodeURIComponent(path)}?fields=modifiedTime,headRevisionId`
    );
    const file = (await res.json()) as DriveFile;
    return {
      rev: file.headRevisionId,
      modified: file.modifiedTime ? Date.parse(file.modifiedTime) || undefined : undefined
    };
  },

  async remove(path: string): Promise<void> {
    // `path` is a file id here.
    try {
      await apiFetch(`${BASE}/files/${encodeURIComponent(path)}`, { method: 'DELETE' });
    } catch (e) {
      if (statusOf(e) !== 404) throw e;
    }
  }
};

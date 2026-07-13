/**
 * File System Access API storage backend.
 *
 * Unlike the one-shot local file open (`storage/local.ts`), this provider grants
 * persistent access to a *directory*: the `FileSystemDirectoryHandle` is
 * structured-clone-serialized into IndexedDB, so after a reload we can
 * re-request permission and keep listing/loading/saving `.kdbx` files in place —
 * a true local-folder backend, no re-picking required.
 */
import type {
  StorageProvider,
  StorageLoadResult,
  StorageFileStat,
  StorageDirEntry
} from './types';
import { StorageConflictError, StorageNotFoundError } from './errors';

interface FsDirWindow {
  showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
}

// Minimal typings for the permission API not always present in lib.dom.
interface HandleWithPermissions {
  queryPermission?: (d: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (d: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
}

const HANDLE_DB = 'keeweb-fs';
const HANDLE_STORE = 'handles';
const HANDLE_KEY = 'root-dir';

export function supportsFileSystemAccess(): boolean {
  return typeof (window as unknown as FsDirWindow).showDirectoryPicker === 'function';
}

function openHandleDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(HANDLE_DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(HANDLE_STORE)) {
        req.result.createObjectStore(HANDLE_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openHandleDb();
  return new Promise<T | undefined>((resolve, reject) => {
    const req = db.transaction(HANDLE_STORE, 'readonly').objectStore(HANDLE_STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openHandleDb();
  await new Promise<void>((resolve, reject) => {
    const req = db.transaction(HANDLE_STORE, 'readwrite').objectStore(HANDLE_STORE).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function idbDel(key: string): Promise<void> {
  const db = await openHandleDb();
  await new Promise<void>((resolve, reject) => {
    const req = db.transaction(HANDLE_STORE, 'readwrite').objectStore(HANDLE_STORE).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

let cachedDir: FileSystemDirectoryHandle | null = null;

async function ensurePermission(
  handle: FileSystemDirectoryHandle,
  mode: 'read' | 'readwrite'
): Promise<boolean> {
  const h = handle as unknown as HandleWithPermissions;
  if (!h.queryPermission) return true; // permission API unavailable → assume granted
  if ((await h.queryPermission({ mode })) === 'granted') return true;
  return (await h.requestPermission?.({ mode })) === 'granted';
}

async function getDir(interactive: boolean, mode: 'read' | 'readwrite' = 'readwrite'): Promise<FileSystemDirectoryHandle | null> {
  if (cachedDir && (await ensurePermission(cachedDir, mode))) return cachedDir;

  const stored = await idbGet<FileSystemDirectoryHandle>(HANDLE_KEY);
  if (stored) {
    if (await ensurePermission(stored, mode)) {
      cachedDir = stored;
      return stored;
    }
  }

  if (!interactive) return null;
  const w = window as unknown as FsDirWindow;
  if (!w.showDirectoryPicker) throw new Error('File System Access API not supported in this browser');
  const dir = await w.showDirectoryPicker({ mode: 'readwrite' });
  if (!(await ensurePermission(dir, mode))) throw new Error('Permission denied for the selected folder');
  cachedDir = dir;
  await idbSet(HANDLE_KEY, dir);
  return dir;
}

/** Prompt the user to grant access to a folder; persists the handle. */
export async function chooseFolder(): Promise<boolean> {
  const dir = await getDir(true);
  return !!dir;
}

export async function hasFolder(): Promise<boolean> {
  const stored = await idbGet<FileSystemDirectoryHandle>(HANDLE_KEY);
  return !!stored;
}

function isNotFound(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'NotFoundError';
}

/**
 * Resolve a (possibly nested, e.g. `Backups/vault.kdbx`) path to its parent
 * directory + leaf name, creating intermediate directories when `create`.
 */
async function resolveParent(
  root: FileSystemDirectoryHandle,
  path: string,
  create: boolean
): Promise<{ parent: FileSystemDirectoryHandle; name: string }> {
  const parts = path.split('/').filter(Boolean);
  const name = parts.pop() ?? path;
  let parent = root;
  for (const part of parts) {
    parent = await parent.getDirectoryHandle(part, { create });
  }
  return { parent, name };
}

async function fileHandle(
  dir: FileSystemDirectoryHandle,
  path: string,
  create = false
): Promise<FileSystemFileHandle> {
  const { parent, name } = await resolveParent(dir, path, create);
  return parent.getFileHandle(name, { create });
}

export const fileSystemProvider: StorageProvider = {
  type: 'fsaccess',
  title: 'Local Folder',
  icon: 'i-lucide-folder-open',
  enabled: true,
  needsConfig: false,

  async list(): Promise<StorageDirEntry[]> {
    const dir = await getDir(true, 'read');
    if (!dir) return [];
    const entries: StorageDirEntry[] = [];
    // `values()` is an async iterator over directory contents.
    for await (const [name, handle] of (dir as unknown as {
      entries: () => AsyncIterable<[string, FileSystemHandle]>;
    }).entries()) {
      const isDir = handle.kind === 'directory';
      if (!isDir && !name.toLowerCase().endsWith('.kdbx')) continue;
      entries.push({ name, path: name, dir: isDir });
    }
    return entries.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
  },

  async load(path: string): Promise<StorageLoadResult> {
    const dir = await getDir(true, 'read');
    if (!dir) throw new Error('No folder selected');
    let file: File;
    try {
      const handle = await fileHandle(dir, path);
      file = await handle.getFile();
    } catch (e) {
      if (isNotFound(e)) throw new StorageNotFoundError('fsaccess');
      throw e;
    }
    return { data: await file.arrayBuffer(), stat: { rev: String(file.lastModified), modified: file.lastModified } };
  },

  async save(
    path: string,
    data: ArrayBuffer,
    _config?: Record<string, string>,
    rev?: string
  ): Promise<StorageFileStat> {
    const dir = await getDir(true, 'readwrite');
    if (!dir) throw new Error('No folder selected');
    // Optimistic concurrency: compare the on-disk mtime to our merge base. A
    // missing file is not a conflict (first write / create).
    if (rev) {
      try {
        const existing = await (await fileHandle(dir, path)).getFile();
        if (String(existing.lastModified) !== rev) throw new StorageConflictError('fsaccess');
      } catch (e) {
        if (e instanceof StorageConflictError) throw e;
        if (!isNotFound(e)) throw e;
      }
    }
    const handle = await fileHandle(dir, path, true);
    const writable = await (handle as unknown as {
      createWritable: () => Promise<FileSystemWritableFileStream>;
    }).createWritable();
    await writable.write(data);
    await writable.close();
    const file = await handle.getFile();
    return { rev: String(file.lastModified), modified: file.lastModified };
  },

  async remove(path: string): Promise<void> {
    const dir = await getDir(false, 'readwrite');
    if (!dir) return;
    try {
      const { parent, name } = await resolveParent(dir, path, false);
      await (parent as unknown as {
        removeEntry: (name: string, opts?: { recursive?: boolean }) => Promise<void>;
      }).removeEntry(name);
    } catch (e) {
      if (!isNotFound(e)) throw e;
    }
  },

  async stat(path: string): Promise<StorageFileStat> {
    const dir = await getDir(false, 'read');
    if (!dir) throw new Error('No folder selected');
    const handle = await fileHandle(dir, path);
    const file = await handle.getFile();
    return { rev: String(file.lastModified), modified: file.lastModified };
  },

  logout(): void {
    cachedDir = null;
    void idbDel(HANDLE_KEY);
  }
};

/**
 * Capacitor Filesystem storage provider — the mobile equivalent of the desktop
 * native-file backend. Databases live under the app's Documents directory and
 * are addressed by filename. Plugins are dynamically imported so they never
 * enter the web bundle.
 */
import type { StorageProvider, StorageLoadResult, StorageFileStat, StorageDirEntry } from '@/storage/types';

function toBase64(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function fromBase64(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function fs() {
  const mod = await import('@capacitor/filesystem');
  return { Filesystem: mod.Filesystem, Directory: mod.Directory };
}

export const mobileFileProvider: StorageProvider = {
  type: 'file',
  title: 'On this device',
  icon: 'i-lucide-smartphone',
  enabled: true,
  needsConfig: false,

  async list(dir = ''): Promise<StorageDirEntry[]> {
    const { Filesystem, Directory } = await fs();
    const res = await Filesystem.readdir({ path: dir, directory: Directory.Documents });
    return res.files
      .filter((f) => f.type === 'directory' || f.name.toLowerCase().endsWith('.kdbx'))
      .map((f) => ({
        name: f.name,
        path: dir ? `${dir}/${f.name}` : f.name,
        dir: f.type === 'directory',
        rev: f.mtime ? String(f.mtime) : undefined
      }));
  },

  async load(path: string): Promise<StorageLoadResult> {
    const { Filesystem, Directory } = await fs();
    const res = await Filesystem.readFile({ path, directory: Directory.Documents });
    const data = typeof res.data === 'string' ? fromBase64(res.data) : await res.data.arrayBuffer();
    return { data, stat: {} };
  },

  async save(path: string, data: ArrayBuffer): Promise<StorageFileStat> {
    const { Filesystem, Directory } = await fs();
    await Filesystem.writeFile({
      path,
      data: toBase64(data),
      directory: Directory.Documents,
      recursive: true
    });
    return {};
  },

  async stat(path: string): Promise<StorageFileStat> {
    const { Filesystem, Directory } = await fs();
    const s = await Filesystem.stat({ path, directory: Directory.Documents });
    return { rev: String(s.mtime), modified: s.mtime };
  }
};

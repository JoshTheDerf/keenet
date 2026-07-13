/**
 * Native local-file storage provider (desktop only).
 *
 * Represents `.kdbx` files on the local filesystem addressed by their absolute
 * path, going through the `window.keeweb` desktop bridge. It reuses the `'file'`
 * StorageType. In the browser build there is no `window.keeweb`, so every call
 * throws — the browser uses the `fsaccess` provider instead. This provider is
 * only ever registered at runtime (see `@/desktop/register`) under Tauri.
 */
import type { StorageProvider, StorageLoadResult, StorageFileStat } from './types';

function bridge() {
  const kw = typeof window !== 'undefined' ? window.keeweb : undefined;
  if (!kw) throw new Error('Native file storage is only available in the KeeNet desktop app');
  return kw;
}

export const desktopFileProvider: StorageProvider = {
  type: 'file',
  title: 'Local File',
  icon: 'i-lucide-hard-drive',
  enabled: true,
  needsConfig: false,

  async load(path: string): Promise<StorageLoadResult> {
    const data = await bridge().readFile(path);
    return { data, stat: { modified: Date.now(), rev: String(data.byteLength) } };
  },

  async save(path: string, data: ArrayBuffer): Promise<StorageFileStat> {
    await bridge().writeFile(path, data);
    return { modified: Date.now(), rev: String(data.byteLength) };
  },

  async stat(path: string): Promise<StorageFileStat> {
    const data = await bridge().readFile(path);
    return { modified: Date.now(), rev: String(data.byteLength) };
  }

  // No `list`: native files are addressed individually by absolute path.
};

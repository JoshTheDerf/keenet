/** Storage provider registry. */
import type { StorageProvider } from './types';
import { webdavProvider } from './webdav';
import { dropboxProvider } from './dropbox';
import { gdriveProvider } from './gdrive';
import { onedriveProvider } from './onedrive';
import { fileSystemProvider } from './filesystem';

export const PROVIDERS: StorageProvider[] = [
  fileSystemProvider,
  webdavProvider,
  dropboxProvider,
  gdriveProvider,
  onedriveProvider
];

/** Look up a provider by its `StorageType`. */
export function getProvider(type: string): StorageProvider | undefined {
  return PROVIDERS.find((p) => p.type === type);
}

/**
 * Register an extra provider at runtime if no provider with its `type` exists.
 * Used by the desktop bootstrap to add the native `file` provider under Electron.
 */
export function registerProvider(p: StorageProvider): void {
  if (!PROVIDERS.some((existing) => existing.type === p.type)) {
    PROVIDERS.push(p);
  }
}

export { initOAuthCallback } from './oauth';
export type { StorageProvider } from './types';

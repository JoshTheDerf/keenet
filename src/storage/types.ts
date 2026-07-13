import type { StorageType } from '@/types';

export interface StorageFileStat {
  rev?: string;
  modified?: number;
}

export interface StorageDirEntry {
  name: string;
  path: string;
  dir: boolean;
  rev?: string;
}

export interface StorageLoadResult {
  data: ArrayBuffer;
  stat: StorageFileStat;
}

export interface StorageConfigField {
  id: string;
  title: string;
  type: 'text' | 'password' | 'url';
  placeholder?: string;
  required?: boolean;
}

/** A pluggable place to load/save databases from. */
export interface StorageProvider {
  readonly type: StorageType;
  readonly title: string;
  readonly icon: string;
  readonly enabled: boolean;
  /** OAuth-based providers require sign-in before listing/loading. */
  readonly oauth?: boolean;
  /** Whether the provider needs a config form before listing (e.g. WebDAV URL). */
  needsConfig: boolean;
  configFields?: StorageConfigField[];

  /** Throws {@link StorageNotFoundError} when `path` does not exist. */
  load(path: string, config?: Record<string, string>): Promise<StorageLoadResult>;
  /**
   * Write `data` to `path`.
   *
   * When `rev` is given the write is conditional (optimistic concurrency): it
   * only succeeds if the remote is still at that revision, otherwise it throws
   * {@link StorageConflictError}. When `rev` is omitted the write is
   * unconditional (last-write-wins).
   */
  save(
    path: string,
    data: ArrayBuffer,
    config?: Record<string, string>,
    rev?: string
  ): Promise<StorageFileStat>;
  stat?(path: string, config?: Record<string, string>): Promise<StorageFileStat>;
  list?(dir: string, config?: Record<string, string>): Promise<StorageDirEntry[]>;
  /** Delete a file (best-effort; used to rotate old backups). */
  remove?(path: string, config?: Record<string, string>): Promise<void>;

  // ---- OAuth providers only ----
  /** Whether a valid (or refreshable) token is currently held. */
  isAuthorized?(): boolean;
  /** Begin/complete interactive sign-in (popup). Resolves when authorized. */
  authorize?(): Promise<void>;
  /** Forget tokens. */
  logout?(): void;
}

/**
 * Typed storage errors used to drive sync control flow.
 *
 * Providers throw these so the vault store can tell apart the cases that need
 * different handling — a stale-write conflict (re-pull, re-merge, retry) versus
 * a missing remote (first push / create).
 */

/**
 * The remote copy changed since the revision we based our write on — an
 * optimistic-concurrency (If-Match) failure. `syncFile` catches this to re-pull,
 * re-merge and retry so a concurrent write is never silently overwritten.
 */
export class StorageConflictError extends Error {
  readonly storage: string;
  constructor(storage: string, message?: string) {
    super(message ?? `${storage}: the file was modified by someone else`);
    this.name = 'StorageConflictError';
    this.storage = storage;
  }
}

/** The requested path does not exist on the remote (e.g. HTTP 404). */
export class StorageNotFoundError extends Error {
  readonly storage: string;
  constructor(storage: string, message?: string) {
    super(message ?? `${storage}: not found`);
    this.name = 'StorageNotFoundError';
    this.storage = storage;
  }
}

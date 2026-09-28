/**
 * IndexedDB-backed binary cache for offline copies of opened databases.
 * Small hand-rolled wrapper (no external deps), also reused for the
 * persisted folder handle of the File System Access provider.
 */
export interface IdbKeyValueStore {
  get<T = ArrayBuffer>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  keys(): Promise<string[]>;
  clear(): Promise<void>;
}

/** A single-object-store IndexedDB database used as a key/value map. */
export function idbKeyValueStore(dbName: string, storeName: string): IdbKeyValueStore {
  let dbPromise: Promise<IDBDatabase> | null = null;

  function openDb(): Promise<IDBDatabase> {
    dbPromise ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        dbPromise = null; // allow a later retry
        reject(req.error);
      };
    });
    return dbPromise;
  }

  async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T> {
    const db = await openDb();
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      const req = fn(transaction.objectStore(storeName));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
    });
  }

  return {
    get: <T = ArrayBuffer>(key: string) => tx<T | undefined>('readonly', (s) => s.get(key)),
    async set(key, value) {
      await tx('readwrite', (s) => s.put(value, key));
    },
    async remove(key) {
      await tx('readwrite', (s) => s.delete(key));
    },
    keys: () => tx<string[]>('readonly', (s) => s.getAllKeys()),
    async clear() {
      await tx('readwrite', (s) => s.clear());
    }
  };
}

/** Offline copies and backups of opened databases. */
export const cache = idbKeyValueStore('keeweb', 'files');

/**
 * IndexedDB-backed binary cache for offline copies of opened databases.
 * Small hand-rolled wrapper (no external deps).
 */
const DB_NAME = 'keeweb';
const STORE = 'files';
const VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const req = fn(transaction.objectStore(STORE));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

export const cache = {
  async get(key: string): Promise<ArrayBuffer | undefined> {
    return tx<ArrayBuffer | undefined>('readonly', (s) => s.get(key));
  },
  async set(key: string, value: ArrayBuffer): Promise<void> {
    await tx('readwrite', (s) => s.put(value, key));
  },
  async remove(key: string): Promise<void> {
    await tx('readwrite', (s) => s.delete(key));
  },
  async keys(): Promise<string[]> {
    return tx<string[]>('readonly', (s) => s.getAllKeys() as IDBRequest) as Promise<string[]>;
  },
  async clear(): Promise<void> {
    await tx('readwrite', (s) => s.clear());
  }
};

// Tiny IndexedDB key-value store for what must survive a reload but can't
// live in the catalog folder: the folder handle itself, settings, the
// Claude key. One object store, structured-clone values (handles clone fine).

const DB_NAME = "weatherv1-web";
const STORE = "kv";

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(d.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export function idbGet<T>(key: string): Promise<T | undefined> {
  return tx("readonly", (s) => s.get(key) as IDBRequest<T | undefined>);
}

export function idbSet(key: string, value: unknown): Promise<void> {
  return tx("readwrite", (s) => s.put(value, key)).then(() => undefined);
}

export function idbDelete(key: string): Promise<void> {
  return tx("readwrite", (s) => s.delete(key)).then(() => undefined);
}

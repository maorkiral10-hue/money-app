export const DB_NAME = 'money-app';

// Bump only to add stores. Stores are never deleted here, so data from older versions survives.
const DB_SCHEMA = 2;

export const DATA_STORES = ['notes', 'meta'] as const;
export type DataStore = (typeof DATA_STORES)[number];

export interface Note {
  id: string;
  text: string;
  createdAt: string;
  appVersion: number;
}

export function openDb(name = DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_SCHEMA);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('notes')) db.createObjectStore('notes', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      if (!db.objectStoreNames.contains('safetyCopies')) db.createObjectStore('safetyCopies', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Runs `fn` in one transaction and resolves when it commits, with the result of the request `fn` returned. */
export function run<T = unknown>(
  db: IDBDatabase,
  stores: string | string[],
  mode: IDBTransactionMode,
  fn: (tx: IDBTransaction) => IDBRequest<T> | void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    const req = fn(tx);
    tx.oncomplete = () => resolve(req ? req.result : (undefined as T));
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const getMeta = <T = unknown>(db: IDBDatabase, key: string) =>
  run<T>(db, 'meta', 'readonly', tx => tx.objectStore('meta').get(key) as IDBRequest<T>);

export const setMeta = (db: IDBDatabase, key: string, value: unknown) =>
  run(db, 'meta', 'readwrite', tx => void tx.objectStore('meta').put(value, key));

export const getNotes = async (db: IDBDatabase) =>
  (await run<Note[]>(db, 'notes', 'readonly', tx => tx.objectStore('notes').getAll()))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

export const addNote = (db: IDBDatabase, note: Note) =>
  run(db, 'notes', 'readwrite', tx => void tx.objectStore('notes').put(note));

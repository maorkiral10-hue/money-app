import type { Note } from './types';
export type { Note } from './types';

export const DB_NAME = 'money-app';

// Bump only to add stores. Stores are never deleted here, so data from older versions survives.
const DB_SCHEMA = 4;

/** Stores holding records with an `id`. `meta` holds single named values. */
export const RECORD_STORES = ['notes', 'accounts', 'methods', 'categories', 'transactions', 'recurring'] as const;
export type RecordStore = (typeof RECORD_STORES)[number];
export const DATA_STORES = [...RECORD_STORES, 'meta'] as const;

export function openDb(name = DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_SCHEMA);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const store of [...RECORD_STORES, 'safetyCopies']) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
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

export const getAll = <T>(db: IDBDatabase, store: RecordStore) =>
  run<T[]>(db, store, 'readonly', tx => tx.objectStore(store).getAll());

export const putRecords = (db: IDBDatabase, store: RecordStore, records: { id: string }[]) =>
  run(db, store, 'readwrite', tx => records.forEach(r => tx.objectStore(store).put(r)));

export const deleteRecord = (db: IDBDatabase, store: RecordStore, id: string) =>
  run(db, store, 'readwrite', tx => void tx.objectStore(store).delete(id));

export const getNotes = async (db: IDBDatabase) =>
  (await getAll<Note>(db, 'notes')).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

export const addNote = (db: IDBDatabase, note: Note) => putRecords(db, 'notes', [note]);

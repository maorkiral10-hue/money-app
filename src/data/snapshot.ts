import { APP_VERSION } from '../version';
import { DATA_STORES, run, type Note } from './db';

/** Everything the user has entered, in one object. Used for backup files and safety copies alike. */
export interface Snapshot {
  format: 'money-app-backup';
  formatVersion: 1;
  appVersion: number;
  dataVersion: number;
  createdAt: string;
  stores: SnapshotStores;
}

export interface SnapshotStores {
  notes: Note[];
  meta: [IDBValidKey, unknown][];
}

export async function takeSnapshot(db: IDBDatabase): Promise<Snapshot> {
  let notes: Note[] = [];
  let metaKeys: IDBValidKey[] = [];
  let metaValues: unknown[] = [];
  await run(db, [...DATA_STORES], 'readonly', tx => {
    const n = tx.objectStore('notes').getAll();
    n.onsuccess = () => (notes = n.result);
    const k = tx.objectStore('meta').getAllKeys();
    k.onsuccess = () => (metaKeys = k.result);
    const v = tx.objectStore('meta').getAll();
    v.onsuccess = () => (metaValues = v.result);
  });
  const meta = metaKeys.map((key, i) => [key, metaValues[i]] as [IDBValidKey, unknown]);
  const dataVersion = meta.find(([key]) => key === 'dataVersion')?.[1];
  return {
    format: 'money-app-backup',
    formatVersion: 1,
    appVersion: APP_VERSION,
    dataVersion: typeof dataVersion === 'number' ? dataVersion : 1,
    createdAt: new Date().toISOString(),
    stores: { notes, meta },
  };
}

/** Replaces all user data with the snapshot's, in one transaction: either everything is replaced or nothing is. */
export function replaceData(db: IDBDatabase, snap: Snapshot): Promise<unknown> {
  return run(db, [...DATA_STORES], 'readwrite', tx => {
    const notes = tx.objectStore('notes');
    const meta = tx.objectStore('meta');
    notes.clear();
    meta.clear();
    snap.stores.notes.forEach(n => notes.put(n));
    snap.stores.meta.forEach(([key, value]) => meta.put(value, key));
  });
}

export const countRecords = (snap: Snapshot) => snap.stores.notes.length;

export function backupFileName(date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `money-app-backup-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`;
}

/** Reads a backup file's text and checks it really is one. Throws with a message fit to show the user. */
export function parseBackup(text: string): Snapshot {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('הקובץ הזה לא נראה כמו קובץ גיבוי של האפליקציה.');
  }
  const snap = data as Partial<Snapshot> | null;
  if (
    !snap ||
    snap.format !== 'money-app-backup' ||
    typeof snap.dataVersion !== 'number' ||
    !snap.stores ||
    !Array.isArray(snap.stores.notes) ||
    !Array.isArray(snap.stores.meta)
  ) {
    throw new Error('הקובץ הזה לא נראה כמו קובץ גיבוי של האפליקציה.');
  }
  return snap as Snapshot;
}

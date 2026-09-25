import { APP_VERSION } from '../version';
import { DATA_STORES, RECORD_STORES, run } from './db';
import type { Account, Category, Note, PaymentMethod, Recurring, Transaction } from './types';

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
  meta: [IDBValidKey, unknown][];
  notes: Note[];
  // Missing in data saved before data version 2; the 1→2 migration adds them
  accounts: Account[];
  methods: PaymentMethod[];
  categories: Category[];
  transactions: Transaction[];
  // Missing before data version 3
  recurring: Recurring[];
}

export async function takeSnapshot(db: IDBDatabase): Promise<Snapshot> {
  const stores = {} as Record<string, unknown[]>;
  let metaKeys: IDBValidKey[] = [];
  let metaValues: unknown[] = [];
  await run(db, [...DATA_STORES], 'readonly', tx => {
    for (const s of RECORD_STORES) {
      const r = tx.objectStore(s).getAll();
      r.onsuccess = () => (stores[s] = r.result);
    }
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
    stores: { ...(stores as unknown as SnapshotStores), meta },
  };
}

/** Replaces all user data with the snapshot's, in one transaction: either everything is replaced or nothing is. */
export function replaceData(db: IDBDatabase, snap: Snapshot): Promise<unknown> {
  return run(db, [...DATA_STORES], 'readwrite', tx => {
    for (const s of RECORD_STORES) {
      const store = tx.objectStore(s);
      store.clear();
      ((snap.stores[s] ?? []) as { id: string }[]).forEach(r => store.put(r));
    }
    const meta = tx.objectStore('meta');
    meta.clear();
    snap.stores.meta.forEach(([key, value]) => meta.put(value, key));
  });
}

export const countRecords = (snap: Snapshot) => (snap.stores.transactions?.length ?? 0) + snap.stores.notes.length;

export function backupFileName(date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `money-app-backup-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`;
}

/** Reads a backup file's text and checks it really is one. Throws with a message fit to show the user. */
export function parseBackup(text: string): Snapshot {
  const notBackup = new Error('הקובץ הזה לא נראה כמו קובץ גיבוי של האפליקציה.');
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw notBackup;
  }
  const snap = data as Partial<Snapshot> | null;
  if (!snap || snap.format !== 'money-app-backup' || typeof snap.dataVersion !== 'number' || !snap.stores) throw notBackup;
  const stores = snap.stores as unknown as Record<string, unknown>;
  if (!Array.isArray(stores.meta) || !Array.isArray(stores.notes)) throw notBackup;
  if (RECORD_STORES.some(s => s in stores && !Array.isArray(stores[s]))) throw notBackup;
  return snap as Snapshot;
}

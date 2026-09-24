import type { Snapshot, SnapshotStores } from './snapshot';

/** The shape of saved data this version of the app expects. Bump together with a new entry in MIGRATIONS. */
export const CURRENT_DATA_VERSION = 1;

/** MIGRATIONS[n] converts data from version n to n+1. Each one gets a copy and returns new data; it must never drop records. */
export type Migration = (stores: SnapshotStores) => SnapshotStores;
export const MIGRATIONS: Record<number, Migration> = {};

/** Brings a snapshot up to `target`, working on a copy so the original stays untouched. */
export function migrateSnapshot(
  snap: Snapshot,
  migrations: Record<number, Migration> = MIGRATIONS,
  target = CURRENT_DATA_VERSION,
): Snapshot {
  if (snap.dataVersion > target) {
    throw new Error('הנתונים נשמרו בגרסה חדשה יותר של האפליקציה. עדכן את האפליקציה ונסה שוב.');
  }
  let stores: SnapshotStores = structuredClone(snap.stores);
  for (let v = snap.dataVersion; v < target; v++) {
    const step = migrations[v];
    if (!step) throw new Error(`Missing data migration from version ${v}`);
    stores = step(stores);
  }
  stores.meta = stores.meta.filter(([key]) => key !== 'dataVersion');
  stores.meta.push(['dataVersion', target]);
  return { ...snap, dataVersion: target, stores };
}

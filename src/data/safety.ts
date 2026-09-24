import { APP_VERSION } from '../version';
import { run, setMeta } from './db';
import { migrateSnapshot } from './migrations';
import { replaceData, takeSnapshot, type Snapshot } from './snapshot';

export const SAFETY_COPIES_KEPT = 5;

export interface SafetyCopy {
  id: string;
  createdAt: string;
  reason: string;
  snapshot: Snapshot;
}

export async function createSafetyCopy(db: IDBDatabase, reason: string): Promise<SafetyCopy> {
  const copy: SafetyCopy = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    reason,
    snapshot: await takeSnapshot(db),
  };
  await run(db, 'safetyCopies', 'readwrite', tx => void tx.objectStore('safetyCopies').put(copy));
  const old = (await listSafetyCopies(db)).slice(SAFETY_COPIES_KEPT);
  if (old.length) {
    await run(db, 'safetyCopies', 'readwrite', tx => {
      old.forEach(c => tx.objectStore('safetyCopies').delete(c.id));
    });
  }
  return copy;
}

/** Newest first. */
export async function listSafetyCopies(db: IDBDatabase): Promise<SafetyCopy[]> {
  const all = await run<SafetyCopy[]>(db, 'safetyCopies', 'readonly', tx => tx.objectStore('safetyCopies').getAll());
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Replaces the current data with `snap` (a backup file or a safety copy).
 * The current data is saved as a safety copy first, so this can always be undone.
 */
export async function restoreSnapshot(db: IDBDatabase, snap: Snapshot, reason: string) {
  const migrated = migrateSnapshot(snap);
  await createSafetyCopy(db, reason);
  await replaceData(db, migrated);
  // The restored data may come from an older app version; it is already converted, so no extra copy on next open
  await setMeta(db, 'lastAppVersion', APP_VERSION);
}

import { setMeta } from './db';
import { backupFileName, takeSnapshot } from './snapshot';

/**
 * Saves all data to a file. On iPhone this opens the share sheet ("Save to Files" / iCloud Drive);
 * elsewhere it downloads the file. Returns false if the user cancelled.
 */
export async function exportBackup(db: IDBDatabase): Promise<boolean> {
  const snap = await takeSnapshot(db);
  const file = new File([JSON.stringify(snap, null, 2)], backupFileName(), { type: 'application/json' });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
    } catch (e) {
      if ((e as Error).name === 'AbortError') return false;
      throw e;
    }
  } else {
    const url = URL.createObjectURL(file);
    const a = Object.assign(document.createElement('a'), { href: url, download: file.name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  await setMeta(db, 'lastBackupAt', new Date().toISOString());
  return true;
}

import { APP_VERSION } from '../version';
import { getMeta, setMeta } from './db';
import { CURRENT_DATA_VERSION, migrateSnapshot } from './migrations';
import { createSafetyCopy } from './safety';
import { replaceData, takeSnapshot } from './snapshot';

/**
 * Runs every time the app opens. On the first open after an update it saves a safety copy
 * of the data, then converts the data to the new format if needed.
 */
export async function startup(db: IDBDatabase) {
  if ((await getMeta(db, 'deviceId')) === undefined) {
    await setMeta(db, 'deviceId', crypto.randomUUID());
    await setMeta(db, 'firstOpened', new Date().toISOString());
    await setMeta(db, 'dataVersion', CURRENT_DATA_VERSION);
  } else {
    const lastAppVersion = await getMeta<number>(db, 'lastAppVersion');
    const dataVersion = (await getMeta<number>(db, 'dataVersion')) ?? 1;
    if (lastAppVersion !== APP_VERSION || dataVersion < CURRENT_DATA_VERSION) {
      await createSafetyCopy(db, `לפני מעבר לגרסה ${APP_VERSION}`);
    }
    if (dataVersion < CURRENT_DATA_VERSION) {
      await replaceData(db, migrateSnapshot(await takeSnapshot(db)));
    }
  }
  await setMeta(db, 'lastAppVersion', APP_VERSION);
  const seen = (await getMeta<number[]>(db, 'versionsSeen')) ?? [];
  if (!seen.includes(APP_VERSION)) await setMeta(db, 'versionsSeen', [...seen, APP_VERSION]);
}

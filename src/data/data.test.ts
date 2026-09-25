import { describe, expect, it } from 'vitest';
import { APP_VERSION } from '../version';
import { addNote, getMeta, getNotes, openDb, setMeta, type Note } from './db';
import { CURRENT_DATA_VERSION, migrateSnapshot } from './migrations';
import { createSafetyCopy, listSafetyCopies, restoreSnapshot, SAFETY_COPIES_KEPT } from './safety';
import { parseBackup, takeSnapshot } from './snapshot';
import { startup } from './startup';

let n = 0;
const freshDb = () => openDb(`test-${++n}`);
const note = (text: string, createdAt = new Date().toISOString()): Note => ({ id: crypto.randomUUID(), text, createdAt, appVersion: 1 });

/** A database shaped like the feasibility test (versions 1–2) left it on the phone. */
async function feasibilityTestDb() {
  const db = await freshDb();
  await addNote(db, note('first', '2026-09-24T10:00:00.000Z'));
  await addNote(db, note('second', '2026-09-24T11:00:00.000Z'));
  await setMeta(db, 'deviceId', 'abc');
  await setMeta(db, 'firstOpened', '2026-09-24T09:00:00.000Z');
  await setMeta(db, 'dataVersion', 1);
  await setMeta(db, 'versionsSeen', [1, 2]);
  return db;
}

describe('startup', () => {
  it('keeps notes from the feasibility test and saves a safety copy first', async () => {
    const db = await feasibilityTestDb();
    await startup(db);
    expect((await getNotes(db)).map(x => x.text)).toEqual(['second', 'first']);
    const copies = await listSafetyCopies(db);
    expect(copies).toHaveLength(1);
    expect(copies[0].snapshot.stores.notes).toHaveLength(2);
    expect(await getMeta(db, 'versionsSeen')).toEqual([1, 2, APP_VERSION]);
    expect(await getMeta(db, 'deviceId')).toBe('abc');
  });

  it('does not make another safety copy when opened again on the same version', async () => {
    const db = await feasibilityTestDb();
    await startup(db);
    await startup(db);
    expect(await listSafetyCopies(db)).toHaveLength(1);
  });

  it('sets up a brand new install without a safety copy', async () => {
    const db = await freshDb();
    await startup(db);
    expect(await getMeta(db, 'deviceId')).toBeTypeOf('string');
    expect(await listSafetyCopies(db)).toHaveLength(0);
  });
});

describe('backup file', () => {
  it('restores exactly what was exported, on another device', async () => {
    const source = await feasibilityTestDb();
    const file = JSON.stringify(await takeSnapshot(source));

    const target = await freshDb();
    await startup(target);
    await addNote(target, note('only on target'));
    await restoreSnapshot(target, parseBackup(file), 'before import');

    expect((await getNotes(target)).map(x => x.text)).toEqual(['second', 'first']);
    // what was there before the import is kept as a safety copy
    const [copy] = await listSafetyCopies(target);
    expect(copy.reason).toBe('before import');
    expect(copy.snapshot.stores.notes.map(x => x.text)).toEqual(['only on target']);
  });

  it('restores a backup saved by version 3 (before stage 2)', async () => {
    const v3File = {
      format: 'money-app-backup', formatVersion: 1, appVersion: 3, dataVersion: 1, createdAt: '2026-09-24T12:00:00.000Z',
      stores: { notes: [note('old')], meta: [['dataVersion', 1], ['deviceId', 'abc']] },
    };
    const db = await freshDb();
    await startup(db);
    await restoreSnapshot(db, parseBackup(JSON.stringify(v3File)), 'before import');
    expect((await getNotes(db)).map(x => x.text)).toEqual(['old']);
    expect(await getMeta(db, 'dataVersion')).toBe(CURRENT_DATA_VERSION);
    const snap = await takeSnapshot(db);
    expect(snap.stores.transactions).toEqual([]);
    expect(snap.stores.accounts).toEqual([]);
    expect(snap.stores.recurring).toEqual([]);
  });

  it('rejects files that are not backups', () => {
    expect(() => parseBackup('hello')).toThrow();
    expect(() => parseBackup('{"format":"other"}')).toThrow();
  });
});

describe('safety copies', () => {
  it(`keeps only the ${SAFETY_COPIES_KEPT} newest`, async () => {
    const db = await feasibilityTestDb();
    for (let i = 0; i < SAFETY_COPIES_KEPT + 3; i++) {
      await createSafetyCopy(db, `copy ${i}`);
      await new Promise(r => setTimeout(r, 2));
    }
    const copies = await listSafetyCopies(db);
    expect(copies).toHaveLength(SAFETY_COPIES_KEPT);
    expect(copies[0].reason).toBe(`copy ${SAFETY_COPIES_KEPT + 2}`);
  });
});

describe('migrations', () => {
  it('converts step by step on a copy, leaving the original untouched', async () => {
    const snap = await takeSnapshot(await feasibilityTestDb());
    const migrations = {
      1: (s: typeof snap.stores) => ({ ...s, notes: s.notes.map(x => ({ ...x, text: x.text + '!' })) }),
      2: (s: typeof snap.stores) => ({ ...s, notes: s.notes.map(x => ({ ...x, text: x.text + '?' })) }),
    };
    const out = migrateSnapshot(snap, migrations, 3);
    expect(out.dataVersion).toBe(3);
    expect(out.stores.notes.map(x => x.text).sort()).toEqual(['first!?', 'second!?']);
    expect(out.stores.meta).toContainEqual(['dataVersion', 3]);
    expect(snap.stores.notes.map(x => x.text).sort()).toEqual(['first', 'second']);
  });

  it('refuses data from a newer app version', async () => {
    const snap = await takeSnapshot(await feasibilityTestDb());
    expect(() => migrateSnapshot({ ...snap, dataVersion: 99 })).toThrow();
  });
});

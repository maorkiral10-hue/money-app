import { useState } from 'preact/hooks';
import { exportBackup } from '../data/backup';
import { restoreSnapshot, type SafetyCopy } from '../data/safety';
import { countRecords, parseBackup } from '../data/snapshot';
import { APP_VERSION } from '../version';

const fmtDate = (iso: string) => new Date(iso).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' });

export function DataScreen(props: {
  db: IDBDatabase;
  copies: SafetyCopy[];
  lastBackupAt?: string;
  persisted: boolean | null;
  openLog: string[];
  onChange: () => void;
  onBack: () => void;
}) {
  const [message, setMessage] = useState('');

  const doExport = async () => {
    try {
      if (await exportBackup(props.db)) setMessage('הגיבוי נשמר.');
      props.onChange();
    } catch (e) {
      setMessage(`הגיבוי לא נשמר: ${(e as Error).message}`);
    }
  };

  const doImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      const snap = parseBackup(await file.text());
      const ok = confirm(
        `לשחזר את הגיבוי מ-${fmtDate(snap.createdAt)}?\n` +
          `יש בו ${countRecords(snap)} רשומות.\n` +
          'הנתונים שכרגע באפליקציה יוחלפו, אבל קודם יישמר מהם עותק בטיחות.',
      );
      if (!ok) return;
      await restoreSnapshot(props.db, snap, 'לפני ייבוא גיבוי');
      setMessage('הגיבוי שוחזר.');
      props.onChange();
    } catch (e) {
      setMessage((e as Error).message);
    }
  };

  const doRestore = async (copy: SafetyCopy) => {
    const ok = confirm(
      `לחזור לעותק מ-${fmtDate(copy.createdAt)} (${copy.reason})?\n` +
        'הנתונים שכרגע באפליקציה יוחלפו, אבל קודם יישמר מהם עותק בטיחות.',
    );
    if (!ok) return;
    try {
      await restoreSnapshot(props.db, copy.snapshot, 'לפני שחזור עותק בטיחות');
      setMessage('העותק שוחזר.');
      props.onChange();
    } catch (e) {
      setMessage((e as Error).message);
    }
  };

  return (
    <>
      <header class="top">
        <h1>גיבוי ונתונים</h1>
        <button class="link" onClick={props.onBack}>
          חזרה
        </button>
      </header>
      {message && <div class="card note">{message}</div>}

      <div class="card">
        <h2>גיבוי לקובץ</h2>
        <p class="muted">
          שומר את כל הנתונים בקובץ אחד. באייפון בחר "שמור בקבצים", ועדיף בתיקייה ב-iCloud Drive, כדי שהגיבוי יישמר גם אם הטלפון יאבד.
        </p>
        <p class="muted">{props.lastBackupAt ? `גיבוי אחרון: ${fmtDate(props.lastBackupAt)}` : 'עדיין לא בוצע גיבוי.'}</p>
        <button onClick={doExport}>שמור גיבוי</button>
        <label class="button secondary">
          שחזר מקובץ גיבוי
          <input
            type="file"
            accept="application/json,.json"
            hidden
            onChange={e => {
              doImport(e.currentTarget.files?.[0]);
              e.currentTarget.value = '';
            }}
          />
        </label>
      </div>

      <div class="card">
        <h2>עותקי בטיחות</h2>
        <p class="muted">
          האפליקציה שומרת עותק לבד לפני כל עדכון ולפני כל שחזור ({props.copies.length} מתוך 5 האחרונים). הם נשמרים בתוך הטלפון, ולכן לא מחליפים גיבוי לקובץ.
        </p>
        <ul>
          {props.copies.length === 0 && <li class="muted">עדיין אין עותקים</li>}
          {props.copies.map(c => (
            <li key={c.id} class="row">
              <div>
                {c.reason}
                <div class="muted small">
                  {fmtDate(c.createdAt)} · {countRecords(c.snapshot)} רשומות
                </div>
              </div>
              <button class="small-btn secondary" onClick={() => doRestore(c)}>
                שחזר
              </button>
            </li>
          ))}
        </ul>
      </div>

      <p class="muted small center">
        גרסה {APP_VERSION} · אחסון קבוע: {props.persisted === null ? '…' : props.persisted ? 'מאושר' : 'לא אושר'}
      </p>
      <details class="muted small">
        <summary>אבחון הזנה מהירה</summary>
        {props.openLog.slice(-5).map((line, i) => (
          <div key={i} class="ltr">
            {line}
          </div>
        ))}
      </details>
    </>
  );
}

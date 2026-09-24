import { useEffect, useState } from 'preact/hooks';
import { UpdateBanner } from './components/UpdateBanner';
import { exportBackup } from './data/backup';
import { addNote, getMeta, getNotes, openDb, type Note } from './data/db';
import { listSafetyCopies, restoreSnapshot, type SafetyCopy } from './data/safety';
import { countRecords, parseBackup } from './data/snapshot';
import { startup } from './data/startup';
import { APP_VERSION } from './version';

const fmtDate = (iso: string) => new Date(iso).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' });

function daysAgo(iso: string) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return days === 0 ? 'היום' : days === 1 ? 'אתמול' : `לפני ${days} ימים`;
}

export function App() {
  const [db, setDb] = useState<IDBDatabase | null>(null);
  const [error, setError] = useState('');
  const [screen, setScreen] = useState<'home' | 'data'>('home');
  const [notes, setNotes] = useState<Note[]>([]);
  const [lastBackupAt, setLastBackupAt] = useState<string>();
  const [copies, setCopies] = useState<SafetyCopy[]>([]);
  const [persisted, setPersisted] = useState<boolean | null>(null);

  const refresh = async (d: IDBDatabase) => {
    setNotes(await getNotes(d));
    setLastBackupAt(await getMeta<string>(d, 'lastBackupAt'));
    setCopies(await listSafetyCopies(d));
  };

  useEffect(() => {
    (async () => {
      const d = await openDb();
      await startup(d);
      setDb(d);
      await refresh(d);
      if (navigator.storage?.persist) {
        setPersisted((await navigator.storage.persisted()) || (await navigator.storage.persist()));
      }
    })().catch(e => setError(String(e)));
  }, []);

  if (error) return <div class="card">שגיאה בפתיחת הנתונים: {error}</div>;
  if (!db) return null;

  return (
    <>
      <UpdateBanner />
      {screen === 'home' ? (
        <Home db={db} notes={notes} lastBackupAt={lastBackupAt} onChange={() => refresh(db)} onOpenData={() => setScreen('data')} />
      ) : (
        <DataScreen
          db={db}
          copies={copies}
          lastBackupAt={lastBackupAt}
          persisted={persisted}
          onChange={() => refresh(db)}
          onBack={() => setScreen('home')}
        />
      )}
    </>
  );
}

function Home(props: {
  db: IDBDatabase;
  notes: Note[];
  lastBackupAt?: string;
  onChange: () => void;
  onOpenData: () => void;
}) {
  const [text, setText] = useState('');

  const save = async () => {
    if (!text.trim()) return;
    await addNote(props.db, { id: crypto.randomUUID(), text: text.trim(), createdAt: new Date().toISOString(), appVersion: APP_VERSION });
    setText('');
    props.onChange();
  };

  return (
    <>
      <header class="top">
        <h1>הכסף שלי</h1>
        <button class="link" onClick={props.onOpenData}>גיבוי ונתונים</button>
      </header>
      <button class="quiet" onClick={props.onOpenData}>
        {props.lastBackupAt ? `גיבוי אחרון: ${daysAgo(props.lastBackupAt)}` : 'עדיין לא בוצע גיבוי'}
      </button>

      <div class="card">
        <h2>הערות בדיקה</h2>
        <p class="muted">זמני: במקום הזה יופיעו ההוצאות וההכנסות בשלב 2.</p>
        <textarea value={text} onInput={e => setText(e.currentTarget.value)} placeholder="כתוב משהו" />
        <button onClick={save}>שמור</button>
      </div>

      <div class="card">
        <h2>הערות שמורות ({props.notes.length})</h2>
        <ul>
          {props.notes.length === 0 && <li class="muted">עדיין אין הערות</li>}
          {props.notes.map(n => (
            <li key={n.id}>
              {n.text}
              <div class="muted small">{fmtDate(n.createdAt)}</div>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

function DataScreen(props: {
  db: IDBDatabase;
  copies: SafetyCopy[];
  lastBackupAt?: string;
  persisted: boolean | null;
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
        <button class="link" onClick={props.onBack}>חזרה</button>
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
    </>
  );
}

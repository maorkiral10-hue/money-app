import { useEffect, useRef, useState } from 'preact/hooks';
import { UpdateBanner } from './components/UpdateBanner';
import { todayStr } from './data/dates';
import { deleteRecord, openDb, putRecords, setMeta } from './data/db';
import { listSafetyCopies, type SafetyCopy } from './data/safety';
import { startup } from './data/startup';
import { loadAll, recordDueRecurring, type AppData } from './data/store';
import { formatMoney } from './data/money';
import { presetFromClipboard, presetFromParams, quickTransaction, type QuickPreset } from './data/quick';
import type { Recurring, Transaction } from './data/types';
import { DataScreen } from './screens/DataScreen';
import { EntryForm } from './screens/EntryForm';
import { Forecast } from './screens/Forecast';
import { Home } from './screens/Home';
import { Onboarding } from './screens/Onboarding';
import { RecurringForm, RecurringList } from './screens/Recurring';
import { SettingsMenu, SettingsPageScreen, type SettingsPage } from './screens/Settings';

type Place = 'home' | 'settings' | 'forecast';
type Screen =
  | { name: Place }
  | { name: 'entry'; tx?: Transaction; preset?: QuickPreset; launch?: boolean; from: Place }
  | { name: 'recurring'; from: Place }
  | { name: 'recurringForm'; rec?: Recurring; from: Place }
  | { name: 'settingsPage'; page: SettingsPage }
  | { name: 'data'; from: Place };

/**
 * Quick entry link: …/money-app/?add=expense&amount=45&cat=סופר&pay=מקס fills in what it gives.
 * (Opened from an iPhone Shortcut the iPhone drops the "?…" part, so there the Shortcut copies the
 * same details to the clipboard instead; see data/quick.ts.)
 */
function takeQuickAddParam(): Screen | null {
  const preset = presetFromParams(new URLSearchParams(location.search));
  if (!preset) return null;
  history.replaceState(null, '', location.pathname);
  return { name: 'entry', preset, from: 'home' };
}

/** After this long away, coming back to the app opens a new entry (a quick switch keeps your place). */
const AWAY_FOR_NEW_ENTRY = 3 * 60_000;

function savedText(tx: Transaction, data: AppData) {
  const label = data.categories.find(c => c.id === tx.categoryId)?.name ?? (tx.type === 'transfer' ? 'העברה' : '');
  return `נשמר: ${formatMoney(tx.amount)} ${label}`.trim();
}

export interface Toast {
  text: string;
  /** Saved from the Shortcut without a summary screen: offer to take it back. */
  undoId?: string;
}

export function App() {
  const [db, setDb] = useState<IDBDatabase | null>(null);
  const [error, setError] = useState('');
  const [screen, setScreen] = useState<Screen>(() => takeQuickAddParam() ?? { name: 'home' });
  const screenRef = useRef(screen);
  screenRef.current = screen;
  const hiddenAt = useRef<number | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const lastPaste = useRef<{ text: string; at: number } | null>(null);
  const [data, setData] = useState<AppData | null>(null);
  const [copies, setCopies] = useState<SafetyCopy[]>([]);
  const [persisted, setPersisted] = useState<boolean | null>(null);

  const refresh = async (d = db!) => {
    let loaded = await loadAll(d);
    // Rent, standing orders and other fixed items whose date has come are recorded on open
    if (loaded.setupDone && (await recordDueRecurring(d, loaded.startDate, todayStr()))) loaded = await loadAll(d);
    setData(loaded);
    setCopies(await listSafetyCopies(d));
    return loaded;
  };

  useEffect(() => {
    (async () => {
      const d = await openDb();
      await startup(d);
      setDb(d);
      const loaded = await refresh(d);
      // Opening the app is usually to write something down
      if (loaded.setupDone && loaded.openOnEntry && screenRef.current.name === 'home') {
        setScreen({ name: 'entry', launch: true, from: 'home' });
      }
      if (navigator.storage?.persist) {
        setPersisted((await navigator.storage.persisted()) || (await navigator.storage.persist()));
      }
    })().catch(e => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  // Coming back to the app on a new day: dates like "today" and the balance must move on
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt.current = Date.now();
        return;
      }
      if (!db) return;
      const awayLong = hiddenAt.current !== null && Date.now() - hiddenAt.current > AWAY_FOR_NEW_ENTRY;
      hiddenAt.current = null;
      const quick = takeQuickAddParam();
      refresh(db).then(loaded => {
        if (quick) setScreen(quick);
        else if (awayLong && loaded.setupDone && loaded.openOnEntry && screenRef.current.name !== 'entry') {
          setToast(null);
          setScreen({ name: 'entry', launch: true, from: 'home' });
        }
      });
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [db]);

  if (error) return <div class="card">שגיאה בפתיחת הנתונים: {error}</div>;
  if (!db || !data) return null;

  const go = (s: Screen) => {
    setScreen(s);
    scrollTo(0, 0);
  };

  /** Adds what the iPhone Shortcut copied: straight away when it names everything, else via the entry screens. */
  const pasteFromShortcut = async (entry: Extract<Screen, { name: 'entry' }>): Promise<string | void> => {
    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      return 'לא הצלחתי לקרוא מהקיצור. נסה שוב, ובבועה שקופצת לחץ "הדבק".';
    }
    const preset = presetFromClipboard(text);
    if (!preset) return 'לא נמצאו פרטים מהקיצור. הפעל קודם את הקיצור, ואז לחץ כאן.';
    // A double tap shouldn't add the same thing twice
    if (lastPaste.current && lastPaste.current.text === text && Date.now() - lastPaste.current.at < 60_000) {
      return 'זה כבר נוסף הרגע.';
    }
    lastPaste.current = { text, at: Date.now() };
    // Clear it so a later tap can't add it again (the iPhone may refuse; harmless then)
    navigator.clipboard.writeText('').catch(() => {});
    const tx = quickTransaction(preset, data, todayStr());
    if (!tx) {
      // A name the app doesn't know, or something missing: continue from the first open question
      go({ ...entry, preset });
      return;
    }
    await putRecords(db, 'transactions', [tx]);
    if (tx.methodId) await setMeta(db, 'lastMethodId', tx.methodId);
    const loaded = await refresh();
    setToast({ text: savedText(tx, loaded), undoId: tx.id });
    go({ name: 'home' });
  };
  const afterChange = () => refresh();

  let content;
  if (!data.setupDone) {
    content = <Onboarding db={db} onDone={afterChange} />;
  } else if (screen.name === 'entry') {
    const entry = screen;
    const back = () => go({ name: entry.from });
    content = (
      <EntryForm
        key={entry.tx?.id ?? `new-${JSON.stringify(entry.preset ?? {})}`}
        db={db}
        data={data}
        tx={entry.tx}
        preset={entry.preset}
        launch={entry.launch}
        onPaste={() => pasteFromShortcut(entry)}
        onClose={back}
        onSaved={async saved => {
          const loaded = await refresh();
          if (saved) setToast({ text: entry.tx ? 'השינוי נשמר' : savedText(saved, loaded) });
          back();
        }}
      />
    );
  } else if (screen.name === 'recurring') {
    const from = screen.from;
    content = (
      <RecurringList
        data={data}
        onBack={() => go({ name: from })}
        onEdit={rec => go({ name: 'recurringForm', rec, from })}
        onDelete={async rec => {
          // Transactions it already recorded stay; only the schedule goes
          await deleteRecord(db, 'recurring', rec.id);
          await refresh();
        }}
      />
    );
  } else if (screen.name === 'recurringForm') {
    const from = screen.from;
    content = (
      <RecurringForm
        key={screen.rec?.id ?? 'new'}
        db={db}
        data={data}
        rec={screen.rec}
        onDone={async () => {
          await refresh();
          go({ name: 'recurring', from });
        }}
      />
    );
  } else if (screen.name === 'forecast') {
    content = (
      <Forecast
        data={data}
        onBack={() => go({ name: 'home' })}
        onEdit={tx => go({ name: 'entry', tx, from: 'forecast' })}
        onEditRecurring={rec => go({ name: 'recurringForm', rec, from: 'forecast' })}
        onOpenRecurring={() => go({ name: 'recurring', from: 'forecast' })}
      />
    );
  } else if (screen.name === 'settings') {
    content = (
      <SettingsMenu
        data={data}
        onBack={() => go({ name: 'home' })}
        onOpen={page => go({ name: 'settingsPage', page })}
        onOpenData={() => go({ name: 'data', from: 'settings' })}
        onOpenRecurring={() => go({ name: 'recurring', from: 'settings' })}
        onSetOpenOnEntry={async on => {
          await setMeta(db, 'openOnEntry', on);
          await refresh();
        }}
      />
    );
  } else if (screen.name === 'settingsPage') {
    content = <SettingsPageScreen db={db} data={data} page={screen.page} onChange={afterChange} onBack={() => go({ name: 'settings' })} />;
  } else if (screen.name === 'data') {
    const from = screen.from;
    content = (
      <DataScreen db={db} copies={copies} lastBackupAt={data.lastBackupAt} persisted={persisted} onChange={afterChange} onBack={() => go({ name: from })} />
    );
  } else {
    content = (
      <Home
        db={db}
        data={data}
        toast={toast}
        onUndo={async id => {
          await deleteRecord(db, 'transactions', id);
          setToast({ text: 'בוטל' });
          await refresh();
        }}
        onChange={afterChange}
        onAdd={() => go({ name: 'entry', from: 'home' })}
        onEdit={tx => go({ name: 'entry', tx, from: 'home' })}
        onOpenSettings={() => go({ name: 'settings' })}
        onOpenData={() => go({ name: 'data', from: 'home' })}
        onOpenForecast={() => go({ name: 'forecast' })}
      />
    );
  }

  return (
    <>
      <UpdateBanner />
      {content}
    </>
  );
}

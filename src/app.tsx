import { useEffect, useState } from 'preact/hooks';
import { UpdateBanner } from './components/UpdateBanner';
import { todayStr } from './data/dates';
import { openDb } from './data/db';
import { listSafetyCopies, type SafetyCopy } from './data/safety';
import { startup } from './data/startup';
import { loadAll, recordDueRecurring, type AppData } from './data/store';
import type { Recurring, Transaction, TxType } from './data/types';
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
  | { name: 'entry'; tx?: Transaction; startType?: TxType; from: Place }
  | { name: 'recurring'; from: Place }
  | { name: 'recurringForm'; rec?: Recurring; from: Place }
  | { name: 'settingsPage'; page: SettingsPage }
  | { name: 'data'; from: Place };

/** Quick entry link, e.g. from an iPhone Shortcut: …/money-app/?add=expense opens straight on the amount. */
function takeQuickAddParam(): Screen | null {
  const params = new URLSearchParams(location.search);
  const add = params.get('add');
  if (add === null) return null;
  history.replaceState(null, '', location.pathname);
  const startType = (['expense', 'income', 'transfer'] as const).find(t => t === add);
  return { name: 'entry', startType, from: 'home' };
}

export function App() {
  const [db, setDb] = useState<IDBDatabase | null>(null);
  const [error, setError] = useState('');
  const [screen, setScreen] = useState<Screen>(() => takeQuickAddParam() ?? { name: 'home' });
  const [data, setData] = useState<AppData | null>(null);
  const [copies, setCopies] = useState<SafetyCopy[]>([]);
  const [persisted, setPersisted] = useState<boolean | null>(null);

  const refresh = async (d = db!) => {
    let loaded = await loadAll(d);
    // Rent, standing orders and other fixed items whose date has come are recorded on open
    if (loaded.setupDone && (await recordDueRecurring(d, loaded.startDate, todayStr()))) loaded = await loadAll(d);
    setData(loaded);
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

  // Coming back to the app on a new day: dates like "today" and the balance must move on
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || !db) return;
      const quick = takeQuickAddParam();
      if (quick) setScreen(quick);
      refresh(db);
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
  const afterChange = () => refresh();

  let content;
  if (!data.setupDone) {
    content = <Onboarding db={db} onDone={afterChange} />;
  } else if (screen.name === 'entry') {
    const back = () => go({ name: screen.from });
    content = (
      <EntryForm
        key={screen.tx?.id ?? `new-${screen.startType}`}
        db={db}
        data={data}
        tx={screen.tx}
        startType={screen.startType}
        onClose={back}
        onSaved={async () => {
          await refresh();
          back();
        }}
      />
    );
  } else if (screen.name === 'recurring') {
    const from = screen.from;
    content = <RecurringList data={data} onBack={() => go({ name: from })} onEdit={rec => go({ name: 'recurringForm', rec, from })} />;
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

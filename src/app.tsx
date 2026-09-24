import { useEffect, useState } from 'preact/hooks';
import { UpdateBanner } from './components/UpdateBanner';
import { openDb } from './data/db';
import { listSafetyCopies, type SafetyCopy } from './data/safety';
import { startup } from './data/startup';
import { loadAll, type AppData } from './data/store';
import type { Transaction } from './data/types';
import { DataScreen } from './screens/DataScreen';
import { EntryForm } from './screens/EntryForm';
import { Home } from './screens/Home';
import { Onboarding } from './screens/Onboarding';
import { Settings } from './screens/Settings';

type Screen = { name: 'home' } | { name: 'entry'; tx?: Transaction } | { name: 'settings' } | { name: 'data'; from: 'home' | 'settings' };

export function App() {
  const [db, setDb] = useState<IDBDatabase | null>(null);
  const [error, setError] = useState('');
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [data, setData] = useState<AppData | null>(null);
  const [copies, setCopies] = useState<SafetyCopy[]>([]);
  const [persisted, setPersisted] = useState<boolean | null>(null);

  const refresh = async (d = db!) => {
    setData(await loadAll(d));
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
    const onVisible = () => document.visibilityState === 'visible' && db && refresh(db);
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [db]);

  if (error) return <div class="card">שגיאה בפתיחת הנתונים: {error}</div>;
  if (!db || !data) return null;

  const home = () => setScreen({ name: 'home' });
  const afterChange = async () => {
    await refresh();
  };

  let content;
  if (!data.setupDone) {
    content = <Onboarding db={db} onDone={afterChange} />;
  } else if (screen.name === 'entry') {
    content = (
      <EntryForm
        db={db}
        data={data}
        tx={screen.tx}
        onClose={home}
        onSaved={async () => {
          await refresh();
          home();
        }}
      />
    );
  } else if (screen.name === 'settings') {
    content = <Settings db={db} data={data} onChange={afterChange} onBack={home} onOpenData={() => setScreen({ name: 'data', from: 'settings' })} />;
  } else if (screen.name === 'data') {
    content = (
      <DataScreen
        db={db}
        copies={copies}
        lastBackupAt={data.lastBackupAt}
        persisted={persisted}
        onChange={afterChange}
        onBack={() => setScreen(screen.from === 'settings' ? { name: 'settings' } : { name: 'home' })}
      />
    );
  } else {
    content = (
      <Home
        data={data}
        onAdd={() => setScreen({ name: 'entry' })}
        onEdit={tx => setScreen({ name: 'entry', tx })}
        onOpenSettings={() => setScreen({ name: 'settings' })}
        onOpenData={() => setScreen({ name: 'data', from: 'home' })}
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

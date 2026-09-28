import { useEffect, useRef, useState } from 'preact/hooks';
import { UpdateBanner } from './components/UpdateBanner';
import { todayStr } from './data/dates';
import { deleteRecord, getMeta, openDb, putRecords, setMeta } from './data/db';
import { listSafetyCopies, type SafetyCopy } from './data/safety';
import { startup } from './data/startup';
import { loadAll, recordDueRecurring, relinkEditedRecurring, type AppData } from './data/store';
import { formatMoney } from './data/money';
import { presetFromParams, type QuickPreset } from './data/quick';
import type { Account, CalendarEvent, Recurring, Transaction } from './data/types';
import { DataScreen } from './screens/DataScreen';
import { EntryForm } from './screens/EntryForm';
import { TabBar, TABS, SwipeTabs, type Tab } from './components/TabBar';
import { BalanceCheck } from './screens/BalanceCheck';
import { BudgetSetup, BudgetTab } from './screens/Budget';
import { GoalDetail, GoalForm, GoalsTab } from './screens/Goals';
import { CalendarScreen, EventForm } from './screens/Calendar';
import { EventDoneCard } from './components/EventDoneCard';
import { awaitingActual, withAnswer } from './data/calendar';
import { Dashboard } from './screens/Dashboard';
import { Home } from './screens/Home';
import { Onboarding } from './screens/Onboarding';
import { RecurringForm, RecurringList } from './screens/Recurring';
import { MenuButton, SideMenu, SettingsPageScreen, type MenuSection, type MenuTarget, type SettingsPage } from './screens/Settings';

type Place = 'home' | 'budget' | 'goals' | 'dashboard' | 'settings';
type Screen =
  | { name: Place }
  | { name: 'entry'; tx?: Transaction; preset?: QuickPreset; launch?: boolean; from: Place; eventId?: string; eventDate?: string }
  | { name: 'recurring'; from: Place }
  | { name: 'recurringForm'; rec?: Recurring; from: Place }
  | { name: 'settingsPage'; page: SettingsPage }
  | { name: 'budgetSetup' }
  | { name: 'goal'; id: string }
  | { name: 'goalForm'; goal?: Account }
  | { name: 'calendar' }
  | { name: 'eventForm'; event?: CalendarEvent; date?: string; time?: string }
  | { name: 'balanceCheck'; from: Place }
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

/**
 * Coming back after this long opens a new entry: long enough to have run the iPhone Shortcut's pop-ups,
 * which the app has no other way of noticing. Screens where you are typing are never left this way.
 */
const AWAY_FOR_NEW_ENTRY = 10_000;
const TYPING_SCREENS: Screen['name'][] = ['entry', 'recurringForm', 'settingsPage', 'budgetSetup', 'goal', 'goalForm', 'eventForm'];

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
  // The main screen settings was opened from, to come back to it
  const lastTab = useRef<Tab>('home');
  if ((TABS as string[]).includes(screen.name)) lastTab.current = screen.name as Tab;
  const [menuOpen, setMenuOpen] = useState(false);
  // Calendar events asked about: checked every half minute, so one ending while the app is open pops up too
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  // "Later" on an event's question: not asked again until the app is next opened
  const [laterIds, setLaterIds] = useState<string[]>([]);
  const [menuSection, setMenuSection] = useState<MenuSection>('main');
  // Leaving the main screens (a new entry on opening the app, say) closes the menu
  useEffect(() => {
    if (!(TABS as string[]).includes(screen.name)) setMenuOpen(false);
  }, [screen.name]);
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
      // One-time repair for version 24: re-tie standing-order transactions that editing had untied
      if (!(await getMeta(d, 'relinkedRecurring'))) {
        await relinkEditedRecurring(d);
        await setMeta(d, 'relinkedRecurring', true);
      }
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
    const t = setTimeout(() => setToast(null), 5000);
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
      setNow(new Date());
      if (awayLong) setLaterIds([]);
      hiddenAt.current = null;
      const quick = takeQuickAddParam();
      refresh(db).then(loaded => {
        if (quick) setScreen(quick);
        else if (awayLong && loaded.setupDone && loaded.openOnEntry && !TYPING_SCREENS.includes(screenRef.current.name)) {
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
    // Pages opened from the side menu come back to it, open over the screen it was opened from
    if (s.name === 'settings') {
      setScreen({ name: lastTab.current });
      setMenuOpen(true);
      return;
    }
    setMenuOpen(false);
    setScreen(s);
    scrollTo(0, 0);
  };
  const openFromMenu = (target: MenuTarget) =>
    go(
      target === 'recurring'
        ? { name: 'recurring', from: 'settings' }
        : target === 'check'
          ? { name: 'balanceCheck', from: 'settings' }
          : target === 'data'
            ? { name: 'data', from: 'settings' }
            : target === 'calendar'
              ? { name: 'calendar' }
              : { name: 'settingsPage', page: target },
    );

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
        onClose={back}
        onSaved={async saved => {
          // What a calendar event came to: the event is answered, tied to the transaction
          const event = entry.eventId && saved ? data.events.find(e => e.id === entry.eventId) : undefined;
          if (event && saved) {
            await putRecords(db, 'events', [withAnswer(event, entry.eventDate ?? event.date, { at: new Date().toISOString(), txId: saved.id })]);
          }
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
  } else if (screen.name === 'settingsPage') {
    content = <SettingsPageScreen db={db} data={data} page={screen.page} onChange={afterChange} onBack={() => go({ name: 'settings' })} />;
  } else if (screen.name === 'data') {
    const from = screen.from;
    content = (
      <DataScreen db={db} copies={copies} lastBackupAt={data.lastBackupAt} persisted={persisted} onChange={afterChange} onBack={() => go({ name: from })} />
    );
  } else if (screen.name === 'balanceCheck') {
    const from = screen.from;
    content = (
      <BalanceCheck
        db={db}
        data={data}
        onBack={() => go({ name: from })}
        onChange={afterChange}
        onAddMissing={preset => go({ name: 'entry', preset, from })}
      />
    );
  } else if (screen.name === 'budgetSetup') {
    content = (
      <BudgetSetup
        db={db}
        data={data}
        onDone={async () => {
          await refresh();
          go({ name: 'budget' });
        }}
        onCancel={() => go({ name: 'budget' })}
      />
    );
  } else if (screen.name === 'calendar') {
    content = <CalendarScreen data={data} onBack={() => go({ name: 'settings' })} onEdit={(event, date, time) => go({ name: 'eventForm', event, date, time })} />;
  } else if (screen.name === 'eventForm') {
    content = (
      <EventForm
        db={db}
        event={screen.event && (data.events.find(e => e.id === screen.event!.id) ?? screen.event)}
        occurrence={screen.event?.repeat ? screen.event.date : undefined}
        date={screen.date}
        time={screen.time}
        onDone={async () => {
          await refresh();
          go({ name: 'calendar' });
        }}
        onCancel={() => go({ name: 'calendar' })}
      />
    );
  } else if (screen.name === 'goal') {
    content = (
      <GoalDetail
        key={screen.id}
        db={db}
        data={data}
        goalId={screen.id}
        onBack={() => go({ name: 'goals' })}
        onEdit={() => go({ name: 'goalForm', goal: data.accounts.find(a => a.id === (screen as { id: string }).id) })}
        onChange={afterChange}
      />
    );
  } else if (screen.name === 'goalForm') {
    const editing = screen.goal;
    content = (
      <GoalForm
        db={db}
        data={data}
        goal={editing}
        onDone={async goal => {
          await refresh();
          go(goal ? { name: 'goal', id: goal.id } : { name: 'goals' });
        }}
        onCancel={() => go(editing ? { name: 'goal', id: editing.id } : { name: 'goals' })}
      />
    );
  } else if (!(TABS as string[]).includes(screen.name)) {
    content = null;
  }

  /** A main screen, drawn for the current tab and, while dragging, for its neighbour. */
  const renderTab = (t: Tab) =>
    t === 'budget' ? (
      <BudgetTab data={data} onEdit={() => go({ name: 'budgetSetup' })} />
    ) : t === 'goals' ? (
      <GoalsTab data={data} onOpen={g => go({ name: 'goal', id: g.id })} onNew={() => go({ name: 'goalForm' })} />
    ) : t === 'dashboard' ? (
      <Dashboard data={data} onEdit={tx => go({ name: 'entry', tx, from: 'dashboard' })} />
    ) : (
      <Home
        db={db}
        data={data}
        onChange={afterChange}
        onEdit={tx => go({ name: 'entry', tx, from: 'home' })}
        onOpenData={() => go({ name: 'data', from: 'home' })}
        onOpenCheck={() => go({ name: 'balanceCheck', from: 'home' })}
        onOpenGoals={() => go({ name: 'goals' })}
      />
    );

  // The main screens share the bottom bar and can be swiped between
  const tab = data.setupDone && (TABS as string[]).includes(screen.name) ? (screen.name as Tab) : null;
  const awaiting = awaitingActual(data.events, now).filter(e => !laterIds.includes(`${e.id}|${e.date}`));
  const askEvent = awaiting[0];
  return (
    <>
      <UpdateBanner />
      {toast && (
        // key: a new message restarts the bubble's appear-and-fade
        <div key={toast.text + (toast.undoId ?? '')} class="toast-bubble" role="status">
          <span>✓ {toast.text}</span>
          {toast.undoId && (
            <button
              class="link"
              onClick={async () => {
                await deleteRecord(db, 'transactions', toast.undoId!);
                setToast({ text: 'בוטל' });
                await refresh();
              }}
            >
              ביטול
            </button>
          )}
        </div>
      )}
      {tab ? (
        <>
          {/* Stays put above the sliding screens */}
          <div class="floating-settings">
            <MenuButton
              onClick={() => {
                setMenuSection('main');
                setMenuOpen(true);
              }}
            />
          </div>
          <SwipeTabs current={tab} onSelect={t => go({ name: t })} render={renderTab} />
          <TabBar current={tab} onSelect={t => go({ name: t })} onAdd={() => go({ name: 'entry', from: tab })} />
          {askEvent && !menuOpen && (
            <EventDoneCard
              key={`${askEvent.id}|${askEvent.date}`}
              db={db}
              event={askEvent}
              series={data.events.find(e => e.id === askEvent.id) ?? askEvent}
              more={awaiting.length - 1}
              onLater={() => setLaterIds(ids => [...ids, `${askEvent.id}|${askEvent.date}`])}
              onDone={afterChange}
              onRecord={(event, amount) =>
                go({
                  name: 'entry',
                  from: tab,
                  eventId: event.id,
                  eventDate: event.date,
                  preset: { type: event.type === 'income' ? 'income' : 'expense', amount, date: event.date, note: event.title },
                })
              }
            />
          )}
          <SideMenu
            open={menuOpen}
            section={menuSection}
            data={data}
            onClose={() => setMenuOpen(false)}
            onSection={setMenuSection}
            onOpen={openFromMenu}
          />
        </>
      ) : (
        content
      )}
    </>
  );
}

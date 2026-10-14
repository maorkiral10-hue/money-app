import { useEffect, useRef, useState } from 'preact/hooks';
import { UpdateBanner } from './components/UpdateBanner';
import { addDays, todayStr } from './data/dates';
import { deleteRecord, getMeta, openDb, putRecords, setMeta } from './data/db';
import { listSafetyCopies, type SafetyCopy } from './data/safety';
import { startup } from './data/startup';
import { loadAll, recordDueRecurring, relinkEditedRecurring, type AppData } from './data/store';
import { formatMoney } from './data/money';
import { presetFromParams, type QuickPreset } from './data/quick';
import type { Account, CalendarEvent, Recurring, Transaction } from './data/types';
import { DataScreen } from './screens/DataScreen';
import { EntryForm } from './screens/EntryForm';
import { ExplainGap } from './screens/ExplainGap';
import { FundsScreen } from './screens/Funds';
import { isGapTx } from './data/reconcile';
import { TabBar, TABS, SwipeTabs, type Tab } from './components/TabBar';
import { BalanceCheck } from './screens/BalanceCheck';
import { BudgetSetup, BudgetTab } from './screens/Budget';
import { GoalDetail, GoalForm, GoalsTab } from './screens/Goals';
import { CalendarScreen, EventForm } from './screens/Calendar';
import { EventDoneCard } from './components/EventDoneCard';
import { VariableDueCard } from './components/VariableDueCard';
import { EarlyRecordCard } from './components/EarlyRecordCard';
import { CardChargeCard } from './components/CardChargeCard';
import { OpenGapCard } from './components/OpenGapCard';
import { CardGapReminder } from './components/CardGapReminder';
import { GoalReachedCard } from './components/GoalReachedCard';
import { GoalPayCard } from './components/GoalPayCard';
import { goalNumbers, overReserved } from './data/goals';
import { summarize } from './data/balance';
import { openCardGaps } from './data/cardCheck';
import { correctBalance, gapAsOf, openGaps, settleOpenGaps, sourcePreset } from './data/reconcile';
import { cardChecksDue } from './data/cardCheck';
import { RECORD_EARLY_EVENT } from './components/MoneyList';
import { openOccurrences } from './data/recurring';
import { awaitingActual, lastDayOf, potTotal, timeRoundOf, withAnswer } from './data/calendar';
import { Dashboard } from './screens/Dashboard';
import { Home } from './screens/Home';
import { Onboarding } from './screens/Onboarding';
import { RecurringForm, RecurringList } from './screens/Recurring';
import { MenuButton, SideMenu, SettingsPageScreen, type MenuSection, type MenuTarget, type SettingsPage } from './screens/Settings';

type Place = 'home' | 'budget' | 'goals' | 'dashboard' | 'settings' | 'calendar';
type Screen =
  | { name: Place }
  | {
      name: 'entry';
      tx?: Transaction;
      preset?: QuickPreset;
      launch?: boolean;
      from: Place;
      /** Recorded for a calendar event (into its pot); `settleEvent`: it answers the event's question too. */
      eventId?: string;
      eventDate?: string;
      settleEvent?: boolean;
      /** An unexplained gap's line opened as an ordinary transaction, not as "remembered what it was?". */
      plain?: boolean;
    }
  | { name: 'recurring'; from: Place }
  | { name: 'recurringForm'; rec?: Recurring; from: Place }
  | { name: 'settingsPage'; page: SettingsPage }
  | { name: 'budgetSetup' }
  | { name: 'goal'; id: string }
  | { name: 'goalForm'; goal?: Account }
  | { name: 'eventForm'; event?: CalendarEvent; date?: string; time?: string; from?: Place }
  | { name: 'balanceCheck'; from: Place; accountId?: string; recheck?: boolean }
  | { name: 'data'; from: Place }
  | { name: 'funds' };

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
  // The day chosen in the home screen's calendar: "+" records on it; a new entry's day becomes it
  const homeDay = useRef(todayStr());
  // Calendar events asked about: checked every half minute, so one ending while the app is open pops up too
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  // "Later" on an event's question: not asked again until the app is next opened
  const [laterIds, setLaterIds] = useState<string[]>([]);
  // A gap left open just got smaller (something remembered was recorded): its card says by how much
  const [gapDrop, setGapDrop] = useState<{ accountId: string; from: number } | null>(null);
  // Just recorded on account of a goal with other money: ask where the money for it comes from
  const [goalPay, setGoalPay] = useState<Transaction | null>(null);
  // Standing orders with a changing amount put off with "remind me in half an hour": until when
  const [snoozedUntil, setSnoozedUntil] = useState(0);
  // A standing order or fixed income tapped before its day: offer to record it now (it came early)
  const [early, setEarly] = useState<{ recurringId: string; occurrence: string } | null>(null);
  useEffect(() => {
    const onAsk = (e: Event) => setEarly((e as CustomEvent<{ recurringId: string; occurrence: string }>).detail);
    window.addEventListener(RECORD_EARLY_EVENT, onAsk);
    return () => window.removeEventListener(RECORD_EARLY_EVENT, onAsk);
  }, []);
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
    // Gaps left open after a check: made up in full, they close; their days over, what's left is recorded
    if (loaded.setupDone) {
      const settled = await settleOpenGaps(d, loaded, todayStr());
      if (settled.length) {
        loaded = await loadAll(d);
        const s = settled[0];
        setToast({ text: s.closed ? `🎉 הפער ב${s.account.name} נסגר! הכל מתאים` : `נרשם "לא מזוהה" של ${formatMoney(Math.abs(s.amount))} ב${s.account.name} (נגמרו ימי החיפוש)` });
      }
    }
    if (loaded.setupDone) {
      const s = summarize(loaded, todayStr());
      const over = overReserved(loaded.accounts, s.byAccount, s.goals);
      if (over.length) {
        const now = new Date().toISOString();
        await putRecords(
          d,
          'transactions',
          over.map(o => ({
            id: crypto.randomUUID(),
            type: 'transfer' as const,
            amount: o.from - o.to,
            date: todayStr(),
            accountId: o.goal.id,
            toAccountId: o.source.id,
            note: `שוחרר מ${o.goal.name}: ב${o.source.name} נשאר פחות`,
            createdAt: now,
            updatedAt: now,
          })),
        );
        loaded = await loadAll(d);
        const o = over[0];
        setToast({ text: `הכסף השמור ל${o.goal.name} ירד מ־${formatMoney(o.from)} ל־${formatMoney(o.to)}, כי ב${o.source.name} נשאר רק ${formatMoney(o.to)}. ההפרש חזר לכסף הפנוי.` });
      }
    }
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
      if (awayLong) {
        setLaterIds([]);
        homeDay.current = todayStr();
      }
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
            : target === 'funds'
              ? { name: 'funds' }
            : target === 'calendar'
              ? { name: 'calendar' }
              : { name: 'settingsPage', page: target },
    );

  const afterChange = () => refresh();

  let content;
  if (!data.setupDone) {
    content = <Onboarding db={db} onDone={afterChange} />;
  } else if (screen.name === 'entry' && screen.tx && !screen.plain && isGapTx(screen.tx, data.categories)) {
    const entry = screen;
    const gap = screen.tx;
    content = (
      <ExplainGap
        db={db}
        data={data}
        gap={gap}
        onClose={() => go({ name: entry.from })}
        onPlain={() => go({ ...entry, plain: true })}
        onSaved={async saved => {
          await refresh();
          setToast({ text: `נרשם: ${formatMoney(saved.amount)}. הפער ${saved.amount >= gap.amount ? 'נסגר' : 'קטן'}` });
          go({ name: entry.from });
        }}
      />
    );
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
        eventLink={entry.eventId && entry.eventDate ? { eventId: entry.eventId, eventDate: entry.eventDate } : undefined}
        onNewEvent={date => go({ name: 'eventForm', date, from: entry.from })}
        launch={entry.launch}
        onClose={back}
        onSaved={async saved => {
          // What a calendar event came to: the event is answered, tied to the transaction
          const event = entry.eventId && saved && entry.settleEvent ? data.events.find(e => e.id === entry.eventId) : undefined;
          if (event && saved) {
            await putRecords(db, 'events', [withAnswer(event, entry.eventDate ?? event.date, { at: new Date().toISOString(), txId: saved.id })]);
          }
          const gapsBefore = openGaps(data, todayStr());
          if (saved && saved.goalId && !entry.tx?.goalId) setGoalPay(saved);
          const loaded = await refresh();
          if (saved) setToast({ text: entry.tx ? 'השינוי נשמר' : savedText(saved, loaded) });
          // It made a gap left open smaller: say so, with how much is still missing
          const after = openGaps(loaded, todayStr());
          for (const b of gapsBefore) {
            const a = after.find(g => g.account.id === b.account.id && g.check.date === b.check.date);
            // Made up in full: it closed while saving
            if (!a && loaded.balanceChecks.some(c => c.accountId === b.account.id && c.date === b.check.date && c.result === 'closed')) {
              setToast({ text: `🎉 הפער ב${b.account.name} נסגר! הכל מתאים` });
            }
            if (a && Math.abs(a.left) < Math.abs(b.left)) {
              setGapDrop({ accountId: a.account.id, from: Math.abs(b.left) });
              setLaterIds(ids => ids.filter(id => id !== `gap|${a.account.id}|${a.check.date}`));
            }
          }
          // Back on the home screen, its calendar shows the day this was recorded on
          if (saved && !entry.tx && entry.from === 'home') homeDay.current = saved.date;
          back();
        }}
      />
    );
  } else if (screen.name === 'recurring') {
    const from = screen.from;
    content = (
      <RecurringList db={db} data={data} onBack={() => go({ name: from })} onEdit={rec => go({ name: 'recurringForm', rec, from })} onChange={afterChange} />
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
  } else if (screen.name === 'funds') {
    content = <FundsScreen db={db} data={data} onBack={() => go({ name: 'home' })} onChange={afterChange} />;
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
        accountId={screen.accountId}
        recheck={screen.recheck}
        onEdit={tx => go({ name: 'entry', tx, from })}
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
    content = <CalendarScreen
        data={data}
        onBack={() => go({ name: 'settings' })}
        onEdit={(event, date, time) => go({ name: 'eventForm', event, date, time })}
        onEditTx={tx => go({ name: 'entry', tx, from: 'calendar' })}
      />;
  } else if (screen.name === 'eventForm') {
    const back = screen.from ?? 'calendar';
    content = (
      <EventForm
        db={db}
        data={data}
        event={screen.event && (data.events.find(e => e.id === screen.event!.id) ?? screen.event)}
        occurrence={screen.event?.repeat ? (screen.event.startedOn ?? screen.event.date) : undefined}
        date={screen.date}
        time={screen.time}
        onDone={async () => {
          await refresh();
          go({ name: back });
        }}
        onCancel={() => go({ name: back })}
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
      <GoalsTab db={db} data={data} onOpen={g => go({ name: 'goal', id: g.id })} onNew={() => go({ name: 'goalForm' })} onChange={afterChange} />
    ) : t === 'dashboard' ? (
      <Dashboard data={data} onEdit={tx => go({ name: 'entry', tx, from: 'dashboard' })} />
    ) : (
      <Home
        db={db}
        data={data}
        onChange={afterChange}
        onEdit={tx => go({ name: 'entry', tx, from: 'home' })}
        onOpenData={() => go({ name: 'data', from: 'home' })}
        onOpenCheck={accountId => go({ name: 'balanceCheck', from: 'home', accountId })}
        openGaps={openGaps(data, todayStr())}
        onOpenGap={accountId => setLaterIds(ids => ids.filter(id => !id.startsWith(`gap|${accountId}|`)))}
        onRecheckCard={cardId => go({ name: 'balanceCheck', from: 'home', accountId: cardId, recheck: true })}
        onOpenGoals={() => go({ name: 'goals' })}
        onEditEvent={(event, date, time) => go({ name: 'eventForm', event, date, time, from: 'home' })}
        day={homeDay.current}
        onDayChange={d => (homeDay.current = d)}
      />
    );

  // The main screens share the bottom bar and can be swiped between
  const tab = data.setupDone && (TABS as string[]).includes(screen.name) ? (screen.name as Tab) : null;
  const awaiting = awaitingActual(data.events, now).filter(e => !laterIds.includes(`${e.id}|${e.date}`));
  const askEvent = awaiting[0];
  // Changing amounts due and not answered yet, oldest first; they come before the events' questions
  const today = todayStr();
  const variableDue = data.recurring
    .filter(r => r.variable)
    .flatMap(rec => openOccurrences(rec, today, data.startDate).map(occurrence => ({ rec, occurrence })))
    .sort((a, b) => a.occurrence.localeCompare(b.occurrence));
  const askVariable = now.getTime() >= snoozedUntil ? variableDue[0] : undefined;
  // Gaps left open after a check (between the changing amounts and the cards)
  const gapsOpen = openGaps(data, today);
  const askGap = gapsOpen.find(g => !laterIds.includes(`gap|${g.account.id}|${g.check.date}`));
  // Card charges to check against what the card company really charged (after the changing amounts)
  const cardsDue = cardChecksDue(data, today).filter(d => !laterIds.includes(`card|${d.card.id}|${d.charge.date}`));
  const askCard = cardsDue[0];
  // A goal that got more than its target: what to do with the extra
  const goalsNow = summarize(data, today).goals;
  const reached = goalsNow
    .filter(g => !g.account.archived && g.account.goalTarget && !laterIds.includes(`reached|${g.account.id}`))
    .map(g => ({ goal: g.account, surplus: goalNumbers(g.account, g.balance, data.transactions).surplus }))
    .find(r => r.surplus > 0);
  // A card's gap from the weekly check still open two days before its charge: said once
  const cardGapsOpen = openCardGaps(data, today);
  const remindCard = cardGapsOpen.find(g => g.chargeDate <= addDays(today, 2) && !data.cardGapReminded.includes(`${g.card.id}|${g.chargeDate}`));
  const reminded = async (g: { card: { id: string }; chargeDate: string }) => {
    await setMeta(db, 'cardGapReminded', [...data.cardGapReminded, `${g.card.id}|${g.chargeDate}`].slice(-40));
    afterChange();
  };
  // Only the nearest time round can be recorded ahead, so no month is skipped by mistake
  const earlyRec = early ? data.recurring.find(r => r.id === early.recurringId) : undefined;
  const nearest = earlyRec ? openOccurrences(earlyRec, early!.occurrence, data.startDate)[0] : undefined;
  const earlyAsk = earlyRec && nearest === early!.occurrence ? { rec: earlyRec, occurrence: early!.occurrence } : undefined;
  if (early && earlyRec && nearest && nearest !== early.occurrence) {
    setEarly(null);
    alert(`אפשר לרשום מראש רק את הפעם הקרובה של "${earlyRec.name}" (${nearest.split('-').reverse().slice(0, 2).map(Number).join('.')}).`);
  }
  return (
    <>
      <UpdateBanner />
      {toast && (
        // key: a new message restarts the bubble's appear-and-fade
        <div key={toast.text + (toast.undoId ?? '')} class="toast-bubble" role="status">
          <span>{toast.text.startsWith('🎉') ? '' : '✓ '}{toast.text}</span>
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
          <TabBar current={tab} onSelect={t => go({ name: t })} onAdd={() =>
              go({ name: 'entry', from: tab, ...(tab === 'home' && homeDay.current !== todayStr() && { preset: { date: homeDay.current } }) })
            }
          />
          {goalPay &&
            (() => {
              const g = summarize(data, today).goals.find(x => x.account.id === goalPay.goalId);
              if (!g) return null;
              const take = Math.min(goalPay.amount, g.balance);
              const back = g.account.goalSource ?? data.accounts.find(a => a.kind === 'bank')?.id;
              return (
                <GoalPayCard
                  goal={g.account}
                  inGoal={g.balance}
                  paid={goalPay}
                  method={data.methods.find(m => m.id === goalPay.methodId)?.name}
                  onFromDaily={() => setGoalPay(null)}
                  onFromGoal={async () => {
                    const now = new Date().toISOString();
                    if (back && take > 0) {
                      await putRecords(db, 'transactions', [
                        { id: crypto.randomUUID(), type: 'transfer', amount: take, date: goalPay.date, accountId: g.account.id, toAccountId: back, note: `לכיסוי: ${goalPay.note || g.account.name}`, coverFor: goalPay.id, createdAt: now, updatedAt: now } as Transaction,
                      ]);
                    }
                    const where = data.accounts.find(a => a.id === back)?.name ?? '';
                    const card = data.methods.find(m => m.id === goalPay.methodId);
                    const fromBank = card?.kind === 'credit' || card?.kind === 'bank';
                    // The money has to really get where the payment comes out of
                    setToast({
                      text:
                        g.account.goalPlace === 'inside'
                          ? `${formatMoney(take)} מהשמור ל${g.account.name} חזרו להיות פנויים`
                          : g.account.goalPlace === 'envelope' && fromBank
                            ? `${formatMoney(take)} מהמעטפה חזרו למזומן. התשלום יירד מהבנק: אם תפקיד אותם, רשום העברה מזומן ← בנק`
                            : `${formatMoney(take)} חזרו מהיעד ל${where}${g.account.goalPlace !== 'envelope' ? '. כדי שזה יקרה גם בבנק, העבר אותם מהפיקדון לעו"ש' : ''}`,
                    });
                    setGoalPay(null);
                    afterChange();
                  }}
                />
              );
            })()}
          {earlyAsk && (
            <EarlyRecordCard
              key={`${earlyAsk.rec.id}|${earlyAsk.occurrence}`}
              db={db}
              data={data}
              rec={earlyAsk.rec}
              occurrence={earlyAsk.occurrence}
              onClose={() => setEarly(null)}
              onDone={() => {
                setEarly(null);
                afterChange();
              }}
            />
          )}
          {!goalPay && askVariable && !menuOpen && !earlyAsk && (
            <VariableDueCard
              key={`${askVariable.rec.id}|${askVariable.occurrence}`}
              db={db}
              data={data}
              rec={askVariable.rec}
              occurrence={askVariable.occurrence}
              more={variableDue.length - 1}
              onSnooze={() => {
                setSnoozedUntil(Date.now() + 30 * 60_000);
                setNow(new Date());
              }}
              onDone={afterChange}
            />
          )}
          {!goalPay && !askVariable && askGap && !menuOpen && !earlyAsk && (
            <OpenGapCard
              key={`${askGap.account.id}|${askGap.check.date}`}
              gap={askGap}
              droppedFrom={gapDrop?.accountId === askGap.account.id ? gapDrop.from : undefined}
              more={gapsOpen.length - 1}
              onAdd={() => {
                setGapDrop(null);
                go({ name: 'entry', from: tab, preset: { ...sourcePreset(data, askGap.account, askGap.left), date: gapAsOf(askGap) } });
              }}
              onRecheck={() => {
                setGapDrop(null);
                go({ name: 'balanceCheck', from: tab, accountId: askGap.account.id, recheck: true });
              }}
              onRecordNow={async () => {
                setGapDrop(null);
                await correctBalance(db, data, askGap.account, askGap.check.real, askGap.check.real - askGap.left, askGap.check.date);
                setToast({ text: `נרשם "לא מזוהה" של ${formatMoney(Math.abs(askGap.left))} ב${askGap.account.name}` });
                afterChange();
              }}
              onLater={() => {
                setGapDrop(null);
                setLaterIds(ids => [...ids, `gap|${askGap.account.id}|${askGap.check.date}`]);
              }}
            />
          )}
          {!goalPay && !askVariable && !askGap && !askCard && remindCard && !menuOpen && !earlyAsk && (
            <CardGapReminder
              key={`${remindCard.card.id}|${remindCard.chargeDate}`}
              gap={remindCard}
              onRecheck={async () => {
                await reminded(remindCard);
                go({ name: 'balanceCheck', from: tab, accountId: remindCard.card.id, recheck: true });
              }}
              onDone={() => reminded(remindCard)}
            />
          )}
          {!goalPay && !askVariable && !askGap && askCard && !menuOpen && !earlyAsk && (
            <CardChargeCard
              key={`${askCard.card.id}|${askCard.charge.date}|${askCard.actual ?? ''}`}
              db={db}
              data={data}
              card={askCard.card}
              charge={askCard.charge}
              actual={askCard.actual}
              openGap={(() => {
                const g = cardGapsOpen.find(x => x.card.id === askCard.card.id && x.chargeDate === askCard.charge.date);
                return g && { date: g.check.date, left: g.left };
              })()}
              more={cardsDue.length - 1}
              onLater={() => setLaterIds(ids => [...ids, `card|${askCard.card.id}|${askCard.charge.date}`])}
              onDone={afterChange}
              onChanged={afterChange}
              onEdit={tx => go({ name: 'entry', tx, from: tab })}
              onAdd={(type, date) => go({ name: 'entry', from: tab, preset: { type, date, method: askCard.card.name } })}
            />
          )}
          {!goalPay && !askVariable && !askGap && !askCard && !remindCard && reached && !menuOpen && !earlyAsk && (
            <GoalReachedCard
              key={reached.goal.id}
              goal={reached.goal}
              surplus={reached.surplus}
              others={goalsNow.filter(g => g.account.id !== reached.goal.id && !g.account.archived).map(g => g.account)}
              onKeep={async () => {
                await putRecords(db, 'accounts', [{ ...reached.goal, goalTarget: (reached.goal.goalTarget ?? 0) + reached.surplus } as Account]);
                afterChange();
              }}
              onBack={async () => {
                const now = new Date().toISOString();
                const back = reached.goal.goalSource ?? data.accounts.find(a => a.kind === 'bank')?.id;
                if (back)
                  await putRecords(db, 'transactions', [
                    { id: crypto.randomUUID(), type: 'transfer', amount: reached.surplus, date: todayStr(), accountId: reached.goal.id, toAccountId: back, note: `עודף מ${reached.goal.name}`, createdAt: now, updatedAt: now } as Transaction,
                  ]);
                afterChange();
              }}
              onMove={async to => {
                const now = new Date().toISOString();
                await putRecords(db, 'transactions', [
                  { id: crypto.randomUUID(), type: 'transfer', amount: reached.surplus, date: todayStr(), accountId: reached.goal.id, toAccountId: to.id, note: `עודף מ${reached.goal.name} ל${to.name}`, createdAt: now, updatedAt: now } as Transaction,
                ]);
                afterChange();
              }}
              onLater={() => setLaterIds(ids => [...ids, `reached|${reached.goal.id}`])}
            />
          )}
          {!goalPay && !askVariable && !askGap && !askCard && !remindCard && !reached && askEvent && !menuOpen && (
            <EventDoneCard
              key={`${askEvent.id}|${askEvent.date}`}
              db={db}
              event={askEvent}
              series={data.events.find(e => e.id === askEvent.id) ?? askEvent}
              more={awaiting.length - 1}
              pot={potTotal(askEvent, data.transactions)}
              onAddMore={event =>
                go({
                  name: 'entry',
                  from: tab,
                  eventId: event.id,
                  eventDate: timeRoundOf(event),
                  preset: { type: event.type === 'income' ? 'income' : 'expense', date: lastDayOf(event) < todayStr() ? lastDayOf(event) : todayStr(), note: event.title },
                })
              }
              onLater={() => setLaterIds(ids => [...ids, `${askEvent.id}|${askEvent.date}`])}
              onDone={afterChange}
              onRecord={(event, amount) =>
                go({
                  name: 'entry',
                  from: tab,
                  eventId: event.id,
                  eventDate: timeRoundOf(event),
                  settleEvent: true,
                  preset: { type: event.type === 'income' ? 'income' : 'expense', amount, date: lastDayOf(event) < todayStr() ? lastDayOf(event) : todayStr(), note: event.title },
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

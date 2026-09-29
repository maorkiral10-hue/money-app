import { deleteRecord, getAll, getMeta, putRecords, run, type RecordStore } from './db';
import { todayStr } from './dates';
import { occurrenceTransaction, openOccurrences, scheduleDatesIn } from './recurring';
import type { Budget } from './budget';
import type { BalanceCheck, CheckEvery } from './reconcile';
import type { Account, CalendarEvent, Category, PaymentMethod, Recurring, Transaction } from './types';

export interface AppData {
  accounts: Account[];
  methods: PaymentMethod[];
  categories: Category[];
  transactions: Transaction[];
  recurring: Recurring[];
  /** Calendar events, by date. */
  events: CalendarEvent[];
  setupDone: boolean;
  startDate: string;
  lastBackupAt?: string;
  lastMethodId?: string;
  /** Open the app straight on a new entry (default on). */
  openOnEntry: boolean;
  /** Day of the month the financial month starts on (1 = calendar month). */
  monthStartDay: number;
  /** Set once the budget tab's questionnaire is done; until then the tab is locked. */
  budget?: Budget;
  /** Balance checks against the bank, newest first. */
  balanceChecks: BalanceCheck[];
  /** The quiet reminder to check the balance. */
  checkEvery: CheckEvery;
}

const byOrder = <T extends { order: number }>(a: T, b: T) => a.order - b.order;

export async function loadAll(db: IDBDatabase): Promise<AppData> {
  return {
    accounts: (await getAll<Account>(db, 'accounts')).sort(byOrder),
    methods: (await getAll<PaymentMethod>(db, 'methods')).sort(byOrder),
    categories: (await getAll<Category>(db, 'categories')).sort(byOrder),
    transactions: await getAll<Transaction>(db, 'transactions'),
    recurring: (await getAll<Recurring>(db, 'recurring')).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    events: (await getAll<CalendarEvent>(db, 'events')).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt)),
    setupDone: (await getMeta<boolean>(db, 'setupDone')) === true,
    startDate: (await getMeta<string>(db, 'startDate')) ?? todayStr(),
    lastBackupAt: await getMeta<string>(db, 'lastBackupAt'),
    lastMethodId: await getMeta<string>(db, 'lastMethodId'),
    openOnEntry: (await getMeta<boolean>(db, 'openOnEntry')) !== false,
    monthStartDay: (await getMeta<number>(db, 'monthStartDay')) ?? 1,
    budget: await getMeta<Budget>(db, 'budget'),
    balanceChecks: (await getMeta<BalanceCheck[]>(db, 'balanceChecks')) ?? [],
    // Weekly unless chosen otherwise (28.9.2026: the reminder should show without having to turn it on)
    checkEvery: (await getMeta<CheckEvery>(db, 'checkEvery')) ?? 'week',
  };
}

/** Saves the first-run questionnaire in one go; the start date is today. */
export function finishSetup(
  db: IDBDatabase,
  setup: { accounts: Account[]; methods: PaymentMethod[]; categories: Category[]; monthStartDay: number },
) {
  const stores: RecordStore[] = ['accounts', 'methods', 'categories'];
  return run(db, [...stores, 'meta'], 'readwrite', tx => {
    for (const s of stores) (setup[s as 'accounts' | 'methods' | 'categories'] as { id: string }[]).forEach(r => tx.objectStore(s).put(r));
    tx.objectStore('meta').put(setup.monthStartDay, 'monthStartDay');
    tx.objectStore('meta').put(todayStr(), 'startDate');
    tx.objectStore('meta').put(true, 'setupDone');
  });
}

/**
 * Records every fixed-amount standing order and fixed income that has come due (e.g. rent on the 1st) and
 * marks it handled: nothing is asked, they happen for sure. One whose amount changes (electricity) isn't
 * recorded here: on its day the user is asked how much it really was (VariableDueCard).
 * Reads and writes inside one transaction, so even two runs at once never record an occurrence twice.
 * Returns true if anything was recorded.
 */
export async function recordDueRecurring(db: IDBDatabase, startDate: string, today: string) {
  let changed = false;
  await run(db, ['transactions', 'recurring'], 'readwrite', tx => {
    const req = tx.objectStore('recurring').getAll();
    req.onsuccess = () => {
      const txReq = tx.objectStore('transactions').getAll();
      txReq.onsuccess = () => {
        for (const rec of (req.result as Recurring[]).filter(r => !r.variable)) {
          const due = openOccurrences(rec, today, startDate);
          if (!due.length) continue;
          due.forEach(occ => tx.objectStore('transactions').put(occurrenceTransaction(rec, occ, rec.amount)));
          tx.objectStore('recurring').put({ ...rec, handledThrough: due[due.length - 1] });
          changed = true;
        }
      };
    };
  });
  return changed;
}

/**
 * Repairs transactions a standing order recorded that lost their tie to it when edited (before version 24):
 * same name as the order's note, same category and payment method. Each is tied back to the order's date in
 * its month, so it counts once, as the standing order, and not as day-to-day spending. Returns true if any.
 */
export async function relinkEditedRecurring(db: IDBDatabase) {
  let changed = false;
  await run(db, ['transactions', 'recurring'], 'readwrite', tx => {
    const recReq = tx.objectStore('recurring').getAll();
    recReq.onsuccess = () => {
      const recs = recReq.result as Recurring[];
      const txReq = tx.objectStore('transactions').getAll();
      txReq.onsuccess = () => {
        const all = txReq.result as Transaction[];
        const taken = new Set(all.filter(t => t.recurringId).map(t => `${t.recurringId}|${t.occurrence}`));
        for (const t of all) {
          if (t.recurringId || !t.note) continue;
          const rec = recs.find(
            r => r.name === t.note && r.type === t.type && r.categoryId === t.categoryId && (r.type === 'income' ? r.accountId === t.accountId : r.methodId === t.methodId),
          );
          if (!rec || t.createdAt < rec.createdAt) continue;
          const month = t.date.slice(0, 7);
          const occurrence = scheduleDatesIn(rec, `${month}-01`, `${month}-31`)[0] ?? t.date;
          // Never two transactions for the same order's date: the second stays as it is
          if (taken.has(`${rec.id}|${occurrence}`)) continue;
          taken.add(`${rec.id}|${occurrence}`);
          tx.objectStore('transactions').put({ ...t, recurringId: rec.id, occurrence });
          changed = true;
        }
      };
    };
  });
  return changed;
}

/** Variable items whose date has come: the user says how much it really was (or null: it didn't happen). */
export async function resolveOccurrence(db: IDBDatabase, rec: Recurring, occurrence: string, amount: number | null) {
  await run(db, ['transactions', 'recurring'], 'readwrite', tx => {
    if (amount) tx.objectStore('transactions').put(occurrenceTransaction(rec, occurrence, amount));
    tx.objectStore('recurring').put({ ...rec, handledThrough: occurrence });
  });
}

export const saveRecurring = (db: IDBDatabase, rec: Recurring) => putRecords(db, 'recurring', [rec]);

/**
 * Deletes a category or payment method the user no longer wants. One that transactions, recurring items
 * or a card's opening amount still depend on is kept but hidden everywhere, so past transactions keep
 * their names and balances don't change.
 */
export async function deleteSetting(db: IDBDatabase, data: AppData, store: 'categories' | 'methods', id: string) {
  const field = store === 'categories' ? 'categoryId' : 'methodId';
  const inUse =
    data.transactions.some(t => t[field] === id) ||
    data.recurring.some(r => r[field] === id) ||
    (store === 'methods' && !!data.methods.find(m => m.id === id)?.openingPending);
  if (!inUse) return deleteRecord(db, store, id);
  const item: Category | PaymentMethod | undefined = (store === 'categories' ? data.categories : data.methods).find(x => x.id === id);
  if (!item) return;
  const hidden = { ...item, archived: true };
  await putRecords(db, store, [hidden]);
}

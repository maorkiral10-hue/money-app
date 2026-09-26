import { deleteRecord, getAll, getMeta, putRecords, run, type RecordStore } from './db';
import { todayStr } from './dates';
import { occurrenceTransaction, openOccurrences } from './recurring';
import type { Account, Category, PaymentMethod, Recurring, Transaction } from './types';

export interface AppData {
  accounts: Account[];
  methods: PaymentMethod[];
  categories: Category[];
  transactions: Transaction[];
  recurring: Recurring[];
  setupDone: boolean;
  startDate: string;
  lastBackupAt?: string;
  lastMethodId?: string;
}

const byOrder = <T extends { order: number }>(a: T, b: T) => a.order - b.order;

export async function loadAll(db: IDBDatabase): Promise<AppData> {
  return {
    accounts: (await getAll<Account>(db, 'accounts')).sort(byOrder),
    methods: (await getAll<PaymentMethod>(db, 'methods')).sort(byOrder),
    categories: (await getAll<Category>(db, 'categories')).sort(byOrder),
    transactions: await getAll<Transaction>(db, 'transactions'),
    recurring: (await getAll<Recurring>(db, 'recurring')).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    setupDone: (await getMeta<boolean>(db, 'setupDone')) === true,
    startDate: (await getMeta<string>(db, 'startDate')) ?? todayStr(),
    lastBackupAt: await getMeta<string>(db, 'lastBackupAt'),
    lastMethodId: await getMeta<string>(db, 'lastMethodId'),
  };
}

/** Saves the first-run questionnaire in one go; the start date is today. */
export function finishSetup(db: IDBDatabase, setup: { accounts: Account[]; methods: PaymentMethod[]; categories: Category[] }) {
  const stores: RecordStore[] = ['accounts', 'methods', 'categories'];
  return run(db, [...stores, 'meta'], 'readwrite', tx => {
    for (const s of stores) setup[s as keyof typeof setup].forEach(r => tx.objectStore(s).put(r));
    tx.objectStore('meta').put(todayStr(), 'startDate');
    tx.objectStore('meta').put(true, 'setupDone');
  });
}

/**
 * Records every fixed-amount occurrence that has come due (e.g. rent on the 1st) and marks it handled.
 * Reads and writes inside one transaction, so even two runs at once never record an occurrence twice.
 * Returns true if anything was recorded.
 */
export async function recordDueRecurring(db: IDBDatabase, startDate: string, today: string) {
  let changed = false;
  await run(db, ['transactions', 'recurring'], 'readwrite', tx => {
    const req = tx.objectStore('recurring').getAll();
    req.onsuccess = () => {
      for (const rec of (req.result as Recurring[]).filter(r => !r.variable)) {
        const due = openOccurrences(rec, today, startDate);
        if (!due.length) continue;
        due.forEach(occ => tx.objectStore('transactions').put(occurrenceTransaction(rec, occ, rec.amount)));
        tx.objectStore('recurring').put({ ...rec, handledThrough: due[due.length - 1] });
        changed = true;
      }
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

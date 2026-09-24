import { getAll, getMeta, run, type RecordStore } from './db';
import { todayStr } from './dates';
import type { Account, Category, PaymentMethod, Transaction } from './types';

export interface AppData {
  accounts: Account[];
  methods: PaymentMethod[];
  categories: Category[];
  transactions: Transaction[];
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

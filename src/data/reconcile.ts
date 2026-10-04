import { chargeOf, summarize, type Ledger } from './balance';
import { addDays } from './dates';
import { getMeta, run, setMeta } from './db';
import type { Account, Category, PaymentMethod, Transaction } from './types';

/** One comparison of an account with what the bank (or wallet) really shows. */
export interface BalanceCheck {
  date: string;
  accountId: string;
  /** What you typed: the real balance. */
  real: number;
  /** What the app had. */
  app: number;
  /** "corrected": the gap was recorded as an unexplained expense or income (before version 78: the start balance was moved). */
  result: 'match' | 'gap' | 'corrected';
  /**
   * Checked before it was due, and the user chose to stay on the regular schedule: the next reminder is
   * counted from the check before, as if this one hadn't moved it.
   */
  keepSchedule?: boolean;
  /**
   * Done before it was due (an extra check, not the regular one): it can be taken out of the history.
   * Missing on checks from before version 82, where only keepSchedule tells.
   */
  early?: boolean;
}

/** A regular check stays in the history for good; only an extra one can be deleted. */
export const canDeleteCheck = (c: BalanceCheck) => !!(c.early || c.keepSchedule);

/** How a check came out: exactly right, a gap small enough to count as minor (the user's own limit), or off. */
export function checkMark(real: number, app: number, tolerance: number): 'exact' | 'minor' | 'off' {
  const gap = Math.abs(real - app);
  return gap === 0 ? 'exact' : gap <= tolerance ? 'minor' : 'off';
}

/** Keeps a source on its regular schedule after an early check (all of that day's records for it). */
export async function keepRegularSchedule(db: IDBDatabase, accountId: string, date: string) {
  const all = (await getMeta<BalanceCheck[]>(db, 'balanceChecks')) ?? [];
  await setMeta(
    db,
    'balanceChecks',
    all.map(c => (c.accountId === accountId && c.date === date ? { ...c, keepSchedule: true } : c)),
  );
}

export type CheckEvery = 'never' | 'week' | 'twoWeeks' | 'month';
/** All money sources checked on one schedule, or each on its own. */
export type CheckMode = 'together' | 'separate';

const EVERY_DAYS: Record<Exclude<CheckEvery, 'never'>, number> = { week: 7, twoWeeks: 14, month: 30 };

// Enough history to know each source's last check even when several are checked every week
const KEEP = 60;

/** The account's balance in the app today. */
export const appBalance = (ledger: Ledger, accountId: string, today: string) =>
  summarize(ledger, today).byAccount.find(b => b.account.id === accountId)?.balance ?? 0;

/** Takes one check out of the history (by its place in it, newest first): done by mistake, or just a try. */
export async function deleteCheck(db: IDBDatabase, index: number) {
  const all = (await getMeta<BalanceCheck[]>(db, 'balanceChecks')) ?? [];
  await setMeta(db, 'balanceChecks', all.filter((_, i) => i !== index));
}

export async function logCheck(db: IDBDatabase, check: BalanceCheck) {
  const all = (await getMeta<BalanceCheck[]>(db, 'balanceChecks')) ?? [];
  await setMeta(db, 'balanceChecks', [check, ...all].slice(0, KEEP));
}

/** The category a gap no one could explain goes under. */
export const UNKNOWN_CATEGORY = 'לא מזוהה';
const GAP_NOTE = 'פער בבדיקה מול';

/** A gap a balance check recorded as unexplained. */
export const isGapTx = (t: Transaction, categories: Category[]) =>
  !!t.note?.startsWith(GAP_NOTE) && categories.some(c => c.id === t.categoryId && c.name.trim() === UNKNOWN_CATEGORY);

/** The account a transaction's money comes out of (or goes into) directly, and on which day. */
function touches(t: Transaction, methods: PaymentMethod[]): { accountId: string; date: string } | undefined {
  if (t.type === 'transfer') return undefined;
  if (!t.methodId) return t.accountId ? { accountId: t.accountId, date: t.date } : undefined;
  const m = methods.find(x => x.id === t.methodId);
  if (!m) return undefined;
  // A card purchase reaches the bank only on its charge day
  if (m.kind === 'credit') return m.chargeDay ? { accountId: m.accountId, date: chargeOf(t, m.chargeDay) } : undefined;
  return { accountId: m.accountId, date: t.date };
}

/** What a transaction does to its account's balance: money out is negative. */
const signed = (t: Transaction) => (t.type === 'expense' ? -t.amount : t.amount);

/**
 * A change remembered after a check left an unexplained gap — something new (`before` missing), a
 * corrected amount, or a deletion (`after` missing, e.g. recorded twice): if it moves the same account's
 * balance the way the gap did (less money for a gap of missing money, more for extra), from before that
 * check, and by no more than the gap — the gap it may explain (the first check after it) and by how much.
 */
export function gapForChange(
  data: { transactions: Transaction[]; categories: Category[]; methods: PaymentMethod[] },
  before: Transaction | undefined,
  after: Transaction | undefined,
): { gap: Transaction; by: number } | undefined {
  if ((before && isGapTx(before, data.categories)) || (after && isGapTx(after, data.categories))) return undefined;
  const was = before && touches(before, data.methods);
  const now = after && touches(after, data.methods);
  if ((before && !was) || (after && !now) || (was && now && was.accountId !== now.accountId)) return undefined;
  const where = (now ?? was)!;
  if (!where) return undefined;
  const latest = was && now && was.date > now.date ? was.date : where.date;
  const change = (after ? signed(after) : 0) - (before ? signed(before) : 0);
  if (change === 0) return undefined;
  const by = Math.abs(change);
  const gap = data.transactions
    .filter(g => isGapTx(g, data.categories) && g.date >= latest && by <= g.amount && (change < 0) === (g.type === 'expense'))
    .filter(g => touches(g, data.methods)?.accountId === where.accountId)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  return gap && { gap, by };
}

/** Something new that may be part of a gap (see gapForChange). */
export const gapFor = (data: Parameters<typeof gapForChange>[0], t: Transaction) => gapForChange(data, undefined, t)?.gap;

/**
 * Part of an unexplained gap turned out to be a change (something new or corrected, `put`, or something
 * deleted, `remove`): it's saved, and the gap shrinks by `by` (gone once nothing's left), so the balance
 * stays as the bank showed and only the explanation changes.
 */
export async function explainGap(db: IDBDatabase, gap: Transaction, by: number, change: { put?: Transaction; remove?: string }) {
  await run(db, 'transactions', 'readwrite', tx => {
    const store = tx.objectStore('transactions');
    if (change.put) store.put(change.put);
    if (change.remove) store.delete(change.remove);
    if (by >= gap.amount) store.delete(gap.id);
    else store.put({ ...gap, amount: gap.amount - by, updatedAt: new Date().toISOString() });
  });
}

/**
 * Makes the app agree with the bank when the gap couldn't be explained: it's recorded today as an expense
 * (less money than the app thought) or income (more) under "לא מזוהה", so it counts in the month like any
 * money that went out or came in, and it's always visible how much got away unexplained. The category is
 * made the first time. Done in one transaction together with its record in the check history.
 */
export async function correctBalance(
  db: IDBDatabase,
  data: { categories: Category[]; methods: PaymentMethod[] },
  account: Account,
  real: number,
  app: number,
  today: string,
) {
  const all = (await getMeta<BalanceCheck[]>(db, 'balanceChecks')) ?? [];
  const check: BalanceCheck = { date: today, accountId: account.id, real, app, result: 'corrected' };
  const kind = real < app ? 'expense' : 'income';
  const existing = data.categories.find(c => c.kind === kind && c.name.trim() === UNKNOWN_CATEGORY);
  const category: Category = existing
    ? { ...existing, archived: false }
    : { id: crypto.randomUUID(), name: UNKNOWN_CATEGORY, kind, order: Math.max(0, ...data.categories.map(c => c.order)) + 1 };
  // Out of the account the way money leaves it (its bank transfer or cash method), or straight from it
  const method = data.methods.find(m => m.accountId === account.id && m.kind !== 'credit' && !m.archived);
  const now = new Date().toISOString();
  const gapTx: Transaction = {
    id: crypto.randomUUID(),
    type: kind,
    amount: Math.abs(real - app),
    date: today,
    categoryId: category.id,
    ...(kind === 'income' ? { accountId: account.id } : method ? { methodId: method.id } : { accountId: account.id }),
    note: `${GAP_NOTE} ${account.name}`,
    createdAt: now,
    updatedAt: now,
  };
  await run(db, ['categories', 'transactions', 'meta'], 'readwrite', tx => {
    tx.objectStore('categories').put(category);
    tx.objectStore('transactions').put(gapTx);
    // The comparison just logged becomes this record, not a second line for the same check
    const same = all.findIndex(c => c.accountId === account.id && c.date === today && c.real === real && c.app === app && c.result === 'gap');
    const rest = same >= 0 ? all.filter((_, i) => i !== same) : all;
    if (same >= 0 && all[same].early) check.early = true;
    tx.objectStore('meta').put([check, ...rest].slice(0, KEEP), 'balanceChecks');
  });
}

/** Whether a check is due, by when it was last done. */
export function checkDue(every: CheckEvery, last: string | undefined, today: string) {
  if (every === 'never') return false;
  if (!last) return true;
  return addDays(last, EVERY_DAYS[every]) <= today;
}

/** Counting cash every week is a chore, so it's monthly unless changed; the others weekly. */
export const defaultEvery = (a: Pick<Account, 'kind'>): CheckEvery => (a.kind === 'cash' ? 'month' : 'week');

export interface CheckSettings {
  checkMode: CheckMode;
  /** "Together": one schedule for all. */
  checkEvery: CheckEvery;
  /** "Each on its own": per source (missing: its default). */
  checkEveryByAccount: Record<string, CheckEvery>;
}

export const everyFor = (s: CheckSettings, a: Account): CheckEvery =>
  s.checkMode === 'together' ? s.checkEvery : (s.checkEveryByAccount[a.id] ?? defaultEvery(a));

/**
 * Which money sources are due a check today: each by its own last check and its schedule. Savings goals
 * aren't checked (they're the user's own "piggy banks"). `total` counts the sources that get checked at all.
 */
export function checkStatus(data: CheckSettings & { accounts: Account[]; balanceChecks: BalanceCheck[] }, today: string) {
  const sources = data.accounts.filter(a => !a.archived && a.name.trim() && a.kind !== 'goal' && everyFor(data, a) !== 'never');
  // An early check the user chose not to count doesn't move the schedule
  const last = (id: string) => data.balanceChecks.find(c => c.accountId === id && !c.keepSchedule)?.date;
  const due = sources.filter(a => checkDue(everyFor(data, a), last(a.id), today));
  return { due, total: sources.length, checked: sources.length - due.length };
}

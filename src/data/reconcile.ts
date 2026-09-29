import { summarize, type Ledger } from './balance';
import { addDays } from './dates';
import { getMeta, run, setMeta } from './db';
import type { Account } from './types';

/** One comparison of an account with what the bank (or wallet) really shows. */
export interface BalanceCheck {
  date: string;
  accountId: string;
  /** What you typed: the real balance. */
  real: number;
  /** What the app had. */
  app: number;
  /** "corrected": the app's balance was set to the real one. */
  result: 'match' | 'gap' | 'corrected';
  /**
   * Checked before it was due, and the user chose to stay on the regular schedule: the next reminder is
   * counted from the check before, as if this one hadn't moved it.
   */
  keepSchedule?: boolean;
}

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

export async function logCheck(db: IDBDatabase, check: BalanceCheck) {
  const all = (await getMeta<BalanceCheck[]>(db, 'balanceChecks')) ?? [];
  await setMeta(db, 'balanceChecks', [check, ...all].slice(0, KEEP));
}

/**
 * Makes the app agree with the bank without inventing a transaction: the account's start-day balance moves
 * by the gap, so today's balance becomes the real one and no spending or income figure changes.
 * Done in one transaction together with its record in the check history.
 */
export async function correctBalance(db: IDBDatabase, account: Account, real: number, app: number, today: string) {
  const all = (await getMeta<BalanceCheck[]>(db, 'balanceChecks')) ?? [];
  const check: BalanceCheck = { date: today, accountId: account.id, real, app, result: 'corrected' };
  await run(db, ['accounts', 'meta'], 'readwrite', tx => {
    tx.objectStore('accounts').put({ ...account, openingBalance: account.openingBalance + (real - app) });
    tx.objectStore('meta').put([check, ...all].slice(0, KEEP), 'balanceChecks');
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

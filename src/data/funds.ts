import { getMeta, setMeta } from './db';
import type { Transaction } from './types';

/**
 * Long-term savings — a pension fund, a keren hishtalmut, a kupat gemel: shown for the picture only, never
 * part of the liquid money. Their balance can't be known from inside the app, so it's typed in from the
 * fund's own report now and then; between two updates the app tells how much of the growth was deposits
 * and how much the fund earned.
 */
export type FundKind = 'pension' | 'hishtalmut' | 'gemel' | 'gemelInvest' | 'other';

export const FUND_KINDS: [FundKind, string][] = [
  ['pension', 'קרן פנסיה'],
  ['hishtalmut', 'קרן השתלמות'],
  ['gemel', 'קופת גמל'],
  ['gemelInvest', 'גמל להשקעה'],
  ['other', 'אחר'],
];

/** One balance typed in from the fund's report. */
export interface FundUpdate {
  date: string;
  balance: number;
  /** Deposited since the update before it (from the salary, a standing order, or by hand); 0 on the first. */
  deposits: number;
}

export interface Fund {
  id: string;
  name: string;
  kind: FundKind;
  /** A standing order that deposits into it from the bank: what it recorded since the last update is suggested as the deposits. */
  recurringId?: string;
  /** Oldest first. */
  updates: FundUpdate[];
  createdAt: string;
}

export const latest = (f: Fund) => f.updates[f.updates.length - 1];

/** What the fund earned (or lost) between an update and the one before it: the growth that wasn't deposits. */
export function earned(f: Fund, i: number) {
  if (i <= 0 || i >= f.updates.length) return undefined;
  const prev = f.updates[i - 1];
  const now = f.updates[i];
  const amount = now.balance - prev.balance - now.deposits;
  return { amount, pct: prev.balance > 0 ? amount / prev.balance : undefined, since: prev.date };
}

/** What the linked standing order put in after the last update, up to a day: offered as the deposits for the next one. */
export function depositsSince(f: Fund, transactions: Transaction[], until: string) {
  const last = latest(f);
  if (!last) return 0;
  return transactions
    .filter(t => ((f.recurringId && t.recurringId === f.recurringId) || t.fundId === f.id) && t.date > last.date && t.date <= until)
    .reduce((a, t) => a + t.amount, 0);
}

export const totalSaved = (funds: Fund[]) => funds.reduce((a, f) => a + (latest(f)?.balance ?? 0), 0);

export const saveFunds = (db: IDBDatabase, funds: Fund[]) => setMeta(db, 'funds', funds);
export const loadFunds = async (db: IDBDatabase) => (await getMeta<Fund[]>(db, 'funds')) ?? [];

/** Between two updates: the last balance from the report plus what the linked standing order has put in since. */
export const estimated = (f: Fund, transactions: Transaction[], today: string) => (latest(f)?.balance ?? 0) + depositsSince(f, transactions, today);

export const totalEstimated = (funds: Fund[], transactions: Transaction[], today: string) => funds.reduce((a, f) => a + estimated(f, transactions, today), 0);

/** Since the first update: everything deposited, and what the fund earned on top of it. */
export function sinceStart(f: Fund) {
  const first = f.updates[0];
  const last = latest(f);
  if (!first || f.updates.length < 2) return undefined;
  const deposits = f.updates.slice(1).reduce((a, u) => a + u.deposits, 0);
  const amount = last.balance - first.balance - deposits;
  return { from: first.date, deposits, amount, pct: first.balance > 0 ? amount / first.balance : undefined };
}

/** One day something was updated: every fund's balance as it stood then (its latest update up to that day), and their total. */
export interface FundsSnapshot {
  date: string;
  total: number;
  funds: { fund: Fund; balance: number; asOf: string; index: number }[];
}

/** The history of updates, newest first: for each day one was made, where all the funds stood. */
export function fundsHistory(funds: Fund[]): FundsSnapshot[] {
  const days = [...new Set(funds.flatMap(f => f.updates.map(u => u.date)))].sort().reverse();
  return days.map(date => {
    const rows = funds.flatMap(fund => {
      let index = -1;
      fund.updates.forEach((u, i) => {
        if (u.date <= date && (index < 0 || u.date >= fund.updates[index].date)) index = i;
      });
      return index < 0 ? [] : [{ fund, balance: fund.updates[index].balance, asOf: fund.updates[index].date, index }];
    });
    return { date, total: rows.reduce((a, r) => a + r.balance, 0), funds: rows };
  });
}

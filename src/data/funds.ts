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
  if (!f.recurringId || !last) return 0;
  return transactions
    .filter(t => t.recurringId === f.recurringId && t.date > last.date && t.date <= until)
    .reduce((a, t) => a + t.amount, 0);
}

export const totalSaved = (funds: Fund[]) => funds.reduce((a, f) => a + (latest(f)?.balance ?? 0), 0);

export const saveFunds = (db: IDBDatabase, funds: Fund[]) => setMeta(db, 'funds', funds);
export const loadFunds = async (db: IDBDatabase) => (await getMeta<Fund[]>(db, 'funds')) ?? [];

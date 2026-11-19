import { allEffects, type Ledger } from './balance';
import { isSaving, savingsCategoryIds, statsTransactions } from './budget';
import { addMonths, periodEnd, periodKey, periodStart } from './dashboard';
import { addDays, parseDate } from './dates';
import { isGapTx } from './reconcile';
import type { AppData } from './store';
import { isGoal, type Transaction } from './types';

// The numbers behind the dashboard. Everything counts by the day a thing happened (a card purchase on the
// day it was bought), money put into savings isn't spending, and moves between your own accounts are neither.

export type PeriodKind = 'week' | 'month' | 'quarter' | 'year';

export interface Period {
  from: string;
  to: string;
}

const weekday = (s: string) => {
  const { y, m0, d } = parseDate(s);
  return new Date(y, m0, d).getDay();
};

/** Whole days from one date to another. */
export function daysBetween(from: string, to: string) {
  const a = parseDate(from);
  const b = parseDate(to);
  return Math.round((Date.UTC(b.y, b.m0, b.d) - Date.UTC(a.y, a.m0, a.d)) / 86_400_000);
}

/**
 * The period `k` steps from the one holding today (0 = this one, −1 = the one before): a week from Sunday,
 * a financial month, three financial months ending in this month's step, or the twelve financial months of a year.
 */
export function periodOf(kind: PeriodKind, k: number, today: string, startDay = 1): Period {
  if (kind === 'week') {
    const from = addDays(today, -weekday(today) + 7 * k);
    return { from, to: addDays(from, 6) };
  }
  const key = periodKey(today, startDay);
  if (kind === 'month') {
    const m = addMonths(key, k);
    return { from: periodStart(m, startDay), to: periodEnd(m, startDay) };
  }
  if (kind === 'quarter') {
    const last = addMonths(key, 3 * k);
    return { from: periodStart(addMonths(last, -2), startDay), to: periodEnd(last, startDay) };
  }
  const y = Number(key.slice(0, 4)) + k;
  return { from: periodStart(`${y}-01`, startDay), to: periodEnd(`${y}-12`, startDay) };
}

/** How many of the same period make up the "over time" bars, and how far back "a year ago" is. */
export const BARS: Record<PeriodKind, number> = { week: 8, month: 6, quarter: 4, year: 3 };
export const YEAR_AGO: Record<PeriodKind, number> = { week: -52, month: -12, quarter: -4, year: -1 };

/** A period cut to the same point as a running one (its first `days` + 1 days), or whole when `days` is undefined. */
export const cut = (p: Period, days?: number): Period => (days === undefined ? p : { from: p.from, to: addDays(p.from, days) < p.to ? addDays(p.from, days) : p.to });

export interface CategoryAmount {
  categoryId: string;
  amount: number;
}

export interface PeriodStats {
  income: number;
  /** Spending (savings not included). */
  expenses: number;
  /** Put into savings: savings categories and money moved into goals, less what was taken back (never below 0). */
  saved: number;
  /** Spending by category, biggest first. */
  byCategory: CategoryAmount[];
  incomeByCategory: CategoryAmount[];
  /** Of the spending: standing orders and other recurring expenses. */
  fixed: number;
  /** Spending by how it was paid: the method's name, or the account's when paid straight from it. */
  byMethod: { name: string; amount: number }[];
  /** Recorded as unexplained in a balance check: + money missing, − money that turned up. */
  unknown: number;
}

const add = (m: Map<string, number>, key: string, n: number) => m.set(key, (m.get(key) ?? 0) + n);
const sorted = (m: Map<string, number>) => [...m].map(([categoryId, amount]) => ({ categoryId, amount })).sort((a, b) => b.amount - a.amount);

export function periodStats(data: AppData, p: Period, txs: Transaction[] = statsTransactions(data)): PeriodStats {
  const inP = (t: Transaction) => t.date >= p.from && t.date <= p.to && t.date >= data.startDate;
  const cats = new Map<string, number>();
  const incomeCats = new Map<string, number>();
  const methods = new Map<string, number>();
  let income = 0;
  let expenses = 0;
  let fixed = 0;
  let unknown = 0;
  for (const t of txs) {
    if (!inP(t)) continue;
    if (t.type === 'income') {
      income += t.amount;
      add(incomeCats, t.categoryId ?? '', t.amount);
      if (isGapTx(t, data.categories)) unknown -= t.amount;
    } else if (t.type === 'expense') {
      expenses += t.amount;
      add(cats, t.categoryId ?? '', t.amount);
      if (t.recurringId) fixed += t.amount;
      const method = data.methods.find(m => m.id === t.methodId)?.name ?? data.accounts.find(a => a.id === t.accountId)?.name ?? 'אחר';
      add(methods, method, t.amount);
      if (isGapTx(t, data.categories)) unknown += t.amount;
    }
  }
  return {
    income,
    expenses,
    saved: savedIn(data, p),
    byCategory: sorted(cats),
    incomeByCategory: sorted(incomeCats),
    fixed,
    byMethod: [...methods].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount),
    unknown,
  };
}

/** What a period put into savings, the same way the month's savings tile on the home screen counts it. */
export function savedIn(data: AppData, p: Period) {
  const ids = savingsCategoryIds(data);
  const goals = new Set(data.accounts.filter(isGoal).map(a => a.id));
  let n = 0;
  for (const t of data.transactions) {
    if (t.date < p.from || t.date > p.to || t.date < data.startDate) continue;
    if (isSaving(t, ids)) n += t.amount;
    else if (t.type === 'transfer' && goals.has(t.accountId ?? '') !== goals.has(t.toAccountId ?? '')) {
      if (goals.has(t.toAccountId ?? '')) n += t.amount;
      else if (!t.coverFor) n -= t.amount;
    }
  }
  return Math.max(0, n);
}

/**
 * The liquid money at the end of each day from the start date to `to`, the same number as "כסף נזיל עכשיו"
 * on the home screen: a card purchase leaves it on its charge day, money put apart in a goal isn't in it.
 */
export function liquidByDay(ledger: Ledger, to: string): { date: string; amount: number }[] {
  const counted = new Map<string, boolean>();
  for (const a of ledger.accounts) counted.set(a.id, !isGoal(a) || (a.goalPlace === 'inside' && !!a.goalSource));
  let amount = ledger.accounts.filter(a => !isGoal(a)).reduce((s, a) => s + a.openingBalance, 0);
  const byDate = new Map<string, number>();
  for (const e of allEffects(ledger)) {
    if (e.date > to || !counted.get(e.accountId)) continue;
    if (e.date < ledger.startDate) amount += e.amount;
    else add(byDate, e.date, e.amount);
  }
  const out: { date: string; amount: number }[] = [];
  for (let d = ledger.startDate; d <= to; d = addDays(d, 1)) {
    amount += byDate.get(d) ?? 0;
    out.push({ date: d, amount });
  }
  return out;
}

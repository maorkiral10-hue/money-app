import { allEffects, summarize, type Ledger } from './balance';
import { daysInMonth, parseDate, ymd } from './dates';
import type { Transaction } from './types';

// The financial month is the calendar month (decided 27.9.2026). Everything here works on a month key
// 'YYYY-MM' so a different start day can be added later in one place.

export const monthKey = (date: string) => date.slice(0, 7);

export function monthEnd(key: string) {
  const { y, m0 } = parseDate(`${key}-01`);
  return ymd(y, m0, daysInMonth(y, m0));
}

export function addMonths(key: string, n: number) {
  const { y, m0 } = parseDate(`${key}-01`);
  const d = new Date(y, m0 + n, 1);
  return ymd(d.getFullYear(), d.getMonth(), 1).slice(0, 7);
}

/** Month keys from the start date's month up to today's, oldest first. */
export function monthsSince(startDate: string, today: string) {
  const keys: string[] = [];
  for (let k = monthKey(startDate); k <= monthKey(today); k = addMonths(k, 1)) keys.push(k);
  return keys;
}

export interface MonthStats {
  key: string;
  income: number;
  expenses: number;
  /** income − expenses: what the month added to (or took from) your money */
  net: number;
  /** Expense categories, biggest first. */
  byCategory: { categoryId: string; amount: number }[];
}

/**
 * Income and spending of one month, by the day each transaction happened: a card purchase counts in
 * the month you bought it, not when the bank pays it. Transfers between your own accounts are neither.
 */
export function monthStats(transactions: Transaction[], key: string): MonthStats {
  let income = 0;
  let expenses = 0;
  const cats = new Map<string, number>();
  for (const t of transactions) {
    if (monthKey(t.date) !== key) continue;
    if (t.type === 'income') income += t.amount;
    if (t.type === 'expense') {
      expenses += t.amount;
      const c = t.categoryId ?? '';
      cats.set(c, (cats.get(c) ?? 0) + t.amount);
    }
  }
  const byCategory = [...cats].map(([categoryId, amount]) => ({ categoryId, amount })).sort((a, b) => b.amount - a.amount);
  return { key, income, expenses, net: income - expenses, byCategory };
}

/** What is still expected to leave and arrive from tomorrow to the end of today's month, and where that leaves you. */
export function restOfMonth(ledger: Ledger, today: string) {
  const end = monthEnd(monthKey(today));
  let expectedOut = 0;
  let expectedIn = 0;
  for (const e of allEffects(ledger, today)) {
    if (e.date <= today || e.date > end || e.kind === 'transfer') continue;
    if (e.amount < 0) expectedOut += e.amount;
    else expectedIn += e.amount;
  }
  const liquid = summarize(ledger, today).liquid;
  return { end, expectedOut, expectedIn, projectedEnd: liquid + expectedOut + expectedIn };
}

/** Best and worst of the months that are over (the current one isn't finished, so it isn't compared). */
export function bestAndWorst(stats: MonthStats[], today: string) {
  const done = stats.filter(s => s.key < monthKey(today));
  if (!done.length) return {};
  const sorted = [...done].sort((a, b) => b.net - a.net);
  return { best: sorted[0], worst: sorted.length > 1 ? sorted[sorted.length - 1] : undefined };
}

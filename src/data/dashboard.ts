import { allEffects, summarize, type Ledger } from './balance';
import { addDays, dayInMonth } from './dates';
import type { Transaction } from './types';

// A financial month runs from its start day (set in the questionnaire / settings; 1 = calendar month)
// to the day before the next one. It is named by the 'YYYY-MM' of the month it starts in.

const monthOf = (date: string) => date.slice(0, 7);

export function addMonths(key: string, n: number) {
  return dayInMonth(`${key}-01`, n, 1).slice(0, 7);
}

export const periodStart = (key: string, startDay: number) => dayInMonth(`${key}-01`, 0, startDay);
export const periodEnd = (key: string, startDay: number) => addDays(periodStart(addMonths(key, 1), startDay), -1);

/** The financial month a day falls in. */
export function periodKey(date: string, startDay = 1) {
  return date >= periodStart(monthOf(date), startDay) ? monthOf(date) : addMonths(monthOf(date), -1);
}

/** Financial months from the one holding the start date up to today's, oldest first. */
export function monthsSince(startDate: string, today: string, startDay = 1) {
  const keys: string[] = [];
  for (let k = periodKey(startDate, startDay); k <= periodKey(today, startDay); k = addMonths(k, 1)) keys.push(k);
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
 * Income and spending of one financial month, by the day each transaction happened: a card purchase
 * counts in the month you bought it, not when the bank pays it. Transfers between your own accounts are neither.
 */
export function monthStats(transactions: Transaction[], key: string, startDay = 1): MonthStats {
  const start = periodStart(key, startDay);
  const end = periodEnd(key, startDay);
  let income = 0;
  let expenses = 0;
  const cats = new Map<string, number>();
  for (const t of transactions) {
    if (t.date < start || t.date > end) continue;
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

/**
 * What is still expected to leave and arrive from tomorrow to the end of the current financial month,
 * and where that leaves you. `afterCards` also takes off card charges that fall in the first days after
 * the month ends (e.g. a card charged on the 2nd), since they pay for this month's purchases.
 */
export function restOfMonth(ledger: Ledger, today: string, startDay = 1) {
  const end = periodEnd(periodKey(today, startDay), startDay);
  let expectedOut = 0;
  let expectedIn = 0;
  const lateCharges = new Map<string, { date: string; amount: number }>();
  for (const e of allEffects(ledger, today)) {
    if (e.date <= today || e.kind === 'transfer') continue;
    if (e.date <= end) {
      if (e.amount < 0) expectedOut += e.amount;
      else expectedIn += e.amount;
    } else if (e.kind === 'credit' && e.methodId) {
      // Only each card's first charge after the month: the one that bills this month's purchases
      const c = lateCharges.get(e.methodId);
      if (!c || e.date < c.date) lateCharges.set(e.methodId, { date: e.date, amount: e.amount });
      else if (e.date === c.date) c.amount += e.amount;
    }
  }
  const liquid = summarize(ledger, today).liquid;
  const projectedEnd = liquid + expectedOut + expectedIn;
  const charges = [...lateCharges].map(([methodId, c]) => ({ methodId, ...c })).sort((a, b) => a.date.localeCompare(b.date));
  return { end, expectedOut, expectedIn, projectedEnd, lateCharges: charges, afterCards: projectedEnd + charges.reduce((a, c) => a + c.amount, 0) };
}

/** Best and worst of the financial months that are over (the current one isn't finished, so it isn't compared). */
export function bestAndWorst(stats: MonthStats[], today: string, startDay = 1) {
  const done = stats.filter(s => s.key < periodKey(today, startDay));
  if (!done.length) return {};
  const sorted = [...done].sort((a, b) => b.net - a.net);
  return { best: sorted[0], worst: sorted.length > 1 ? sorted[sorted.length - 1] : undefined };
}

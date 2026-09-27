import { monthsSince, monthStats, periodEnd, periodKey, periodStart, type MonthStats } from './dashboard';
import type { MethodKind, PaymentMethod, Transaction } from './types';

// Numbers for the dashboard's charts. All of them count by the day a transaction happened
// (a card purchase in the month it was bought) and leave transfers between your own accounts out.

export type Range = 3 | 6 | 12 | 'all';

/** The financial months a range covers, oldest first, never before the start date. */
export function rangeKeys(range: Range, startDate: string, today: string, startDay: number) {
  const all = monthsSince(startDate, today, startDay);
  return range === 'all' ? all : all.slice(-range);
}

export function rangeBounds(keys: string[], startDay: number) {
  return { from: periodStart(keys[0], startDay), to: periodEnd(keys[keys.length - 1], startDay) };
}

const inRange = (t: Transaction, b: { from: string; to: string }) => t.date >= b.from && t.date <= b.to;

export function totals(months: MonthStats[]) {
  const income = months.reduce((a, m) => a + m.income, 0);
  const expenses = months.reduce((a, m) => a + m.expenses, 0);
  return { income, expenses, net: income - expenses, savingsRate: income > 0 ? (income - expenses) / income : undefined };
}

export const OTHER = 'other';

/** Spending (or income) by category over the range: the biggest `keep`, the rest folded into one "other" slice. */
export function categoryShares(transactions: Transaction[], keys: string[], startDay: number, keep = 7, type: 'expense' | 'income' = 'expense') {
  const b = rangeBounds(keys, startDay);
  const sums = new Map<string, number>();
  for (const t of transactions) {
    if (t.type !== type || !inRange(t, b)) continue;
    sums.set(t.categoryId ?? '', (sums.get(t.categoryId ?? '') ?? 0) + t.amount);
  }
  const sorted = [...sums].map(([categoryId, amount]) => ({ categoryId, amount })).sort((a, b) => b.amount - a.amount);
  const total = sorted.reduce((a, s) => a + s.amount, 0);
  const top = sorted.slice(0, keep);
  const rest = sorted.slice(keep).reduce((a, s) => a + s.amount, 0);
  if (rest > 0) top.push({ categoryId: OTHER, amount: rest });
  return { total, slices: top.map(s => ({ ...s, share: total ? s.amount / total : 0 })) };
}

export interface CategoryChange {
  categoryId: string;
  current: number;
  /** Average per month over the months before, counting months with nothing spent there as 0. */
  average: number;
  /** current − average */
  change: number;
}

/** This month per category against its average over the previous months: where you spent more (or less) than usual. */
export function categoryVsAverage(transactions: Transaction[], currentKey: string, previousKeys: string[], startDay: number): CategoryChange[] {
  const current = monthStats(transactions, currentKey, startDay);
  const prev = previousKeys.map(k => monthStats(transactions, k, startDay));
  const ids = new Set([...current.byCategory.map(c => c.categoryId), ...prev.flatMap(p => p.byCategory.map(c => c.categoryId))]);
  const amountIn = (m: MonthStats, id: string) => m.byCategory.find(c => c.categoryId === id)?.amount ?? 0;
  return [...ids]
    .map(id => {
      const cur = amountIn(current, id);
      const average = prev.length ? Math.round(prev.reduce((a, m) => a + amountIn(m, id), 0) / prev.length) : 0;
      return { categoryId: id, current: cur, average, change: cur - average };
    })
    .sort((a, b) => b.change - a.change);
}

export const METHOD_KINDS: MethodKind[] = ['credit', 'cash', 'bank', 'app', 'other'];

/** Spending split by how it was paid. */
export function byMethodKind(transactions: Transaction[], methods: PaymentMethod[], keys: string[], startDay: number) {
  const b = rangeBounds(keys, startDay);
  const kind = new Map(methods.map(m => [m.id, m.kind]));
  const sums = new Map<MethodKind, number>();
  for (const t of transactions) {
    if (t.type !== 'expense' || !inRange(t, b)) continue;
    const k = kind.get(t.methodId ?? '') ?? 'other';
    sums.set(k, (sums.get(k) ?? 0) + t.amount);
  }
  return METHOD_KINDS.map(k => ({ kind: k, amount: sums.get(k) ?? 0 })).filter(s => s.amount > 0);
}

export function biggestExpenses(transactions: Transaction[], keys: string[], startDay: number, n = 5) {
  const b = rangeBounds(keys, startDay);
  return transactions
    .filter(t => t.type === 'expense' && inRange(t, b))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, n);
}

/** Income, spending and what's left per calendar year, newest first. */
export function byYear(transactions: Transaction[]) {
  const years = new Map<string, { income: number; expenses: number }>();
  for (const t of transactions) {
    if (t.type === 'transfer') continue;
    const y = t.date.slice(0, 4);
    const row = years.get(y) ?? { income: 0, expenses: 0 };
    if (t.type === 'income') row.income += t.amount;
    else row.expenses += t.amount;
    years.set(y, row);
  }
  return [...years]
    .map(([year, r]) => ({ year, ...r, net: r.income - r.expenses }))
    .sort((a, b) => b.year.localeCompare(a.year));
}

export { periodKey };

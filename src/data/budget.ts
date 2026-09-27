import { expectedExpenses, monthsSince, monthStats, periodEnd, periodKey, periodStart } from './dashboard';
import { addDays } from './dates';
import type { AppData } from './store';
import type { Transaction } from './types';

/** Set in the budget tab's questionnaire; kept in meta so it travels with backups. */
export interface Budget {
  /** Whole-month spending limit; missing = no overall limit. */
  overall?: number;
  /** Limits for chosen expense categories. */
  categories: Record<string, number>;
  /**
   * Money moved to savings: counted as an ordinary expense, or kept apart ("separate"): it still
   * leaves your available money, but isn't spending and doesn't use up the budget.
   */
  savingsMode: 'expense' | 'separate';
  /** The expense category that stands for "moved to savings" (separate mode). */
  savingsCategoryId?: string;
}

/**
 * Transactions as the spending numbers should see them. With savings kept apart, money put into
 * savings is taken out of spending (treated like a transfer); balances still use the real list.
 */
export function statsTransactions(data: Pick<AppData, 'transactions' | 'budget'>): Transaction[] {
  const b = data.budget;
  if (!b || b.savingsMode !== 'separate' || !b.savingsCategoryId) return data.transactions;
  return data.transactions.map(t => (t.type === 'expense' && t.categoryId === b.savingsCategoryId ? { ...t, type: 'transfer' as const } : t));
}

export function savedIn(data: Pick<AppData, 'transactions' | 'budget'>, from: string, to: string) {
  const b = data.budget;
  if (!b || b.savingsMode !== 'separate' || !b.savingsCategoryId) return 0;
  return data.transactions
    .filter(t => t.type === 'expense' && t.categoryId === b.savingsCategoryId && t.date >= from && t.date <= to)
    .reduce((a, t) => a + t.amount, 0);
}

export interface BudgetLine {
  limit: number;
  /** Already spent this month. */
  spent: number;
  /** Standing orders and other recurring expenses still due before the month ends. */
  expected: number;
}

export interface BudgetStatus {
  end: string;
  /** Days left in the month including today. */
  daysLeft: number;
  overall?: BudgetLine & { remaining: number; perDay: number };
  categories: (BudgetLine & { categoryId: string })[];
  saved: number;
}

/** Where this financial month stands against the budget, counting what's still expected as already committed. */
export function budgetStatus(data: AppData, today: string): BudgetStatus | undefined {
  const b = data.budget;
  if (!b) return undefined;
  const key = periodKey(today, data.monthStartDay);
  const end = periodEnd(key, data.monthStartDay);
  const txs = statsTransactions(data);
  const stats = monthStats(txs, key, data.monthStartDay);
  const expected = expectedExpenses(data, today, end).filter(t => !(b.savingsMode === 'separate' && t.categoryId === b.savingsCategoryId));
  const expectedIn = (id?: string) => expected.filter(t => id === undefined || t.categoryId === id).reduce((a, t) => a + t.amount, 0);
  const spentIn = (id: string) => stats.byCategory.find(c => c.categoryId === id)?.amount ?? 0;
  let daysLeft = 0;
  for (let d = today; d <= end; d = addDays(d, 1)) daysLeft++;

  const overall =
    b.overall !== undefined
      ? (() => {
          const line = { limit: b.overall, spent: stats.expenses, expected: expectedIn() };
          const remaining = line.limit - line.spent - line.expected;
          return { ...line, remaining, perDay: Math.max(0, Math.floor(remaining / Math.max(1, daysLeft))) };
        })()
      : undefined;
  const categories = Object.entries(b.categories)
    .filter(([, limit]) => limit > 0)
    .map(([categoryId, limit]) => ({ categoryId, limit, spent: spentIn(categoryId), expected: expectedIn(categoryId) }))
    .sort((x, y) => (y.spent + y.expected) / y.limit - (x.spent + x.expected) / x.limit);
  return { end, daysLeft, overall, categories, saved: savedIn(data, periodStart(key, data.monthStartDay), end) };
}

/**
 * What you usually spend, to suggest limits: the monthly average of the finished months (up to the
 * last three), or, before any month has finished, this month so far. Per category and overall.
 */
export function usualSpending(data: AppData, today: string) {
  const txs = statsTransactions(data);
  const current = periodKey(today, data.monthStartDay);
  const done = monthsSince(data.startDate, today, data.monthStartDay).filter(k => k < current).slice(-3);
  const months = (done.length ? done : [current]).map(k => monthStats(txs, k, data.monthStartDay));
  const byCategory: Record<string, number> = {};
  for (const m of months) for (const c of m.byCategory) byCategory[c.categoryId] = (byCategory[c.categoryId] ?? 0) + c.amount / months.length;
  const overall = months.reduce((a, m) => a + m.expenses, 0) / months.length;
  return { basedOnFinishedMonths: done.length, overall: Math.round(overall), byCategory };
}

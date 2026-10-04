import { monthsSince, monthStats, periodEnd, periodKey, periodStart } from './dashboard';
import { estimateFor, scheduleDatesIn } from './recurring';
import { addDays } from './dates';
import type { AppData } from './store';
import type { Category, Recurring, Transaction } from './types';

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
  /**
   * Standing orders and other recurring expenses: taken out of the monthly budget up front ("included",
   * the default), or kept beside it so the budget covers day-to-day spending only ("separate").
   */
  fixedMode?: 'included' | 'separate';
}

type SavingsSource = Pick<AppData, 'budget'> & { categories?: Category[] };

/** The expense categories that stand for money put into savings: marked so, or the budget's own one. */
export function savingsCategoryIds(data: SavingsSource): Set<string> {
  const ids = new Set((data.categories ?? []).filter(c => c.kind === 'expense' && c.savings).map(c => c.id));
  const b = data.budget;
  if (b?.savingsMode === 'separate' && b.savingsCategoryId) ids.add(b.savingsCategoryId);
  return ids;
}

/** Money put into savings: an expense in a savings category. */
export const isSaving = (t: Pick<Transaction, 'type' | 'categoryId'>, ids: Set<string>) => t.type === 'expense' && ids.has(t.categoryId ?? '');

/**
 * Transactions as the spending numbers should see them: money put into savings is taken out of spending
 * (treated like a transfer); balances still use the real list.
 */
export function statsTransactions(data: Pick<AppData, 'transactions'> & SavingsSource): Transaction[] {
  const ids = savingsCategoryIds(data);
  if (!ids.size) return data.transactions;
  return data.transactions.map(t => (isSaving(t, ids) ? { ...t, type: 'transfer' as const } : t));
}

export function savedIn(data: Pick<AppData, 'transactions'> & SavingsSource, from: string, to: string) {
  const ids = savingsCategoryIds(data);
  return data.transactions.filter(t => isSaving(t, ids) && t.date >= from && t.date <= to).reduce((a, t) => a + t.amount, 0);
}

export interface BudgetLine {
  limit: number;
  /** Day-to-day spending so far this month (everything not from a standing order or other recurring item). */
  spent: number;
  /** This month's standing orders and other recurring expenses, whole month (counted when "included"). */
  fixed: number;
}

/** One standing order (or other recurring expense) this month. */
export interface Commitment {
  rec: Recurring;
  dates: string[];
  /** For the month: the recorded amount where there is one, else what's expected. */
  amount: number;
  /** The part whose date has already come. */
  paid: number;
}

export interface BudgetStatus {
  end: string;
  /** Days left in the month including today. */
  daysLeft: number;
  /** Standing orders taken out of the budget up front ("included"), or shown beside it ("separate"). */
  fixedMode: 'included' | 'separate';
  commitments: Commitment[];
  overall?: BudgetLine & { remaining: number; perDay: number };
  categories: (BudgetLine & { categoryId: string })[];
  saved: number;
}

/**
 * This financial month's standing orders and other recurring expenses, each for the whole month by its
 * schedule - including dates before it was added to the app, which went out all the same.
 * Money moved to savings (when kept apart) isn't one.
 */
export function monthCommitments(data: AppData, from: string, to: string, today: string): Commitment[] {
  const saving = savingsCategoryIds(data);
  return data.recurring
    .filter(r => r.type === 'expense' && !saving.has(r.categoryId ?? ''))
    .map(rec => {
      const dates = scheduleDatesIn(rec, from, to);
      const estimate = estimateFor(rec, data.transactions);
      let amount = 0;
      let paid = 0;
      for (const d of dates) {
        const recorded = data.transactions.find(t => t.recurringId === rec.id && t.occurrence === d);
        const value = recorded?.amount ?? estimate;
        amount += value;
        if (d <= today) paid += value;
      }
      return { rec, dates, amount, paid };
    })
    .filter(c => c.dates.length > 0);
}

/** Where this financial month stands against the budget. */
export function budgetStatus(data: AppData, today: string): BudgetStatus | undefined {
  const b = data.budget;
  if (!b) return undefined;
  const fixedMode = b.fixedMode ?? 'included';
  const key = periodKey(today, data.monthStartDay);
  const start = periodStart(key, data.monthStartDay);
  const end = periodEnd(key, data.monthStartDay);
  // Day-to-day spending leaves out what the recurring items recorded: those are counted as commitments
  const dayToDay = statsTransactions(data).filter(t => !t.recurringId);
  const stats = monthStats(dayToDay, key, data.monthStartDay);
  const commitments = monthCommitments(data, start, end, today);
  const fixedIn = (id?: string) =>
    fixedMode === 'included' ? commitments.filter(c => id === undefined || c.rec.categoryId === id).reduce((acc, c) => acc + c.amount, 0) : 0;
  const spentIn = (id: string) => stats.byCategory.find(c => c.categoryId === id)?.amount ?? 0;
  let daysLeft = 0;
  for (let d = today; d <= end; d = addDays(d, 1)) daysLeft++;

  const overall =
    b.overall !== undefined
      ? (() => {
          const line = { limit: b.overall, spent: stats.expenses, fixed: fixedIn() };
          const remaining = line.limit - line.spent - line.fixed;
          // Per day in whole shekels, rounded down so it never promises more than is left
          return { ...line, remaining, perDay: Math.max(0, Math.floor(remaining / Math.max(1, daysLeft) / 100) * 100) };
        })()
      : undefined;
  const categories = Object.entries(b.categories)
    .filter(([, limit]) => limit > 0)
    .map(([categoryId, limit]) => ({ categoryId, limit, spent: spentIn(categoryId), fixed: fixedIn(categoryId) }))
    .sort((x, y) => (y.spent + y.fixed) / y.limit - (x.spent + x.fixed) / x.limit);
  return { end, daysLeft, fixedMode, commitments, overall, categories, saved: savedIn(data, start, end) };
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

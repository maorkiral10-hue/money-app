import { dayInMonth, parseDate } from './dates';
import type { Account, Transaction } from './types';

/** How a goal is going: what to put in each month to make it, and what went in this month. */
export interface GoalPlan {
  saved: number;
  /** Already paid straight out of the goal for what it's for: counts towards the target. */
  spent: number;
  /** For a goal with a target: 0..1. */
  progress?: number;
  /** What to put in each month from now on: to reach the target by its date, or the fixed monthly amount. */
  perMonth?: number;
  monthsLeft?: number;
  /** Moved into the goal this calendar month (minus what was taken out). */
  thisMonth: number;
  /** What's still to put in this month to keep to perMonth. */
  leftThisMonth: number;
  reached: boolean;
}

/** Whole months from this month to the target date's month, counting both (a goal due this month has 1). */
export function monthsUntil(today: string, date: string) {
  const a = parseDate(today);
  const b = parseDate(date);
  return Math.max(1, (b.y - a.y) * 12 + (b.m0 - a.m0) + 1);
}

export function goalPlan(goal: Account, saved: number, transactions: Transaction[], today: string): GoalPlan {
  const monthStart = dayInMonth(today, 0, 1);
  const thisMonth = transactions
    .filter(t => t.type === 'transfer' && t.date >= monthStart && t.date <= today)
    .reduce((a, t) => a + (t.toAccountId === goal.id ? t.amount : t.accountId === goal.id ? -t.amount : 0), 0);
  const spent = transactions.filter(t => t.type === 'expense' && t.accountId === goal.id).reduce((a, t) => a + t.amount, 0);
  // Paying for the goal out of it (a flight for the trip) is progress, not falling behind
  const done = saved + spent;
  const target = goal.goalTarget;
  const reached = !!target && done >= target;
  const left = (perMonth?: number) => (perMonth ? Math.max(0, perMonth - thisMonth) : 0);
  if (target && goal.goalDate && !reached) {
    const monthsLeft = goal.goalDate < today ? 1 : monthsUntil(today, goal.goalDate);
    // Worked out from where the goal stood when this month began, so a deposit made this month counts
    // towards this month instead of lowering the monthly amount
    const perMonth = Math.ceil((target - (done - thisMonth)) / monthsLeft / 100) * 100;
    return { saved, spent, progress: done / target, perMonth, monthsLeft, thisMonth, leftThisMonth: left(perMonth), reached };
  }
  const perMonth = reached ? undefined : goal.goalMonthly;
  return { saved, spent, progress: target ? Math.min(1, done / target) : undefined, perMonth, thisMonth, leftThisMonth: left(perMonth), reached };
}

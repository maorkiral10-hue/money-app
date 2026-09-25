import { addDays, dayInMonth, parseDate } from './dates';
import type { Recurring, Transaction } from './types';

const AVERAGE_OF = 3;

/** Occurrence dates d with after < d <= through (and within the item's first and end dates), oldest first. */
export function occurrencesBetween(rec: Recurring, after: string, through: string): string[] {
  const last = rec.endDate && rec.endDate < through ? rec.endDate : through;
  const day = parseDate(rec.firstDate).d;
  const dates: string[] = [];
  for (let i = 0; ; i++) {
    const d =
      rec.frequency === 'monthly' ? dayInMonth(rec.firstDate, i, day) : addDays(rec.firstDate, rec.frequency === 'weekly' ? i * 7 : i);
    if (d > last) break;
    if (d > after) dates.push(d);
  }
  return dates;
}

/** Occurrences not yet recorded or dismissed, up to `through`. Never before the start date: those are in the opening balances. */
export function openOccurrences(rec: Recurring, through: string, startDate: string) {
  const dayBeforeStart = addDays(startDate, -1);
  return occurrencesBetween(rec, rec.handledThrough > dayBeforeStart ? rec.handledThrough : dayBeforeStart, through);
}

/** What to expect next time: the set amount, or the average of the last confirmed ones. */
export function estimateFor(rec: Recurring, transactions: Transaction[]) {
  if (!rec.variable || rec.estimate === 'set') return rec.amount;
  const past = transactions
    .filter(t => t.recurringId === rec.id)
    .sort((a, b) => (b.occurrence ?? b.date).localeCompare(a.occurrence ?? a.date))
    .slice(0, AVERAGE_OF);
  return past.length ? Math.round(past.reduce((a, t) => a + t.amount, 0) / past.length) : rec.amount;
}

export function occurrenceTransaction(rec: Recurring, occurrence: string, amount: number, id: string = crypto.randomUUID()): Transaction {
  const now = new Date().toISOString();
  return {
    id,
    type: rec.type,
    amount,
    date: occurrence,
    categoryId: rec.categoryId,
    ...(rec.type === 'expense' ? { methodId: rec.methodId } : { accountId: rec.accountId }),
    note: rec.name,
    recurringId: rec.id,
    occurrence,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Expected occurrences up to `until` as not-yet-real transactions, for the forecast only.
 * Variable ones still waiting for confirmation are placed tomorrow: expected, but not in today's balance.
 */
export function expectedTransactions(recurring: Recurring[], transactions: Transaction[], today: string, until: string, startDate: string) {
  const tomorrow = addDays(today, 1);
  return recurring.flatMap(rec => {
    const amount = estimateFor(rec, transactions);
    return openOccurrences(rec, until, startDate).map(occ => ({
      ...occurrenceTransaction(rec, occ, amount, `expected:${rec.id}:${occ}`),
      date: occ < tomorrow ? tomorrow : occ,
    }));
  });
}

export const nextOccurrence = (rec: Recurring, today: string) =>
  occurrencesBetween(rec, addDays(today, -1), addDays(today, 400))[0] as string | undefined;

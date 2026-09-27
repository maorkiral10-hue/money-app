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
      rec.frequency === 'yearly'
        ? dayInMonth(rec.firstDate, i * 12, day)
        : rec.frequency === 'monthly'
          ? dayInMonth(rec.firstDate, i, day)
          : addDays(rec.firstDate, rec.frequency === 'weekly' ? i * 7 : i);
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

const CYCLE_DAYS: Record<Recurring['frequency'], number> = { daily: 1, weekly: 7, monthly: 31, yearly: 366 };

/**
 * The item's dates within [from, to] by its schedule, including ones before its first date: a standing
 * order added mid-month usually already went out that month. An item whose first date is more than one
 * cycle after `to` hasn't started yet and has none; an ended one has none after its end.
 */
export function scheduleDatesIn(rec: Recurring, from: string, to: string): string[] {
  if (rec.firstDate > addDays(to, CYCLE_DAYS[rec.frequency])) return [];
  const last = rec.endDate && rec.endDate < to ? rec.endDate : to;
  const { m0, d } = parseDate(rec.firstDate);
  const dates: string[] = [];
  if (rec.frequency === 'daily') {
    for (let x = from; x <= last; x = addDays(x, 1)) dates.push(x);
  } else if (rec.frequency === 'weekly') {
    const weekday = new Date(`${rec.firstDate}T12:00:00`).getDay();
    let x = from;
    while (new Date(`${x}T12:00:00`).getDay() !== weekday) x = addDays(x, 1);
    for (; x <= last; x = addDays(x, 7)) dates.push(x);
  } else {
    const step = rec.frequency === 'yearly' ? 12 : 1;
    // Walk month by month (or year by year) from a month before `from` to past `to`
    const startMonth = rec.frequency === 'yearly' ? `${from.slice(0, 4)}-${String(m0 + 1).padStart(2, '0')}-01` : `${from.slice(0, 7)}-01`;
    for (let i = -1; ; i++) {
      const x = dayInMonth(startMonth, i * step, d);
      if (x > last) break;
      if (x >= from) dates.push(x);
    }
  }
  return dates;
}

/** The next occurrence not yet recorded: today's counts until it has been. */
export function nextOccurrence(rec: Recurring, today: string) {
  const yesterday = addDays(today, -1);
  return occurrencesBetween(rec, rec.handledThrough > yesterday ? rec.handledThrough : yesterday, addDays(today, 400))[0] as string | undefined;
}

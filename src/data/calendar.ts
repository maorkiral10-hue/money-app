import { addDays, daysInMonth, parseDate, ymd } from './dates';
import type { CalendarEvent } from './types';

/** How much of the calendar shows at once; pinching moves between them. */
export type Zoom = 'year' | 'month' | 'week';
export const ZOOMS: Zoom[] = ['year', 'month', 'week'];

/** Weeks start on Sunday, as in Israel. */
export const WEEKDAYS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];

export const weekday = (s: string) => {
  const { y, m0, d } = parseDate(s);
  return new Date(y, m0, d).getDay();
};
export const weekStart = (s: string) => addDays(s, -weekday(s));
export const monthStart = (s: string) => s.slice(0, 8) + '01';

/** A month laid out in weeks: its days, with null for the blanks before the 1st and after the last day. */
export function monthGrid(s: string): (string | null)[] {
  const { y, m0 } = parseDate(s);
  const first = ymd(y, m0, 1);
  const cells: (string | null)[] = Array(weekday(first)).fill(null);
  for (let d = 1; d <= daysInMonth(y, m0); d++) cells.push(ymd(y, m0, d));
  while (cells.length % 7) cells.push(null);
  return cells;
}

/** First and last day of the year, month or week that `s` falls in. */
export function periodRange(zoom: Zoom, s: string): [string, string] {
  const { y, m0 } = parseDate(s);
  if (zoom === 'year') return [ymd(y, 0, 1), ymd(y, 11, 31)];
  if (zoom === 'month') return [ymd(y, m0, 1), ymd(y, m0, daysInMonth(y, m0))];
  const start = weekStart(s);
  return [start, addDays(start, 6)];
}

/** The same place one period on (or back, with -1). */
export function shiftPeriod(zoom: Zoom, s: string, by: number) {
  const { y, m0, d } = parseDate(s);
  if (zoom === 'week') return addDays(s, 7 * by);
  if (zoom === 'year') return ymd(y + by, m0, Math.min(d, daysInMonth(y + by, m0)));
  const first = new Date(y, m0 + by, 1);
  return ymd(first.getFullYear(), first.getMonth(), Math.min(d, daysInMonth(first.getFullYear(), first.getMonth())));
}

/** What the events between two days (inclusive) are expected to bring in and cost. */
export function eventTotals(events: CalendarEvent[], from: string, to: string) {
  let income = 0;
  let expense = 0;
  for (const e of events) {
    if (e.date < from || e.date > to) continue;
    if (e.type === 'income') income += e.amount;
    else if (e.type === 'expense') expense += e.amount;
  }
  return { income, expense };
}

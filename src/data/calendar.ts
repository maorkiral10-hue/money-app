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

const toMinutes = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
export const timeLabel = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** Start and end of a timed event, in minutes from midnight. With no end time it's taken as an hour long. */
export function eventSpan(e: CalendarEvent): [number, number] | null {
  if (!e.startTime) return null;
  const start = toMinutes(e.startTime);
  const end = e.endTime ? toMinutes(e.endTime) : start + 60;
  return [start, Math.max(end, start + 15)];
}

/** When an event is over: its end time, an hour after its start, or (all day) the end of its day. */
export function eventEnd(e: CalendarEvent): Date {
  const { y, m0, d } = parseDate(e.date);
  const span = eventSpan(e);
  return span ? new Date(y, m0, d, 0, span[1]) : new Date(y, m0, d + 1);
}

/** Events with an expected amount that are over and still wait for "how much was it in the end?", oldest first. */
export const awaitingActual = (events: CalendarEvent[], now: Date) =>
  events.filter(e => e.type !== 'none' && !e.settled && eventEnd(e) <= now).sort((a, b) => eventEnd(a).getTime() - eventEnd(b).getTime());

export interface TimedEvent {
  event: CalendarEvent;
  start: number;
  end: number;
  /** Events that overlap share the width: this one's column, out of `columns`. */
  column: number;
  columns: number;
}

/** A day's timed events placed on the hour grid, overlapping ones side by side. */
export function layoutDay(events: CalendarEvent[]): TimedEvent[] {
  const timed = events
    .map(event => ({ event, span: eventSpan(event) }))
    .filter((t): t is { event: CalendarEvent; span: [number, number] } => !!t.span)
    .sort((a, b) => a.span[0] - b.span[0] || b.span[1] - a.span[1]);
  const out: TimedEvent[] = [];
  // Groups of events that overlap one another, directly or through a chain
  let group: TimedEvent[] = [];
  let groupEnd = -1;
  const close = () => {
    const columns = Math.max(1, ...group.map(g => g.column + 1));
    for (const g of group) g.columns = columns;
    out.push(...group);
    group = [];
  };
  for (const { event, span } of timed) {
    if (span[0] >= groupEnd) close();
    const taken = new Set(group.filter(g => g.end > span[0]).map(g => g.column));
    let column = 0;
    while (taken.has(column)) column++;
    group.push({ event, start: span[0], end: span[1], column, columns: 1 });
    groupEnd = Math.max(groupEnd, span[1]);
  }
  close();
  return out;
}

/** Hours to draw for a day: 8:00 to 21:00, stretched to fit any earlier or later event. */
export function dayHours(timed: TimedEvent[]): [number, number] {
  const first = Math.min(8, ...timed.map(t => Math.floor(t.start / 60)));
  const last = Math.max(21, ...timed.map(t => Math.ceil(t.end / 60)));
  return [first, Math.min(24, last)];
}

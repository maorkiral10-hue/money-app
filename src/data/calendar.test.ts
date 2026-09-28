import { describe, expect, it } from 'vitest';
import { awaitingActual, dayHours, eventBalance, expandEvents, occurrencesIn, withAnswer, eventEnd, eventTotals, layoutDay, monthGrid, periodRange, shiftPeriod, weekStart } from './calendar';
import { migrateSnapshot } from './migrations';
import type { Snapshot } from './snapshot';
import type { CalendarEvent } from './types';

const ev = (date: string, type: CalendarEvent['type'], amount: number): CalendarEvent => ({ id: date + type, date, title: 'x', type, amount, createdAt: '' });

describe('calendar', () => {
  it('lays a month out in weeks starting on Sunday', () => {
    // 1 September 2026 is a Tuesday
    const grid = monthGrid('2026-09-15');
    expect(grid.slice(0, 3)).toEqual([null, null, '2026-09-01']);
    expect(grid.length % 7).toBe(0);
    expect(grid.filter(Boolean)).toHaveLength(30);
    expect(weekStart('2026-09-29')).toBe('2026-09-27');
  });

  it('finds the period and moves by one', () => {
    expect(periodRange('month', '2026-02-10')).toEqual(['2026-02-01', '2026-02-28']);
    expect(periodRange('week', '2026-09-29')).toEqual(['2026-09-27', '2026-10-03']);
    expect(periodRange('year', '2026-09-29')).toEqual(['2026-01-01', '2026-12-31']);
    expect(shiftPeriod('month', '2026-01-31', 1)).toBe('2026-02-28');
    expect(shiftPeriod('week', '2026-09-29', -1)).toBe('2026-09-22');
    expect(shiftPeriod('year', '2028-02-29', 1)).toBe('2029-02-28');
  });

  it('sums expected income and costs in a period; events without money add nothing', () => {
    const events = [ev('2026-10-05', 'expense', 1_200_00), ev('2026-10-20', 'income', 3_000_00), ev('2026-10-21', 'none', 0), ev('2026-11-01', 'expense', 500_00)];
    expect(eventTotals(events, '2026-10-01', '2026-10-31')).toEqual({ income: 3_000_00, expense: 1_200_00 });
  });

  it('older saved data gets an empty events list, and nothing else changes', () => {
    const snap: Snapshot = {
      format: 'money-app-backup', formatVersion: 1, appVersion: 38, dataVersion: 3, createdAt: '',
      stores: { meta: [['dataVersion', 3]], notes: [], accounts: [], methods: [], categories: [], transactions: [], recurring: [] } as unknown as Snapshot['stores'],
    };
    const out = migrateSnapshot(snap);
    expect(out.stores.events).toEqual([]);
    expect(out.dataVersion).toBe(4);
  });

  it('knows when an event is over, and asks about the ones with money once they are', () => {
    const allDay = ev('2026-10-15', 'expense', 1_200_00);
    const timed = { ...ev('2026-10-16', 'income', 500_00), startTime: '18:00', endTime: '23:30' };
    const startOnly = { ...ev('2026-10-17', 'expense', 100_00), startTime: '09:00' };
    expect(eventEnd(allDay)).toEqual(new Date(2026, 9, 16));
    expect(eventEnd(timed)).toEqual(new Date(2026, 9, 16, 23, 30));
    expect(eventEnd(startOnly)).toEqual(new Date(2026, 9, 17, 10, 0));
    const events = [startOnly, timed, allDay, ev('2026-10-10', 'none', 0), { ...ev('2026-10-11', 'expense', 50_00), settled: { at: '' } }];
    expect(awaitingActual(events, new Date(2026, 9, 16, 23, 0)).map(e => e.date)).toEqual(['2026-10-15']);
    expect(awaitingActual(events, new Date(2026, 9, 17, 10, 0)).map(e => e.date)).toEqual(['2026-10-15', '2026-10-16', '2026-10-17']);
  });

  it('places overlapping events side by side on the day', () => {
    const at = (id: string, startTime: string, endTime: string) => ({ ...ev('2026-10-15', 'none', 0), id, startTime, endTime });
    const laid = layoutDay([at('a', '09:00', '11:00'), at('b', '10:00', '12:00'), at('c', '13:00', '14:00'), ev('2026-10-15', 'none', 0)]);
    expect(laid.map(l => [l.event.id, l.column, l.columns])).toEqual([['a', 0, 2], ['b', 1, 2], ['c', 0, 1]]);
    expect(dayHours(laid)).toEqual([8, 21]);
    expect(dayHours(layoutDay([at('late', '06:30', '23:15')]))).toEqual([6, 24]);
  });

  it('compares what answered events were expected to cost with what they did', () => {
    const tx = { id: 't', type: 'expense' as const, amount: 1_150_00, date: '2026-09-10', createdAt: '', updatedAt: '' };
    const events = [
      { ...ev('2026-09-10', 'expense', 1_200_00), settled: { at: '', txId: 't' } },
      { ...ev('2026-09-12', 'expense', 200_00), settled: { at: '' } },
      ev('2026-09-25', 'income', 500_00),
      ev('2026-09-26', 'none', 0),
      { ...ev('2026-10-01', 'expense', 90_00), settled: { at: '' } },
    ];
    expect(eventBalance(events, [tx], '2026-09-01', '2026-09-30')).toEqual({ expected: -1_400_00, actual: -1_150_00, answered: 2, open: 500_00, openCount: 1 });
  });

  it('finds the days a repeating event falls on', () => {
    const base = ev('2026-01-31', 'none', 0);
    expect(occurrencesIn({ ...base, repeat: 'monthly' }, '2026-01-01', '2026-04-30')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
    expect(occurrencesIn({ ...base, date: '2026-09-01', repeat: 'weekly' }, '2026-09-10', '2026-09-30')).toEqual(['2026-09-15', '2026-09-22', '2026-09-29']);
    expect(occurrencesIn({ ...base, date: '2026-09-28', repeat: 'daily', repeatUntil: '2026-09-30' }, '2026-09-01', '2026-10-31')).toEqual(['2026-09-28', '2026-09-29', '2026-09-30']);
    expect(occurrencesIn({ ...base, date: '2024-02-29', repeat: 'yearly' }, '2025-01-01', '2028-12-31')).toEqual(['2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29']);
    expect(occurrencesIn(base, '2026-02-01', '2026-02-28')).toEqual([]);
  });

  it('asks about each repeat of a repeating event on its own, and keeps each answer', () => {
    const gym = { ...ev('2026-09-26', 'expense', 30_00), id: 'gym', repeat: 'daily' as const };
    const asked = awaitingActual([gym], new Date(2026, 8, 28, 12, 0));
    expect(asked.map(e => e.date)).toEqual(['2026-09-26', '2026-09-27']);
    const answered = withAnswer(gym, '2026-09-26', { at: '' });
    expect(awaitingActual([answered], new Date(2026, 8, 28, 12, 0)).map(e => e.date)).toEqual(['2026-09-27']);
    expect(expandEvents([answered], '2026-09-26', '2026-09-27').map(e => [e.id, e.date, !!e.settled])).toEqual([['gym', '2026-09-26', true], ['gym', '2026-09-27', false]]);
  });
});

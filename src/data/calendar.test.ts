import { describe, expect, it } from 'vitest';
import { eventTotals, monthGrid, periodRange, shiftPeriod, weekStart } from './calendar';
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
});

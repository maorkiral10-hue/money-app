import { describe, expect, it } from 'vitest';
import { summarize } from './balance';
import { cut, daysBetween, liquidByDay, periodOf, periodStats, savedIn } from './dash';
import type { AppData } from './store';
import type { Transaction } from './types';

let n = 0;
const tx = (t: Partial<Transaction>): Transaction => ({
  id: String(++n), type: 'expense', amount: 0, date: '2026-09-10', methodId: 'cash', createdAt: '', updatedAt: '', ...t,
});

const base = (over: Partial<AppData>): AppData => ({
  accounts: [
    { id: 'bank', name: 'בנק', kind: 'bank', openingBalance: 10_000_00, order: 0 },
    { id: 'wallet', name: 'ארנק', kind: 'cash', openingBalance: 500_00, order: 1 },
    { id: 'trip', name: 'טיול', kind: 'goal', openingBalance: 0, order: 2, goalPlace: 'deposit' },
  ],
  methods: [
    { id: 'cash', name: 'מזומן', kind: 'cash', accountId: 'wallet', order: 0 },
    { id: 'visa', name: 'ויזה', kind: 'credit', accountId: 'bank', chargeDay: 10, order: 1 },
  ],
  categories: [
    { id: 'food', name: 'מכולת', kind: 'expense', order: 0 },
    { id: 'save', name: 'חיסכון', kind: 'expense', order: 1, savings: true },
    { id: 'unk', name: 'לא מזוהה', kind: 'expense', order: 2 },
    { id: 'salary', name: 'משכורת', kind: 'income', order: 0 },
  ],
  transactions: [], recurring: [], events: [], setupDone: true, startDate: '2026-08-01', openOnEntry: true, monthStartDay: 1, balanceChecks: [], checkEvery: 'never', checkMode: 'together', checkEveryByAccount: {}, checkTolerance: 0, cardChecks: [], funds: [], gapGraceDays: 3, cardGapReminded: [], verified: {}, ...over,
});

describe('periods', () => {
  it('a week runs Sunday to Saturday', () => {
    // 19.11.2026 is a Thursday
    expect(periodOf('week', 0, '2026-11-19')).toEqual({ from: '2026-11-15', to: '2026-11-21' });
    expect(periodOf('week', -1, '2026-11-19')).toEqual({ from: '2026-11-08', to: '2026-11-14' });
  });
  it('months, three months and years follow the financial month', () => {
    expect(periodOf('month', -1, '2026-11-19')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(periodOf('month', 0, '2026-11-19', 10)).toEqual({ from: '2026-11-10', to: '2026-12-09' });
    expect(periodOf('quarter', 0, '2026-11-19')).toEqual({ from: '2026-09-01', to: '2026-11-30' });
    expect(periodOf('quarter', -1, '2026-11-19')).toEqual({ from: '2026-06-01', to: '2026-08-31' });
    expect(periodOf('year', -1, '2026-11-19')).toEqual({ from: '2025-01-01', to: '2025-12-31' });
  });
  it('cuts an earlier period to the same point as a running one', () => {
    const days = daysBetween('2026-11-01', '2026-11-19');
    expect(cut(periodOf('month', -1, '2026-11-19'), days)).toEqual({ from: '2026-10-01', to: '2026-10-19' });
    // February is shorter than the point reached
    expect(cut({ from: '2026-02-01', to: '2026-02-28' }, 29)).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });
});

describe('period numbers', () => {
  const data = base({
    transactions: [
      tx({ amount: 300_00, categoryId: 'food', methodId: 'visa', date: '2026-09-05' }),
      tx({ amount: 100_00, categoryId: 'food', date: '2026-09-06' }),
      tx({ amount: 1_200_00, categoryId: 'food', methodId: undefined, accountId: 'bank', recurringId: 'r', date: '2026-09-01' }),
      tx({ amount: 500_00, categoryId: 'save', methodId: undefined, accountId: 'bank', date: '2026-09-02' }),
      tx({ amount: 40_00, categoryId: 'unk', note: 'פער בבדיקה מול ארנק', date: '2026-09-08' }),
      tx({ type: 'income', amount: 9_000_00, categoryId: 'salary', methodId: undefined, accountId: 'bank', date: '2026-09-10' }),
      tx({ type: 'transfer', amount: 700_00, methodId: undefined, accountId: 'bank', toAccountId: 'trip', date: '2026-09-11' }),
      tx({ type: 'transfer', amount: 200_00, methodId: undefined, accountId: 'trip', toAccountId: 'bank', date: '2026-09-12' }),
      tx({ amount: 999_00, categoryId: 'food', date: '2026-10-01' }),
    ],
  });
  const s = periodStats(data, periodOf('month', 0, '2026-09-20'));

  it('spending leaves savings out, savings counts goals in and out', () => {
    expect(s.expenses).toBe(1_640_00);
    expect(s.income).toBe(9_000_00);
    expect(s.saved).toBe(500_00 + 700_00 - 200_00);
  });
  it('splits fixed, by method and unknown', () => {
    expect(s.fixed).toBe(1_200_00);
    expect(s.byMethod).toEqual([
      { name: 'בנק', amount: 1_200_00 },
      { name: 'ויזה', amount: 300_00 },
      { name: 'מזומן', amount: 140_00 },
    ]);
    expect(s.unknown).toBe(40_00);
    expect(s.byCategory[0]).toEqual({ categoryId: 'food', amount: 1_600_00 });
  });
  it('never counts negative savings', () => {
    expect(savedIn(data, { from: '2026-09-12', to: '2026-09-12' })).toBe(0);
  });
  it('the liquid money each day matches the home screen', () => {
    const days = liquidByDay(data, '2026-10-15');
    for (const d of ['2026-08-01', '2026-09-05', '2026-09-10', '2026-09-11', '2026-09-12', '2026-10-01', '2026-10-10', '2026-10-15']) {
      expect(days.find(x => x.date === d)!.amount).toBe(summarize(data, d).liquid);
    }
    // the card purchase leaves on the charge day, not the day it was bought
    const at = (d: string) => days.find(x => x.date === d)!.amount;
    expect(at('2026-09-05')).toBe(at('2026-09-04'));
  });
});

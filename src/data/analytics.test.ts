import { describe, expect, it } from 'vitest';
import { biggestExpenses, byMethodKind, byYear, categoryShares, categoryVsAverage, rangeKeys, totals } from './analytics';
import { monthStats } from './dashboard';
import type { PaymentMethod, Transaction } from './types';

let n = 0;
const tx = (t: Partial<Transaction>): Transaction => ({
  id: String(++n), type: 'expense', amount: 0, date: '2026-09-10', createdAt: '', updatedAt: '', ...t,
});

const txs = [
  tx({ amount: 100_00, categoryId: 'food', methodId: 'cash', date: '2026-07-05' }),
  tx({ amount: 300_00, categoryId: 'rent', methodId: 'bank', date: '2026-07-06' }),
  tx({ amount: 200_00, categoryId: 'food', methodId: 'max', date: '2026-08-05' }),
  tx({ amount: 300_00, categoryId: 'rent', methodId: 'bank', date: '2026-08-06' }),
  tx({ amount: 400_00, categoryId: 'food', methodId: 'max', date: '2026-09-05' }),
  tx({ amount: 50_00, categoryId: 'fun', methodId: 'cash', date: '2026-09-07' }),
  tx({ type: 'income', amount: 1_000_00, date: '2026-09-01' }),
  tx({ type: 'income', amount: 900_00, date: '2025-12-01' }),
  tx({ type: 'transfer', amount: 5_000_00, date: '2026-09-02' }),
];

describe('dashboard numbers', () => {
  it('picks the months of a range, never before the start', () => {
    expect(rangeKeys(3, '2026-07-01', '2026-09-20', 1)).toEqual(['2026-07', '2026-08', '2026-09']);
    expect(rangeKeys(12, '2026-08-15', '2026-09-20', 1)).toEqual(['2026-08', '2026-09']);
  });

  it('sums a range and gives the savings rate', () => {
    const t = totals(['2026-09'].map(k => monthStats(txs, k, 1)));
    expect([t.income, t.expenses, t.net, t.savingsRate]).toEqual([1_000_00, 450_00, 550_00, 0.55]);
  });

  it('folds small categories into "other"', () => {
    const { total, slices } = categoryShares(txs, ['2026-07', '2026-08', '2026-09'], 1, 1);
    expect(total).toBe(1_350_00);
    expect(slices.map(s => [s.categoryId, s.amount])).toEqual([['food', 700_00], ['other', 650_00]]);
  });

  it('splits income by where it came from', () => {
    const withSalary = [...txs, tx({ type: 'income', amount: 300_00, categoryId: 'extra', date: '2026-09-03' })];
    const { total, slices } = categoryShares(withSalary, ['2026-09'], 1, 7, 'income');
    expect(total).toBe(1_300_00);
    expect(slices.map(s => s.categoryId)).toEqual(['', 'extra']);
  });

  it('compares this month with the average of the months before', () => {
    const rows = categoryVsAverage(txs, '2026-09', ['2026-07', '2026-08'], 1);
    expect(rows.find(r => r.categoryId === 'food')).toEqual({ categoryId: 'food', current: 400_00, average: 150_00, change: 250_00 });
    expect(rows.find(r => r.categoryId === 'rent')).toEqual({ categoryId: 'rent', current: 0, average: 300_00, change: -300_00 });
    expect(rows[0].categoryId).toBe('food');
  });

  it('splits spending by how it was paid', () => {
    const methods = [
      { id: 'cash', kind: 'cash' }, { id: 'bank', kind: 'bank' }, { id: 'max', kind: 'credit' },
    ] as PaymentMethod[];
    expect(byMethodKind(txs, methods, ['2026-09'], 1)).toEqual([{ kind: 'credit', amount: 400_00 }, { kind: 'cash', amount: 50_00 }]);
  });

  it('lists the biggest expenses and the years', () => {
    expect(biggestExpenses(txs, ['2026-09'], 1, 1).map(t => t.amount)).toEqual([400_00]);
    expect(byYear(txs)).toEqual([
      { year: '2026', income: 1_000_00, expenses: 1_350_00, net: -350_00 },
      { year: '2025', income: 900_00, expenses: 0, net: 900_00 },
    ]);
  });
});

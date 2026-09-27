import { describe, expect, it } from 'vitest';
import type { Ledger } from './balance';
import { bestAndWorst, expectedExpenses, monthsSince, monthStats, periodEnd, periodKey, restOfMonth } from './dashboard';
import type { Account, PaymentMethod, Transaction } from './types';

let n = 0;
const tx = (t: Partial<Transaction>): Transaction => ({
  id: String(++n), type: 'expense', amount: 0, date: '2026-09-24', createdAt: '', updatedAt: '', ...t,
});

describe('month numbers', () => {
  const txs = [
    tx({ amount: 100_00, categoryId: 'food', date: '2026-09-02' }),
    tx({ amount: 50_00, categoryId: 'fuel', date: '2026-09-20' }),
    tx({ amount: 30_00, categoryId: 'food', date: '2026-09-30' }),
    tx({ type: 'income', amount: 1_000_00, date: '2026-09-10' }),
    tx({ type: 'transfer', amount: 999_00, date: '2026-09-11' }),
    tx({ amount: 70_00, categoryId: 'food', date: '2026-10-01' }),
  ];

  it('adds up one calendar month, leaving transfers out', () => {
    const s = monthStats(txs, '2026-09');
    expect([s.income, s.expenses, s.net]).toEqual([1_000_00, 180_00, 820_00]);
    expect(s.byCategory).toEqual([{ categoryId: 'food', amount: 130_00 }, { categoryId: 'fuel', amount: 50_00 }]);
  });

  it('lists months from the start, across a year end', () => {
    expect(monthsSince('2026-11-15', '2027-02-01')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
  });

  it('compares only finished months', () => {
    const stats = ['2026-09', '2026-10', '2026-11'].map(k => monthStats([...txs, tx({ type: 'income', amount: 500_00, date: '2026-11-05' })], k));
    const { best, worst } = bestAndWorst(stats, '2026-11-20');
    expect([best?.key, worst?.key]).toEqual(['2026-09', '2026-10']);
    expect(bestAndWorst(stats.slice(0, 1), '2026-09-20')).toEqual({});
  });
});

describe('financial month starting on another day', () => {
  it('runs from the start day to the day before the next one', () => {
    expect(periodKey('2026-09-09', 10)).toBe('2026-08');
    expect(periodKey('2026-09-10', 10)).toBe('2026-09');
    expect(periodEnd('2026-09', 10)).toBe('2026-10-09');
    expect(periodEnd('2027-01', 31)).toBe('2027-02-27'); // Feb has no 31st: the next month starts on the 28th
    expect(monthsSince('2026-09-05', '2026-10-12', 10)).toEqual(['2026-08', '2026-09', '2026-10']);
  });
  it('counts transactions by their financial month', () => {
    const txs = [tx({ amount: 1, date: '2026-09-09' }), tx({ amount: 2, date: '2026-09-10' }), tx({ amount: 4, date: '2026-10-09' })];
    expect(monthStats(txs, '2026-09', 10).expenses).toBe(6);
  });
});

describe('standing orders still to come this month', () => {
  it('are listed as expected spending until they are recorded', () => {
    const ledger: Ledger = {
      accounts: [], methods: [], transactions: [], startDate: '2026-09-01',
      recurring: [
        { id: 'r', name: 'ועד בית', type: 'expense', frequency: 'monthly', firstDate: '2026-09-30', variable: false, estimate: 'set', amount: 150_00, categoryId: 'home', methodId: 'b', handledThrough: '2026-09-29', createdAt: '' },
        { id: 's', name: 'משכורת', type: 'income', frequency: 'monthly', firstDate: '2026-09-28', variable: false, estimate: 'set', amount: 1, categoryId: 'sal', accountId: 'a', handledThrough: '2026-09-27', createdAt: '' },
      ],
    };
    expect(expectedExpenses(ledger, '2026-09-27', '2026-09-30').map(t => [t.categoryId, t.amount, t.date])).toEqual([['home', 150_00, '2026-09-30']]);
    expect(expectedExpenses(ledger, '2026-09-27', '2026-09-29')).toEqual([]);
  });
});

describe('rest of the month', () => {
  const accounts: Account[] = [{ id: 'bank', name: 'bank', kind: 'bank', openingBalance: 2_000_00, order: 0 }];
  const methods: PaymentMethod[] = [
    { id: 'bankm', name: 'b', kind: 'bank', accountId: 'bank', order: 0 },
    { id: 'max', name: 'max', kind: 'credit', accountId: 'bank', chargeDay: 10, order: 1 },
  ];
  it('counts what still leaves and arrives this month only, including card charges', () => {
    const ledger: Ledger = {
      accounts, methods, startDate: '2026-09-01',
      transactions: [
        tx({ amount: 300_00, methodId: 'max', date: '2026-09-01' }), // charged Sept 10
        tx({ amount: 100_00, methodId: 'bankm', date: '2026-09-25' }), // future, this month
        tx({ type: 'income', amount: 500_00, accountId: 'bank', date: '2026-09-28' }),
        tx({ amount: 999_00, methodId: 'bankm', date: '2026-10-02' }), // next month: not counted
      ],
    };
    const r = restOfMonth(ledger, '2026-09-05');
    expect([r.expectedOut, r.expectedIn]).toEqual([-400_00, 500_00]);
    expect(r.projectedEnd).toBe(2_000_00 - 400_00 + 500_00);
  });

  it('shows the card charge that falls just after the month (charged on the 2nd)', () => {
    const card: PaymentMethod = { id: 'isracard', name: 'c', kind: 'credit', accountId: 'bank', chargeDay: 2, order: 2 };
    const ledger: Ledger = {
      accounts, methods: [...methods, card], startDate: '2026-09-01',
      transactions: [
        tx({ amount: 250_00, methodId: 'isracard', date: '2026-09-20' }),
        tx({ amount: 600_00, methodId: 'isracard', date: '2026-09-21', installments: 3 }),
      ],
    };
    const r = restOfMonth(ledger, '2026-09-25');
    expect(r.expectedOut).toBe(0);
    // Oct 2 charge: 250 + first 200 installment; the later installments aren't this month's bill
    expect(r.lateCharges).toEqual([{ methodId: 'isracard', date: '2026-10-02', amount: -450_00 }]);
    expect(r.afterCards).toBe(2_000_00 - 450_00);
  });
});

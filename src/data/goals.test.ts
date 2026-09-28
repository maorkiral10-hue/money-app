import { describe, expect, it } from 'vitest';
import { summarize, type Ledger } from './balance';
import { goalPlan, monthsUntil } from './goals';
import type { Account, Transaction } from './types';

const bank: Account = { id: 'bank', name: 'בנק', kind: 'bank', openingBalance: 10_000_00, order: 0 };
const trip: Account = { id: 'trip', name: 'חופשה', kind: 'goal', openingBalance: 1_000_00, order: 1, goalTarget: 7_000_00, goalDate: '2027-06-30' };
const move = (id: string, amount: number, from: string, to: string, date = '2026-09-10'): Transaction =>
  ({ id, type: 'transfer', amount, date, accountId: from, toAccountId: to, createdAt: '', updatedAt: '' });

describe('savings goals', () => {
  const ledger: Ledger = { accounts: [bank, trip], methods: [], startDate: '2026-09-01', transactions: [move('a', 2_000_00, 'bank', 'trip'), move('b', 500_00, 'trip', 'bank', '2026-09-20')] };

  it('money in a goal is not liquid, and moving it back makes it liquid again', () => {
    const s = summarize(ledger, '2026-09-28');
    expect(s.liquid).toBe(10_000_00 - 2_000_00 + 500_00);
    expect(s.goals.map(g => [g.account.id, g.balance])).toEqual([['trip', 1_000_00 + 2_000_00 - 500_00]]);
    expect(s.byAccount.map(b => b.account.id)).toEqual(['bank']);
  });

  it('works out what to put in each month to reach the target by its date', () => {
    expect(monthsUntil('2026-09-28', '2027-06-30')).toBe(10);
    const plan = goalPlan(trip, 2_500_00, ledger.transactions, '2026-09-28');
    // 1,000 at the start of the month, 6,000 to go over 10 months; this month's 1,500 already covers it
    expect(plan.perMonth).toBe(600_00);
    expect(plan.thisMonth).toBe(1_500_00);
    expect(plan.leftThisMonth).toBe(0);
    expect(goalPlan(trip, 1_000_00, [], '2026-09-28')).toMatchObject({ perMonth: 600_00, leftThisMonth: 600_00 });
    expect(plan.progress).toBeCloseTo(2_500_00 / 7_000_00);
  });

  it('a monthly goal asks for its fixed amount; a reached goal asks for nothing', () => {
    const monthly: Account = { id: 'm', name: 'כרית', kind: 'goal', openingBalance: 0, order: 2, goalMonthly: 300_00 };
    expect(goalPlan(monthly, 0, [], '2026-09-28').perMonth).toBe(300_00);
    expect(goalPlan(trip, 7_000_00, [], '2026-09-28')).toMatchObject({ reached: true, perMonth: undefined });
  });

  it('spending straight from a goal takes it out of the goal, not out of the liquid money', () => {
    const spend: Transaction = { id: 's', type: 'expense', amount: 800_00, date: '2026-09-25', categoryId: 'vacation', accountId: 'trip', createdAt: '', updatedAt: '' };
    const s = summarize({ ...ledger, transactions: [...ledger.transactions, spend] }, '2026-09-28');
    expect(s.liquid).toBe(10_000_00 - 2_000_00 + 500_00);
    expect(s.goals[0].balance).toBe(2_500_00 - 800_00);
    // ...and what was paid for it still counts towards the target
    const plan = goalPlan(trip, 1_700_00, [...ledger.transactions, spend], '2026-09-28');
    expect(plan).toMatchObject({ spent: 800_00, perMonth: 600_00 });
    expect(plan.progress).toBeCloseTo(2_500_00 / 7_000_00);
  });
});

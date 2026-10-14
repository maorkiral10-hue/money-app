import { describe, expect, it } from 'vitest';
import { summarize, type Ledger } from './balance';
import { goalPlan, monthsUntil, goalNumbers, overReserved } from './goals';
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

describe("a goal's numbers and where its money is", () => {
  const trip: Account = { id: 'trip', name: 'חופשה', kind: 'goal', openingBalance: 0, order: 1, goalTarget: 8_000_00 };
  const t = (id: string, type: Transaction['type'], amount: number, from?: string, to?: string): Transaction => ({ id, type, amount, date: '2026-10-10', accountId: from, toAccountId: to, categoryId: 'c', createdAt: '', updatedAt: '' });

  it('put in, paid on it, left in it, and what is left to save', () => {
    // 5,000 put in, 2,000 paid straight out of it (the hotel), 200 taken back
    const txs = [t('a', 'transfer', 5_000_00, 'bank', 'trip'), t('b', 'expense', 2_000_00, 'trip'), t('c', 'transfer', 200_00, 'trip', 'bank')];
    expect(goalNumbers(trip, 2_800_00, txs)).toEqual({ deposited: 4_800_00, paid: 2_000_00, left: 2_800_00, toSave: 3_200_00, surplus: 0 });
    expect(goalNumbers(trip, 6_300_00, [t('a', 'transfer', 6_300_00, 'bank', 'trip'), t('b', 'expense', 2_000_00, 'trip')]).surplus).toBe(300_00);
  });

  it('set aside inside a source that now holds less: comes down to what the source has, shared in order', () => {
    const bank: Account = { id: 'bank', name: 'בנק', kind: 'bank', openingBalance: 0, order: 0 };
    const a: Account = { ...trip, id: 'a', order: 1, goalPlace: 'inside', goalSource: 'bank' };
    const b: Account = { ...trip, id: 'b', order: 2, goalPlace: 'inside', goalSource: 'bank' };
    const over = overReserved([bank, a, b], [{ account: bank, balance: 700_00 }], [{ account: a, balance: 500_00 }, { account: b, balance: 400_00 }]);
    expect(over.map(o => [o.goal.id, o.from, o.to])).toEqual([['b', 400_00, 200_00]]);
  });
});

describe('paid on a goal with other money', () => {
  const trip: Account = { id: 'trip', name: 'חופשה', kind: 'goal', openingBalance: 0, order: 1, goalTarget: 8_000_00 };
  const into: Transaction = { id: 'in', type: 'transfer', amount: 5_000_00, date: '2026-10-01', accountId: 'bank', toAccountId: 'trip', createdAt: '', updatedAt: '' };
  const flight: Transaction = { id: 'f', type: 'expense', amount: 3_000_00, date: '2026-10-10', methodId: 'visa', categoryId: 'c', goalId: 'trip', createdAt: '', updatedAt: '' };

  it('from the daily money: the goal keeps its money, and nothing is left to save', () => {
    expect(goalNumbers(trip, 5_000_00, [into, flight])).toMatchObject({ deposited: 5_000_00, paid: 3_000_00, left: 5_000_00, toSave: 0 });
  });

  it('from the money put aside: taken out of the goal, still deposited, and the rest is left to save', () => {
    const cover: Transaction = { id: 'c', type: 'transfer', amount: 3_000_00, date: '2026-10-10', accountId: 'trip', toAccountId: 'bank', coverFor: 'f', createdAt: '', updatedAt: '' };
    expect(goalNumbers(trip, 2_000_00, [into, flight, cover])).toMatchObject({ deposited: 5_000_00, paid: 3_000_00, left: 2_000_00, toSave: 3_000_00 });
  });
});

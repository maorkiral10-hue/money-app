import { describe, expect, it } from 'vitest';
import { goalNumbers, goalPlan, paidForGoal } from './goals';
import type { Account, Transaction } from './types';

let n = 0;
const tx = (t: Partial<Transaction>): Transaction => ({ id: String(++n), type: 'expense', amount: 0, date: '2026-11-20', createdAt: '', updatedAt: '', ...t });
const goal: Account = { id: 'trip', name: 'חופשה', kind: 'goal', openingBalance: 0, order: 0, goalTarget: 10_000_00 };

describe('what counts as paid for a goal', () => {
  it('tied to it: paid with other money (the goal as the category)', () => {
    expect(paidForGoal(tx({ methodId: 'visa', goalId: 'trip' }), 'trip')).toBe(true);
  });
  it('paid out of it, for it', () => {
    expect(paidForGoal(tx({ accountId: 'trip', goalId: 'trip' }), 'trip')).toBe(true);
  });
  it('paid out of it before this was asked: still for it', () => {
    expect(paidForGoal(tx({ accountId: 'trip' }), 'trip')).toBe(true);
  });
  it('paid out of it for something else: not for it', () => {
    expect(paidForGoal(tx({ accountId: 'trip', otherThanGoal: true }), 'trip')).toBe(false);
  });
  it('paid out of one goal for another: counts only on the other', () => {
    const t = tx({ accountId: 'trip', goalId: 'car' });
    expect(paidForGoal(t, 'trip')).toBe(false);
    expect(paidForGoal(t, 'car')).toBe(true);
  });
});

describe('the flight on the card (the user\'s example)', () => {
  // 1,000 saved in the goal; a 2,000 flight on the card, the goal picked as its category
  const txs = [tx({ type: 'transfer', amount: 1_000_00, accountId: 'bank', toAccountId: 'trip' }), tx({ amount: 2_000_00, methodId: 'visa', goalId: 'trip' })];
  it('the goal: 1,000 in it, 2,000 paid, 3,000 of 10,000', () => {
    const plan = goalPlan(goal, 1_000_00, txs, '2026-11-23');
    expect(plan.spent).toBe(2_000_00);
    expect(plan.progress).toBeCloseTo(0.3);
    const nums = goalNumbers(goal, 1_000_00, txs);
    expect([nums.deposited, nums.paid, nums.left, nums.toSave]).toEqual([1_000_00, 2_000_00, 1_000_00, 7_000_00]);
  });
  it('covered from the goal: 0 in it, 2,000 paid, 2,000 of 10,000', () => {
    const covered = [...txs, tx({ type: 'transfer', amount: 1_000_00, accountId: 'trip', toAccountId: 'bank', coverFor: txs[1].id })];
    const plan = goalPlan(goal, 0, covered, '2026-11-23');
    expect(plan.progress).toBeCloseTo(0.2);
    expect(goalNumbers(goal, 0, covered).deposited).toBe(1_000_00);
  });
});

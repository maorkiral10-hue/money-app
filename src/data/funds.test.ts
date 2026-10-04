import { describe, expect, it } from 'vitest';
import { depositsSince, earned, totalSaved, type Fund } from './funds';
import type { Transaction } from './types';

const fund: Fund = {
  id: 'f',
  name: 'גמל',
  kind: 'gemel',
  recurringId: 'rec',
  createdAt: '',
  updates: [
    { date: '2026-07-01', balance: 100_000_00, deposits: 0 },
    // Three months later: 3,000 deposited, the rest is what the fund earned
    { date: '2026-10-01', balance: 105_000_00, deposits: 3_000_00 },
  ],
};

describe('long-term savings', () => {
  it('tells what the fund earned between two updates, the deposits taken off', () => {
    expect(earned(fund, 0)).toBeUndefined();
    expect(earned(fund, 1)).toEqual({ amount: 2_000_00, pct: 0.02, since: '2026-07-01' });
    expect(earned({ ...fund, updates: [fund.updates[0], { ...fund.updates[1], balance: 101_000_00 }] }, 1)!.amount).toBe(-2_000_00);
  });

  it("suggests the linked standing order's deposits since the last update", () => {
    const dep = (id: string, date: string): Transaction => ({ id, type: 'expense', amount: 1_000_00, date, recurringId: 'rec', createdAt: '', updatedAt: '' });
    const txs = [dep('a', '2026-09-10'), dep('b', '2026-10-10'), dep('c', '2026-11-10')];
    expect(depositsSince(fund, txs, '2026-10-31')).toBe(1_000_00);
    expect(depositsSince({ ...fund, recurringId: undefined }, txs, '2026-10-31')).toBe(0);
    expect(totalSaved([fund, { ...fund, id: 'g', updates: [{ date: '2026-10-01', balance: 50_000_00, deposits: 0 }] }])).toBe(155_000_00);
  });
});

import { describe, expect, it } from 'vitest';
import { budgetStatus, statsTransactions, usualSpending } from './budget';
import type { AppData } from './store';
import type { Transaction } from './types';

let n = 0;
const tx = (t: Partial<Transaction>): Transaction => ({
  id: String(++n), type: 'expense', amount: 0, date: '2026-09-10', methodId: 'cash', createdAt: '', updatedAt: '', ...t,
});

const base = (over: Partial<AppData>): AppData => ({
  accounts: [], methods: [{ id: 'cash', name: 'מזומן', kind: 'cash', accountId: 'a', order: 0 }], categories: [],
  transactions: [], recurring: [], setupDone: true, startDate: '2026-08-01', openOnEntry: true, monthStartDay: 1, ...over,
});

describe('budget', () => {
  const txs = [
    tx({ amount: 400_00, categoryId: 'food', date: '2026-08-05' }),
    tx({ amount: 1_000_00, categoryId: 'rent', date: '2026-08-06' }),
    tx({ amount: 300_00, categoryId: 'food', date: '2026-09-05' }),
    tx({ amount: 500_00, categoryId: 'saving', date: '2026-09-06' }),
  ];
  const recurring = [
    { id: 'r', name: 'שכר דירה', type: 'expense' as const, frequency: 'monthly' as const, firstDate: '2026-09-28', variable: false, estimate: 'set' as const,
      amount: 1_000_00, categoryId: 'rent', methodId: 'cash', handledThrough: '2026-09-27', createdAt: '' },
  ];

  it('counts spent and still-expected against the overall and category limits', () => {
    const data = base({ transactions: txs, recurring, budget: { overall: 3_000_00, categories: { food: 500_00, rent: 1_000_00 }, savingsMode: 'expense' } });
    const s = budgetStatus(data, '2026-09-21')!;
    expect(s.overall).toMatchObject({ limit: 3_000_00, spent: 800_00, expected: 1_000_00, remaining: 1_200_00 });
    expect(s.daysLeft).toBe(10);
    expect(s.overall!.perDay).toBe(120_00);
    expect(s.categories.find(c => c.categoryId === 'rent')).toMatchObject({ spent: 0, expected: 1_000_00 });
    expect(s.categories.find(c => c.categoryId === 'food')).toMatchObject({ spent: 300_00, expected: 0 });
  });

  it('keeps money put into savings out of spending when chosen', () => {
    const data = base({ transactions: txs, budget: { overall: 3_000_00, categories: {}, savingsMode: 'separate', savingsCategoryId: 'saving' } });
    expect(budgetStatus(data, '2026-09-21')!.overall!.spent).toBe(300_00);
    expect(budgetStatus(data, '2026-09-21')!.saved).toBe(500_00);
    expect(statsTransactions(data).find(t => t.categoryId === 'saving')!.type).toBe('transfer');
  });

  it('suggests limits from the finished months', () => {
    const u = usualSpending(base({ transactions: txs }), '2026-09-21');
    expect([u.basedOnFinishedMonths, u.overall, u.byCategory.food]).toEqual([1, 1_400_00, 400_00]);
  });
});

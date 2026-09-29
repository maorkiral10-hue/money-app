import { describe, expect, it } from 'vitest';
import { moneyRows } from '../components/MoneyList';
import type { AppData } from './store';
import type { Transaction } from './types';

const tx = (id: string, date: string, amount: number, methodId: string): Transaction => ({ id, type: 'expense', amount, date, methodId, categoryId: 'c', createdAt: date, updatedAt: date });

const data = {
  accounts: [{ id: 'bank', name: 'בנק', kind: 'bank', openingBalance: 0, order: 0 }],
  methods: [
    { id: 'visa', name: 'ויזה', kind: 'credit', accountId: 'bank', chargeDay: 2, order: 0 },
    { id: 'cash', name: 'מזומן', kind: 'cash', accountId: 'bank', order: 1 },
  ],
  categories: [],
  transactions: [tx('a', '2026-08-20', 100_00, 'visa'), tx('b', '2026-09-10', 50_00, 'cash'), tx('c', '2026-09-27', 320_00, 'visa')],
  recurring: [],
  events: [],
  setupDone: true,
  startDate: '2026-08-01',
  openOnEntry: true,
  monthStartDay: 1,
  balanceChecks: [],
  checkEvery: 'never',
} as AppData;

describe('the month, like a bank statement', () => {
  it('lists each purchase on its own day and a card charge on the day the bank pays it, once it has', () => {
    const rows = moneyRows(data, '2026-09-01', '2026-09-30', '2026-09-29');
    expect(rows.map(r => (r.kind === 'tx' ? `${r.date} ${r.tx.id}` : `${r.date} חיוב ${r.st.amount}`))).toEqual([
      '2026-09-27 c',
      '2026-09-10 b',
      // August's purchase is charged on 2 September; the 320 bought on the 27th is charged in October, so isn't a charge line yet
      '2026-09-02 חיוב 10000',
    ]);
  });

  it('a standing order on a card is only inside the card charge, not again on its own day', () => {
    const spotify = { ...tx('s', '2026-09-15', 20_00, 'visa'), recurringId: 'spot', occurrence: '2026-09-15', note: 'ספוטיפיי' };
    const rows = moneyRows({ ...data, transactions: [...data.transactions, spotify] }, '2026-09-15', '2026-09-15', '2026-09-29');
    expect(rows).toEqual([]);
    const oct = moneyRows({ ...data, transactions: [...data.transactions, spotify] }, '2026-10-02', '2026-10-02', '2026-09-29');
    // ...and it's in the charge: the 320 bought on the 27th and the 20 on the 15th
    expect(oct.map(r => (r.kind === 'charge' ? r.st.amount : 0))).toEqual([340_00]);
  });
});

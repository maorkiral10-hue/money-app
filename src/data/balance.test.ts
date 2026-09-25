import { describe, expect, it } from 'vitest';
import { nextChargeDate, splitInstallments, summarize, upcomingItems, type Ledger } from './balance';
import { parseMoney } from './money';
import type { Account, PaymentMethod, Transaction } from './types';

const acc = (id: string, openingBalance: number, kind: Account['kind'] = 'bank'): Account => ({ id, name: id, kind, openingBalance, order: 0 });
const bank = acc('bank', 1_000_00);
const cash = acc('cash', 200_00, 'cash');
const bit = acc('bit', 50_00, 'app');

const methods: PaymentMethod[] = [
  { id: 'cash', name: 'cash', kind: 'cash', accountId: 'cash', order: 0 },
  { id: 'transfer', name: 'transfer', kind: 'bank', accountId: 'bank', order: 1 },
  { id: 'max', name: 'max', kind: 'credit', accountId: 'bank', chargeDay: 10, order: 2 },
];

let n = 0;
const tx = (t: Partial<Transaction>): Transaction => ({
  id: String(++n), type: 'expense', amount: 0, date: '2026-09-24', createdAt: '', updatedAt: '', ...t,
});

const ledger = (transactions: Transaction[], extra: Partial<Ledger> = {}): Ledger => ({
  accounts: [bank, cash, bit], methods, transactions, startDate: '2026-09-24', ...extra,
});

describe('liquid balance', () => {
  it('starts as the sum of every account', () => {
    expect(summarize(ledger([]), '2026-09-24').liquid).toBe(1_250_00);
  });

  it('cash and bank payments leave right away; income comes in', () => {
    const s = summarize(ledger([
      tx({ amount: 30_00, methodId: 'cash' }),
      tx({ amount: 100_00, methodId: 'transfer' }),
      tx({ type: 'income', amount: 500_00, accountId: 'bank' }),
    ]), '2026-09-24');
    expect(s.liquid).toBe(1_250_00 - 30_00 - 100_00 + 500_00);
    expect(s.byAccount.find(b => b.account.id === 'cash')!.balance).toBe(170_00);
  });

  it('a credit card purchase leaves the bank only on the charge day, and only once', () => {
    const l = ledger([tx({ amount: 200_00, methodId: 'max', date: '2026-09-24' })]);
    const before = summarize(l, '2026-09-24');
    expect(before.liquid).toBe(1_250_00);
    expect(before.upcoming.credit).toBe(-200_00);
    expect(before.upcoming.projected).toBe(1_050_00);

    const after = summarize(l, '2026-10-10');
    expect(after.liquid).toBe(1_050_00);
    expect(after.upcoming.credit).toBe(0);
  });

  it('a transfer between accounts does not change the total', () => {
    const s = summarize(ledger([tx({ type: 'transfer', amount: 100_00, accountId: 'bank', toAccountId: 'cash' })]), '2026-09-24');
    expect(s.liquid).toBe(1_250_00);
    expect(s.byAccount.find(b => b.account.id === 'cash')!.balance).toBe(300_00);
  });

  it('future-dated transactions are expected, not yet in the balance', () => {
    const s = summarize(ledger([
      tx({ type: 'income', amount: 800_00, accountId: 'bank', date: '2026-10-01' }),
      tx({ amount: 400_00, methodId: 'transfer', date: '2026-10-15' }),
    ]), '2026-09-24');
    expect(s.liquid).toBe(1_250_00);
    expect(s.upcoming.income).toBe(800_00);
    expect(s.upcoming.expenses).toBe(-400_00);
    expect(s.upcoming.projected).toBe(1_650_00);
  });

  it('transactions before the start date are already in the opening balances', () => {
    const s = summarize(ledger([tx({ amount: 50_00, methodId: 'cash', date: '2026-09-20' })]), '2026-09-24');
    expect(s.liquid).toBe(1_250_00);
  });

  it('what was already on the card at the start is charged on the next charge day', () => {
    const withPending = ledger([], { methods: methods.map(m => (m.id === 'max' ? { ...m, openingPending: 700_00 } : m)) });
    expect(summarize(withPending, '2026-09-24').upcoming.credit).toBe(-700_00);
    expect(summarize(withPending, '2026-10-10').liquid).toBe(550_00);
  });

  it('installments come off month by month', () => {
    const l = ledger([tx({ amount: 1_200_00, methodId: 'max', installments: 12 })]);
    expect(summarize(l, '2026-10-10').liquid).toBe(1_250_00 - 100_00);
    expect(summarize(l, '2026-11-10').liquid).toBe(1_250_00 - 200_00);
    expect(summarize(l, '2027-09-10').liquid).toBe(1_250_00 - 1_200_00);
  });
});

describe('forecast lines', () => {
  it('lists future income and expenses, and one line per card charge, adding up to the projection', () => {
    const l = ledger(
      [
        tx({ amount: 200_00, methodId: 'max' }),
        tx({ amount: 1_200_00, methodId: 'max', installments: 12 }),
        tx({ type: 'income', amount: 800_00, accountId: 'bank', date: '2026-10-01' }),
        tx({ type: 'transfer', amount: 50_00, accountId: 'bank', toAccountId: 'cash', date: '2026-10-02' }),
      ],
      { methods: methods.map(m => (m.id === 'max' ? { ...m, openingPending: 700_00 } : m)) },
    );
    const items = upcomingItems(l, '2026-09-24');
    expect(items.map(i => [i.date, i.kind, i.amount, i.purchases])).toEqual([
      ['2026-10-01', 'income', 800_00, 0],
      ['2026-10-10', 'credit', -(700_00 + 200_00 + 100_00), 2],
    ]);
    const s = summarize(l, '2026-09-24');
    expect(s.liquid + items.reduce((a, i) => a + i.amount, 0)).toBe(s.upcoming.projected);
  });
});

describe('credit charge dates', () => {
  it('is the next charge day after the purchase', () => {
    expect(nextChargeDate('2026-09-24', 10)).toBe('2026-10-10');
    expect(nextChargeDate('2026-09-05', 10)).toBe('2026-09-10');
    expect(nextChargeDate('2026-09-10', 10)).toBe('2026-10-10');
  });
  it('uses the last day of short months', () => {
    expect(nextChargeDate('2027-02-01', 31)).toBe('2027-02-28');
    expect(nextChargeDate('2026-12-31', 2)).toBe('2027-01-02');
  });
  it('splits installments without losing agorot', () => {
    expect(splitInstallments(100_00, 3)).toEqual([33_34, 33_33, 33_33]);
  });
});

describe('typing amounts', () => {
  it.each([
    ['12', 12_00], ['12.5', 12_50], ['12,50', 12_50], ['1,234', 1_234_00], ['₪ 45', 45_00], ['', null], ['abc', null],
  ])('%s', (text, agorot) => expect(parseMoney(text)).toBe(agorot));
});

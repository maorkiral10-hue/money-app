import { describe, expect, it } from 'vitest';
import { cardStatements, cardUsage, nextChargeDate, splitInstallments, summarize, upcomingItems, type Ledger } from './balance';
import { parseMoney } from './money';
import type { Account, PaymentMethod, Transaction, Recurring } from './types';

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

describe('credit limit', () => {
  it('installments take up the limit in full and free it month by month', () => {
    const l = ledger(
      [
        tx({ amount: 1_200_00, methodId: 'max', installments: 12 }),
        tx({ amount: 300_00, methodId: 'max' }),
        tx({ amount: 999_00, methodId: 'max', date: '2026-12-01' }), // not bought yet
        tx({ amount: 50_00, methodId: 'cash' }),
      ],
      { methods: methods.map(m => (m.id === 'max' ? { ...m, creditLimit: 3_000_00, openingPending: 500_00 } : m)) },
    );
    const [max] = cardUsage(l, '2026-09-24');
    expect(max.used).toBe(500_00 + 300_00 + 1_200_00);
    expect(max.available).toBe(1_000_00);
    expect(max.nextCharge).toEqual({ date: '2026-10-10', amount: 500_00 + 300_00 + 100_00 });

    const [afterFirstCharge] = cardUsage(l, '2026-10-10');
    expect(afterFirstCharge.used).toBe(1_100_00);
  });
});

describe('card statements', () => {
  it('put each purchase and installment in the charge it belongs to, matching the balance', () => {
    const l = ledger(
      [
        tx({ id: 'shoes', amount: 1_200_00, methodId: 'max', installments: 12, date: '2026-09-24' }),
        tx({ id: 'coffee', amount: 20_00, methodId: 'max', date: '2026-10-11' }),
        tx({ id: 'cash', amount: 50_00, methodId: 'cash', date: '2026-09-25' }),
      ],
      { methods: methods.map(m => (m.id === 'max' ? { ...m, openingPending: 500_00 } : m)) },
    );
    const st = cardStatements(l, 'max');
    expect(st[0]).toMatchObject({ date: '2026-10-10', amount: 500_00 + 100_00 });
    expect(st[0].items.map(i => [i.tx?.id ?? 'opening', i.amount, i.installment?.n])).toEqual([['shoes', 100_00, 1], ['opening', 500_00, undefined]]);
    expect(st[1]).toMatchObject({ date: '2026-11-10', amount: 100_00 + 20_00 });
    expect(st).toHaveLength(12);
    // together they are exactly what leaves the bank for this card
    const all = st.reduce((a, s) => a + s.amount, 0);
    expect(all).toBe(500_00 + 1_200_00 + 20_00);
    expect(summarize(l, '2027-09-10').liquid).toBe(1_250_00 - 50_00 - all);
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

describe('standing orders on a card and its limit', () => {
  const rec = (id: string, firstDate: string, amount: number): Recurring => ({
    id, name: id, type: 'expense', frequency: 'monthly', firstDate, variable: false, estimate: 'set', amount,
    methodId: 'visa', categoryId: 'c', handledThrough: '2026-09-29', createdAt: '',
  });
  const ledger: Ledger = {
    accounts: [{ id: 'bank', name: 'בנק', kind: 'bank', openingBalance: 0, order: 0 }],
    methods: [{ id: 'visa', name: 'ויזה', kind: 'credit', accountId: 'bank', chargeDay: 2, openingPending: 2_300_00, creditLimit: 3_000_00, order: 0 }],
    transactions: [],
    // Spotify on the 15th; a gym already inside what was on the card at the start, so (as the form's
    // "רק מהחודש הבא" does) it starts on the charge day and is first in the charge after
    recurring: [rec('spotify', '2026-09-15', 20_00), rec('gym', '2026-10-02', 150_00)],
    startDate: '2026-09-20',
  };

  it('counts coming standing orders in the limit on a day still to come', () => {
    // Today: only what was typed in at the start
    expect(cardUsage(ledger, '2026-09-29')[0].used).toBe(2_300_00);
    // 1 October: nothing new on the card yet
    expect(cardUsage(ledger, '2026-10-01', '2026-09-29')[0].used).toBe(2_300_00);
    // 1 November: the first charge is paid; Spotify of 15 October and the gym of 2 October are on the card
    expect(cardUsage(ledger, '2026-11-01', '2026-09-29')[0].used).toBe(170_00);
  });
});

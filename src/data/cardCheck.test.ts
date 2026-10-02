import { describe, expect, it } from 'vitest';
import { cardStatements, cardUsage, summarize } from './balance';
import { cardChecksDue, chargeWindow, type CardCheck } from './cardCheck';
import type { Account, PaymentMethod, Transaction } from './types';

const bank: Account = { id: 'bank', name: 'בנק', kind: 'bank', openingBalance: 10_000_00, order: 0 };
const visa: PaymentMethod = { id: 'visa', name: 'ויזה', kind: 'credit', accountId: 'bank', chargeDay: 2, creditLimit: 5_000_00, order: 0 };
const buy = (id: string, date: string, amount: number): Transaction => ({ id, type: 'expense', amount, date, methodId: 'visa', categoryId: 'c', createdAt: date, updatedAt: date });
const refund = (id: string, date: string, amount: number): Transaction => ({ id, type: 'income', amount, date, methodId: 'visa', categoryId: 'r', createdAt: date, updatedAt: date });
const ledger = (transactions: Transaction[], cardChecks: CardCheck[] = []) => ({
  accounts: [bank],
  methods: [visa],
  transactions,
  recurring: [],
  startDate: '2026-08-01',
  cardChecks,
});

describe('a refund to a credit card', () => {
  it('comes off the next charge and frees the limit, without touching the bank before then', () => {
    const l = ledger([buy('a', '2026-09-10', 500_00), refund('r', '2026-09-20', 120_00)]);
    expect(cardStatements(l, 'visa').map(s => [s.date, s.amount])).toEqual([['2026-10-02', 380_00]]);
    expect(cardUsage(l, '2026-09-25')[0]).toMatchObject({ used: 380_00, available: 4_620_00 });
    expect(summarize(l, '2026-09-25').liquid).toBe(10_000_00);
    expect(summarize(l, '2026-10-02').liquid).toBe(10_000_00 - 380_00);
  });
});

describe("checking a card's charge", () => {
  it("asks about each card's latest charge once it came, until it's checked", () => {
    const txs = [buy('a', '2026-08-10', 100_00), buy('b', '2026-09-10', 200_00)];
    expect(cardChecksDue(ledger(txs), '2026-10-01').map(d => [d.charge.date, d.charge.amount])).toEqual([['2026-09-02', 100_00]]);
    // The October charge came: only it is asked about now
    expect(cardChecksDue(ledger(txs), '2026-10-02').map(d => d.charge.date)).toEqual(['2026-10-02']);
    // Said a different amount, not closed yet: still asked, with that amount
    const open: CardCheck = { methodId: 'visa', date: '2026-10-02', actual: 250_00, done: false, at: '' };
    expect(cardChecksDue(ledger(txs, [open]), '2026-10-02')[0].actual).toBe(250_00);
    expect(cardChecksDue(ledger(txs, [{ ...open, done: true }]), '2026-10-02')).toEqual([]);
  });

  it('knows which days of purchases go into a charge', () => {
    const [due] = cardChecksDue(ledger([buy('b', '2026-09-10', 200_00)]), '2026-10-02');
    expect(chargeWindow(visa, due.charge)).toEqual({ from: '2026-09-02', to: '2026-10-01' });
  });
});

describe('more refunded than bought', () => {
  it("shows nothing used, and the refund as what's coming", () => {
    const [u] = cardUsage(ledger([refund('r', '2026-10-02', 30_00)]), '2026-10-02');
    expect(u).toMatchObject({ used: 0, available: 5_000_00, nextCharge: { date: '2026-11-02', amount: -30_00 } });
  });
});

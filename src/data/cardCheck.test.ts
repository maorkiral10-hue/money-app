import { describe, expect, it } from 'vitest';
import { cardStatements, cardUsage, edgeCharges, summarize } from './balance';
import { cardChecksDue, cardSide, chargeWindow, edgeItems, movedTo, openCardGaps, type CardCheck } from './cardCheck';
import { checkStatus, type BalanceCheck } from './reconcile';
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

describe('purchases close to the charge day', () => {
  it('a few days before it, or on the day itself, may be in that charge or the next', () => {
    expect(edgeCharges('2026-09-29', 2)).toEqual({ early: '2026-10-02', late: '2026-11-02' });
    expect(edgeCharges('2026-10-02', 2)).toEqual({ early: '2026-10-02', late: '2026-11-02' });
    expect(edgeCharges('2026-09-28', 2)).toBeUndefined();
    expect(edgeCharges('2026-10-03', 2)).toBeUndefined();
  });

  it('are listed at the check of the charge, and moving one moves its money', () => {
    const txs = [buy('a', '2026-09-10', 200_00), buy('edge', '2026-10-01', 80_00), buy('day', '2026-10-02', 40_00)];
    const [due] = cardChecksDue(ledger(txs), '2026-10-02');
    expect(due.charge.amount).toBe(280_00);
    const edges = edgeItems({ transactions: txs }, visa, due.charge);
    expect(edges.map(e => [e.tx.id, e.inThis])).toEqual([['day', false], ['edge', true]]);
    // The bank charged 200: the purchase of the 1st went into November's
    const moved = txs.map(t => (t.id === 'edge' ? movedTo(t, '2026-11-02') : t));
    expect(cardStatements(ledger(moved), 'visa').map(s => [s.date, s.amount])).toEqual([['2026-10-02', 200_00], ['2026-11-02', 120_00]]);
    expect(cardUsage(ledger(moved), '2026-10-02')[0].used).toBe(120_00);
  });
});

describe("a card's weekly check", () => {
  const weekly = (date: string, real: number, app: number, result: BalanceCheck['result'] = 'gap'): BalanceCheck => ({ date, accountId: 'visa', real, app, result, chargeDate: '2026-11-02' });
  const withChecks = (transactions: Transaction[], balanceChecks: BalanceCheck[], cardChecks: CardCheck[] = []) => ({ ...ledger(transactions, cardChecks), balanceChecks, checkTolerance: 0 });

  it('counts only what was bought up to the day, like the card company', () => {
    const txs = [buy('a', '2026-10-05', 300_00), buy('b', '2026-10-25', 100_00)];
    expect(cardSide(ledger(txs), visa, '2026-11-02', '2026-10-20')).toBe(300_00);
    expect(cardSide(ledger(txs), visa, '2026-11-02', '2026-10-31')).toBe(400_00);
  });

  it('a newer check holds the older gap: what is still missing of it is told apart from what is new', () => {
    const txs = [buy('a', '2026-10-05', 1_250_00)];
    // 20.10: the card company shows 1,320 — 70 missing here. 27.10: 1,600 against 1,500 recorded
    const first = weekly('2026-10-20', 1_320_00, 1_250_00);
    const more = [...txs, buy('b', '2026-10-24', 250_00)];
    const [g] = openCardGaps(withChecks(more, [weekly('2026-10-27', 1_600_00, 1_500_00), first]), '2026-10-27');
    expect(g).toMatchObject({ chargeDate: '2026-11-02', left: 100_00, before: { date: '2026-10-20', left: 70_00 } });
    // The 70 found (a purchase from before the 20th recorded now): 30 are left, all new
    const found = [...more, buy('c', '2026-10-18', 70_00)];
    expect(openCardGaps(withChecks(found, [weekly('2026-10-27', 1_600_00, 1_500_00), first]), '2026-10-27')[0]).toMatchObject({ left: 30_00, before: { left: 0 } });
  });

  it('is settled by the charge day check, and cards are due a check like any source', () => {
    const txs = [buy('a', '2026-10-05', 1_250_00)];
    const done: CardCheck = { methodId: 'visa', date: '2026-11-02', actual: 1_320_00, done: true, at: '' };
    expect(openCardGaps(withChecks(txs, [weekly('2026-10-20', 1_320_00, 1_250_00)], [done]), '2026-11-02')).toEqual([]);
    const s = checkStatus({ accounts: [bank], methods: [visa], balanceChecks: [], checkMode: 'together', checkEvery: 'week', checkEveryByAccount: {} }, '2026-10-20');
    expect(s.due.map(d => d.name)).toEqual(['בנק', 'ויזה']);
  });
});

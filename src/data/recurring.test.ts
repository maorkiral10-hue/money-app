import { describe, expect, it } from 'vitest';
import { summarize, upcomingItems, type Ledger } from './balance';
import { getAll, openDb, putRecords, setMeta } from './db';
import { estimateFor, occurrencesBetween, openOccurrences } from './recurring';
import { recordDueRecurring, resolveOccurrence } from './store';
import type { Account, PaymentMethod, Recurring, Transaction } from './types';

const rec = (r: Partial<Recurring>): Recurring => ({
  id: 'r', name: 'r', type: 'expense', frequency: 'monthly', firstDate: '2026-10-01', variable: false, estimate: 'set',
  amount: 100_00, methodId: 'transfer', categoryId: 'c', handledThrough: '2026-09-30', createdAt: '', ...r,
});

describe('schedule', () => {
  it('monthly keeps the day, using the last day of short months', () => {
    expect(occurrencesBetween(rec({ firstDate: '2026-12-31' }), '2026-12-30', '2027-03-31')).toEqual([
      '2026-12-31', '2027-01-31', '2027-02-28', '2027-03-31',
    ]);
  });
  it('weekly and daily', () => {
    expect(occurrencesBetween(rec({ frequency: 'weekly', firstDate: '2026-09-25' }), '2026-09-24', '2026-10-10')).toEqual([
      '2026-09-25', '2026-10-02', '2026-10-09',
    ]);
    expect(occurrencesBetween(rec({ frequency: 'daily', firstDate: '2026-09-25' }), '2026-09-25', '2026-09-27')).toEqual(['2026-09-26', '2026-09-27']);
  });
  it('stops at the end date', () => {
    expect(occurrencesBetween(rec({ endDate: '2026-11-15' }), '2026-09-30', '2027-01-31')).toEqual(['2026-10-01', '2026-11-01']);
  });
  it('never goes back before the start date', () => {
    expect(openOccurrences(rec({ firstDate: '2026-08-01', handledThrough: '2026-07-31' }), '2026-10-05', '2026-09-24')).toEqual(['2026-10-01']);
  });
});

describe('estimate', () => {
  const tx = (occurrence: string, amount: number): Transaction =>
    ({ id: occurrence, type: 'income', amount, date: occurrence, occurrence, recurringId: 'r', createdAt: '', updatedAt: '' });
  it('averages the last three confirmed amounts', () => {
    const r = rec({ variable: true, estimate: 'average', amount: 1 });
    expect(estimateFor(r, [tx('2026-06-01', 999_00), tx('2026-07-01', 100_00), tx('2026-08-01', 200_00), tx('2026-09-01', 300_00)])).toBe(200_00);
    expect(estimateFor(r, [])).toBe(1);
  });
});

describe('recording', () => {
  let n = 0;
  const freshDb = () => openDb(`rec-test-${++n}`);

  it('records fixed items once when due, even if run twice at the same time', async () => {
    const db = await freshDb();
    await putRecords(db, 'recurring', [rec({})]);
    await Promise.all([recordDueRecurring(db, '2026-09-24', '2026-11-05'), recordDueRecurring(db, '2026-09-24', '2026-11-05')]);
    const txs = await getAll<Transaction>(db, 'transactions');
    expect(txs.map(t => t.date).sort()).toEqual(['2026-10-01', '2026-11-01']);
    expect((await getAll<Recurring>(db, 'recurring'))[0].handledThrough).toBe('2026-11-01');
    // a deleted automatic transaction is not recorded again
    expect(await recordDueRecurring(db, '2026-09-24', '2026-11-05')).toBe(false);
  });

  it('leaves variable items for the user to confirm', async () => {
    const db = await freshDb();
    const r = rec({ variable: true, type: 'income', accountId: 'bank', methodId: undefined });
    await putRecords(db, 'recurring', [r]);
    await setMeta(db, 'x', 1);
    expect(await recordDueRecurring(db, '2026-09-24', '2026-10-05')).toBe(false);
    await resolveOccurrence(db, r, '2026-10-01', 123_45);
    const [t] = await getAll<Transaction>(db, 'transactions');
    expect([t.amount, t.date, t.accountId]).toEqual([123_45, '2026-10-01', 'bank']);
  });
});

describe('in the forecast', () => {
  const accounts: Account[] = [{ id: 'bank', name: 'bank', kind: 'bank', openingBalance: 1_000_00, order: 0 }];
  const methods: PaymentMethod[] = [
    { id: 'transfer', name: 't', kind: 'bank', accountId: 'bank', order: 0 },
    { id: 'max', name: 'max', kind: 'credit', accountId: 'bank', chargeDay: 10, order: 1 },
  ];
  const ledger = (recurring: Recurring[]): Ledger => ({ accounts, methods, transactions: [], recurring, startDate: '2026-09-24' });

  it('adds expected salary and standing orders without touching today\'s balance', () => {
    const l = ledger([
      rec({ id: 'salary', type: 'income', accountId: 'bank', methodId: undefined, amount: 8_000_00, firstDate: '2026-10-10', handledThrough: '2026-10-09' }),
      rec({ id: 'rent', amount: 3_000_00, firstDate: '2026-10-01' }),
    ]);
    const s = summarize(l, '2026-09-25');
    expect(s.liquid).toBe(1_000_00);
    expect(s.upcoming.projected).toBe(1_000_00 + 8_000_00 - 3_000_00);
  });

  it('a monthly subscription on a credit card is charged on the card\'s day', () => {
    const items = upcomingItems(ledger([rec({ methodId: 'max', amount: 50_00, firstDate: '2026-09-28', handledThrough: '2026-09-27' })]), '2026-09-25');
    expect(items.map(i => [i.date, i.kind, i.amount])).toEqual([['2026-10-10', 'credit', -50_00]]);
  });

  it('a variable income still waiting for confirmation is expected, not in the balance', () => {
    const l = ledger([rec({ type: 'income', variable: true, accountId: 'bank', methodId: undefined, amount: 500_00, firstDate: '2026-09-25', handledThrough: '2026-09-24' })]);
    const s = summarize(l, '2026-09-28');
    expect(s.liquid).toBe(1_000_00);
    expect(s.upcoming.income).toBeGreaterThanOrEqual(500_00);
  });
});

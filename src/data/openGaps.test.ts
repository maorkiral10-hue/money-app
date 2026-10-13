import { describe, expect, it } from 'vitest';
import { getAll, getMeta, openDb, putRecords } from './db';
import { logCheck, openGaps, settleOpenGaps, type BalanceCheck } from './reconcile';
import type { Account, Category, PaymentMethod, Transaction } from './types';

let n = 0;
const cash: Account = { id: 'cash', name: 'מזומן', kind: 'cash', openingBalance: 500_00, order: 0 };
const methods: PaymentMethod[] = [{ id: 'cashm', name: 'מזומן', kind: 'cash', accountId: 'cash', order: 0 }];
const spent = (id: string, amount: number, date: string): Transaction => ({ id, type: 'expense', amount, date, methodId: 'cashm', categoryId: 'food', createdAt: '', updatedAt: '' });
const base = (transactions: Transaction[], balanceChecks: BalanceCheck[]) => ({
  accounts: [cash],
  methods,
  transactions,
  startDate: '2026-10-01',
  checkMode: 'together' as const,
  checkEvery: 'week' as const,
  checkEveryByAccount: {},
  balanceChecks,
  checkTolerance: 0,
  gapGraceDays: 3,
  categories: [] as Category[],
});
// In the wallet there was 400, the app had 500: 100 missing, left open
const check: BalanceCheck = { date: '2026-10-06', accountId: 'cash', real: 400_00, app: 500_00, result: 'gap' };

describe('a gap left open after a check', () => {
  it('gets smaller with whatever is remembered for before the check, and not with what came after', () => {
    expect(openGaps(base([], [check]), '2026-10-07')[0]).toMatchObject({ found: -100_00, left: -100_00, until: '2026-10-09' });
    expect(openGaps(base([spent('a', 60_00, '2026-10-04')], [check]), '2026-10-07')[0].left).toBe(-40_00);
    expect(openGaps(base([spent('b', 60_00, '2026-10-07')], [check]), '2026-10-07')[0].left).toBe(-100_00);
    // Checked again two days later (the bank caught up: 460 there now, 40 spent in between was recorded)
    const again = { ...check, recheck: { date: '2026-10-08', real: 460_00 } };
    expect(openGaps(base([spent('c', 40_00, '2026-10-07')], [again]), '2026-10-08')[0]).toMatchObject({ found: -100_00, left: 0, until: '2026-10-09' });
    // A newer check takes its place
    expect(openGaps(base([], [{ ...check, date: '2026-10-07', result: 'match', real: 500_00 }, check]), '2026-10-07')).toEqual([]);
  });

  it('closes once made up in full, and is recorded as unexplained (on the check day) once its days are over', async () => {
    const db = await openDb(`gaps-${++n}`);
    await putRecords(db, 'accounts', [cash]);
    await logCheck(db, check);
    const checks = async () => (await getMeta<BalanceCheck[]>(db, 'balanceChecks'))!;

    // All 100 remembered: closed, nothing recorded
    const closed = await settleOpenGaps(db, base([spent('a', 100_00, '2026-10-05')], await checks()), '2026-10-07');
    expect(closed).toMatchObject([{ closed: true }]);
    expect((await checks())[0].result).toBe('closed');

    // Another time, only 60 remembered and the days are over: the 40 left is recorded on the check's day
    const db2 = await openDb(`gaps-${++n}`);
    await logCheck(db2, check);
    const txs = [spent('a', 60_00, '2026-10-05')];
    const still = await settleOpenGaps(db2, base(txs, (await getMeta<BalanceCheck[]>(db2, 'balanceChecks'))!), '2026-10-09');
    expect(still).toEqual([]);
    const done = await settleOpenGaps(db2, base(txs, (await getMeta<BalanceCheck[]>(db2, 'balanceChecks'))!), '2026-10-10');
    expect(done).toMatchObject([{ closed: false, amount: -40_00 }]);
    const recorded = await getAll<Transaction>(db2, 'transactions');
    expect(recorded).toMatchObject([{ type: 'expense', amount: 40_00, date: '2026-10-06', methodId: 'cashm' }]);
    const history = (await getMeta<BalanceCheck[]>(db2, 'balanceChecks'))!;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ result: 'corrected', gapTxId: recorded[0].id });
  });
});

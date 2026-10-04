import { describe, expect, it } from 'vitest';
import type { Ledger } from './balance';
import { getAll, getMeta, openDb, putRecords } from './db';
import { appBalance, checkDue, checkMark, checkStatus, correctBalance, explainGap, gapFor, gapForChange, type BalanceCheck } from './reconcile';
import type { Account, Category, Transaction } from './types';

let n = 0;
const bank: Account = { id: 'bank', name: 'בנק', kind: 'bank', openingBalance: 1_000_00, order: 0 };

describe('checking the balance against the bank', () => {
  it('correcting records the gap as unexplained, so today\'s balance is the real one and the month counts it', async () => {
    const db = await openDb(`reconcile-${++n}`);
    await putRecords(db, 'accounts', [bank]);
    const ledger: Ledger = {
      accounts: [bank], methods: [{ id: 'b', name: 'b', kind: 'bank', accountId: 'bank', order: 0 }], startDate: '2026-09-01',
      transactions: [{ id: 't', type: 'expense', amount: 200_00, date: '2026-09-10', methodId: 'b', categoryId: 'c', createdAt: '', updatedAt: '' }],
    };
    const app = appBalance(ledger, 'bank', '2026-09-28');
    expect(app).toBe(800_00);
    await correctBalance(db, { categories: [], methods: ledger.methods }, bank, 750_00, app, '2026-09-28');
    const txs = await getAll<Transaction>(db, 'transactions');
    const [unknown] = await getAll<Category>(db, 'categories');
    expect(unknown).toMatchObject({ name: 'לא מזוהה', kind: 'expense' });
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({ type: 'expense', amount: 50_00, date: '2026-09-28', methodId: 'b', categoryId: unknown.id });
    expect(appBalance({ ...ledger, transactions: [...ledger.transactions, ...txs] }, 'bank', '2026-09-28')).toBe(750_00);
    expect((await getMeta<BalanceCheck[]>(db, 'balanceChecks'))![0]).toMatchObject({ real: 750_00, app: 800_00, result: 'corrected' });
  });

  it('something remembered later can explain part of the gap, without counting it twice', async () => {
    const db = await openDb(`reconcile-${++n}`);
    const methods = [{ id: 'b', name: 'b', kind: 'bank' as const, accountId: 'bank', order: 0 }, { id: 'cash', name: 'מזומן', kind: 'cash' as const, accountId: 'wallet', order: 1 }];
    await correctBalance(db, { categories: [], methods }, bank, 650_00, 1_000_00, '2026-10-04');
    const categories = await getAll<Category>(db, 'categories');
    const data = () => getAll<Transaction>(db, 'transactions').then(transactions => ({ transactions, categories, methods }));
    const [gap] = (await data()).transactions;
    const dentist: Transaction = { id: 'd', type: 'expense', amount: 50_00, date: '2026-10-01', methodId: 'b', categoryId: 'health', createdAt: '', updatedAt: '' };
    expect(gapFor(await data(), dentist)?.id).toBe(gap.id);
    // Not when it's after the check, from another account, or bigger than the gap
    expect(gapFor(await data(), { ...dentist, date: '2026-10-05' })).toBeUndefined();
    expect(gapFor(await data(), { ...dentist, methodId: 'cash' })).toBeUndefined();
    expect(gapFor(await data(), { ...dentist, amount: 400_00 })).toBeUndefined();
    // A corrected amount, or something deleted, only when it moves the balance the gap's way
    const shop: Transaction = { ...dentist, id: 's', amount: 100_00 };
    expect(gapForChange(await data(), shop, { ...shop, amount: 120_00 })).toMatchObject({ gap: { id: gap.id }, by: 20_00 });
    expect(gapForChange(await data(), shop, { ...shop, amount: 80_00 })).toBeUndefined();
    expect(gapForChange(await data(), shop, undefined)).toBeUndefined();
    const salary: Transaction = { ...dentist, id: 'pay', type: 'income', methodId: undefined, accountId: 'bank', amount: 100_00 };
    expect(gapForChange(await data(), salary, undefined)?.by).toBe(100_00);
    await explainGap(db, gap, 50_00, { put: dentist });
    let txs = (await data()).transactions;
    expect(txs.find(t => t.id === gap.id)?.amount).toBe(300_00);
    const ledger: Ledger = { accounts: [bank], methods, startDate: '2026-09-01', transactions: txs };
    expect(appBalance(ledger, 'bank', '2026-10-04')).toBe(650_00);
    // The rest explained: the gap is gone
    await explainGap(db, txs.find(t => t.id === gap.id)!, 300_00, { put: { ...dentist, id: 'rent', amount: 300_00 } });
    txs = (await data()).transactions;
    expect(txs.map(t => t.id).sort()).toEqual(['d', 'rent']);
  });

  it('the quiet reminder comes due by the chosen interval', () => {
    expect(checkDue('never', undefined, '2026-09-28')).toBe(false);
    expect(checkDue('week', undefined, '2026-09-28')).toBe(true);
    expect(checkDue('week', '2026-09-22', '2026-09-28')).toBe(false);
    expect(checkDue('week', '2026-09-21', '2026-09-28')).toBe(true);
    expect(checkDue('month', '2026-09-01', '2026-09-28')).toBe(false);
  });
});

describe('which money sources are due a check', () => {
  const acc = (id: string, kind: 'bank' | 'app' | 'cash' | 'goal'): Account => ({ id, name: id, kind, openingBalance: 0, order: 0 });
  const accounts = [acc('bank', 'bank'), acc('bit', 'app'), acc('cash', 'cash'), acc('trip', 'goal')];
  const check = (accountId: string, date: string): BalanceCheck => ({ date, accountId, real: 0, app: 0, result: 'match' });

  it('together: all on one schedule, and the count of those done so far', () => {
    const s = { accounts, checkMode: 'together' as const, checkEvery: 'week' as const, checkEveryByAccount: {}, balanceChecks: [check('bank', '2026-09-28')] };
    const st = checkStatus(s, '2026-09-29');
    // The goal isn't checked; the bank was checked yesterday
    expect(st.due.map(a => a.id)).toEqual(['bit', 'cash']);
    expect([st.checked, st.total]).toEqual([1, 3]);
    expect(checkStatus(s, '2026-10-05').due.map(a => a.id)).toEqual(['bank', 'bit', 'cash']);
  });

  it('each on its own: cash monthly by default, anything can be changed or turned off', () => {
    const s = {
      accounts,
      checkMode: 'separate' as const,
      checkEvery: 'week' as const,
      checkEveryByAccount: { bit: 'never' as const },
      balanceChecks: [check('bank', '2026-09-20'), check('cash', '2026-09-20')],
    };
    expect(checkStatus(s, '2026-09-29').due.map(a => a.id)).toEqual(['bank']);
    expect(checkStatus(s, '2026-10-21').due.map(a => a.id)).toEqual(['bank', 'cash']);
  });
});

describe('early checks and minor gaps', () => {
  const bank: Account = { id: 'bank', name: 'בנק', kind: 'bank', openingBalance: 0, order: 0 };
  const check = (date: string, keepSchedule?: boolean): BalanceCheck => ({ date, accountId: 'bank', real: 0, app: 0, result: 'match', keepSchedule });

  it('an early check kept off the schedule leaves the next reminder where it was', () => {
    const s = (checks: BalanceCheck[]) => ({ accounts: [bank], checkMode: 'together' as const, checkEvery: 'week' as const, checkEveryByAccount: {}, balanceChecks: checks });
    // Checked on Tuesday the 22nd; on Monday the 28th checked again, early
    expect(checkStatus(s([check('2026-09-28'), check('2026-09-22')]), '2026-09-29').due).toEqual([]);
    expect(checkStatus(s([check('2026-09-28', true), check('2026-09-22')]), '2026-09-29').due.map(a => a.id)).toEqual(['bank']);
  });

  it('marks a gap within the limit as minor', () => {
    expect(checkMark(100_00, 100_00, 10_00)).toBe('exact');
    expect(checkMark(100_00, 92_00, 10_00)).toBe('minor');
    expect(checkMark(100_00, 89_00, 10_00)).toBe('off');
    expect(checkMark(100_00, 99_00, 0)).toBe('off');
  });
});

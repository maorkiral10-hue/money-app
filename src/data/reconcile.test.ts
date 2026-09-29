import { describe, expect, it } from 'vitest';
import type { Ledger } from './balance';
import { getAll, getMeta, openDb, putRecords } from './db';
import { appBalance, checkDue, checkMark, checkStatus, correctBalance, type BalanceCheck } from './reconcile';
import type { Account } from './types';

let n = 0;
const bank: Account = { id: 'bank', name: 'בנק', kind: 'bank', openingBalance: 1_000_00, order: 0 };

describe('checking the balance against the bank', () => {
  it('correcting sets today\'s balance to the real one and records it', async () => {
    const db = await openDb(`reconcile-${++n}`);
    await putRecords(db, 'accounts', [bank]);
    const ledger: Ledger = {
      accounts: [bank], methods: [{ id: 'b', name: 'b', kind: 'bank', accountId: 'bank', order: 0 }], startDate: '2026-09-01',
      transactions: [{ id: 't', type: 'expense', amount: 200_00, date: '2026-09-10', methodId: 'b', categoryId: 'c', createdAt: '', updatedAt: '' }],
    };
    const app = appBalance(ledger, 'bank', '2026-09-28');
    expect(app).toBe(800_00);
    await correctBalance(db, bank, 750_00, app, '2026-09-28');
    const [saved] = await getAll<Account>(db, 'accounts');
    expect(appBalance({ ...ledger, accounts: [saved] }, 'bank', '2026-09-28')).toBe(750_00);
    expect((await getMeta<BalanceCheck[]>(db, 'balanceChecks'))![0]).toMatchObject({ real: 750_00, app: 800_00, result: 'corrected' });
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

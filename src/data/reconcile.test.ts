import { describe, expect, it } from 'vitest';
import type { Ledger } from './balance';
import { getAll, getMeta, openDb, putRecords } from './db';
import { appBalance, checkDue, correctBalance, type BalanceCheck } from './reconcile';
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

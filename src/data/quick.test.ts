import { describe, expect, it } from 'vitest';
import { presetFromClipboard, quickTransaction } from './quick';
import type { Account, Category, PaymentMethod } from './types';

const data = {
  accounts: [{ id: 'bank', name: 'חשבון הבנק', kind: 'bank', openingBalance: 0, order: 0 }] as Account[],
  methods: [{ id: 'cash', name: 'מזומן', kind: 'cash', accountId: 'c', order: 0 }] as PaymentMethod[],
  categories: [
    { id: 'food', name: 'אוכל בחוץ', kind: 'expense', order: 0 },
    { id: 'salary', name: 'משכורת', kind: 'income', order: 0 },
  ] as Category[],
};

describe('quick entry from the iPhone Shortcut', () => {
  it('reads what the Shortcut copied, Hebrew and spaces included', () => {
    expect(presetFromClipboard(' money-app:add=expense&amount=45,5&cat=אוכל בחוץ&pay=מזומן\n')).toEqual({
      type: 'expense', amount: 45_50, category: 'אוכל בחוץ', method: 'מזומן',
    });
    expect(presetFromClipboard('just some text')).toBeNull();
  });

  it('saves straight away when everything matches', () => {
    const tx = quickTransaction(presetFromClipboard('money-app:add=expense&amount=45&cat=אוכל בחוץ&pay=מזומן')!, data, '2026-09-26')!;
    expect([tx.type, tx.amount, tx.date, tx.categoryId, tx.methodId]).toEqual(['expense', 45_00, '2026-09-26', 'food', 'cash']);
    const income = quickTransaction(presetFromClipboard('money-app:add=income&amount=8000&cat=משכורת&pay=חשבון הבנק')!, data, '2026-09-26')!;
    expect([income.categoryId, income.accountId]).toEqual(['salary', 'bank']);
  });

  it('leaves it to the entry screen when a name is unknown', () => {
    expect(quickTransaction(presetFromClipboard('money-app:add=expense&amount=45&cat=אחר לגמרי&pay=מזומן')!, data, '2026-09-26')).toBeNull();
  });
});

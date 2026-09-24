import type { Account, Category, PaymentMethod } from './types';

const uid = () => crypto.randomUUID();

// Suggestions only: the questionnaire shows them ticked or not, and the user can rename, untick or add.
export const suggestedAccounts = (): Account[] => [
  { id: uid(), name: 'חשבון הבנק', kind: 'bank', openingBalance: 0, order: 0 },
  { id: uid(), name: 'מזומן', kind: 'cash', openingBalance: 0, order: 1 },
  { id: uid(), name: 'ביט', kind: 'app', openingBalance: 0, order: 2 },
];

export function suggestedMethods(accounts: Account[]): PaymentMethod[] {
  const active = accounts.filter(a => !a.archived);
  const bank = active.find(a => a.kind === 'bank') ?? active[0];
  const methods: PaymentMethod[] = [];
  const add = (m: Omit<PaymentMethod, 'id' | 'order'>) => methods.push({ ...m, id: uid(), order: methods.length });

  for (const a of active) {
    if (a.kind === 'cash') add({ name: a.name, kind: 'cash', accountId: a.id });
    if (a.kind === 'bank') add({ name: `העברה / הוראת קבע (${a.name})`, kind: 'bank', accountId: a.id });
    if (a.kind === 'app') add({ name: a.name, kind: 'app', accountId: a.id });
  }
  if (bank) add({ name: 'כרטיס אשראי', kind: 'credit', accountId: bank.id, chargeDay: 10, openingPending: 0, archived: true });
  return methods;
}

const EXPENSE = [
  'סופר ומכולת', 'אוכל בחוץ', 'דלק ותחבורה', 'דיור ושכר דירה', 'חשבונות (חשמל, מים, ארנונה)',
  'טלפון ואינטרנט', 'בריאות', 'ביגוד וקניות', 'בילויים ופנאי', 'מנויים', 'מתנות ואירועים', 'רכב', 'אחר',
];
const INCOME = ['משכורת', 'עבודה נוספת', 'החזרים', 'מתנות', 'אחר'];

export const suggestedCategories = (): Category[] => [
  ...EXPENSE.map((name, order) => ({ id: uid(), name, kind: 'expense' as const, order })),
  ...INCOME.map((name, order) => ({ id: uid(), name, kind: 'income' as const, order })),
];

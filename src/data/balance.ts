import { dayInMonth, endOfNextMonth } from './dates';
import { expectedTransactions } from './recurring';
import type { Account, PaymentMethod, Recurring, Transaction } from './types';

/** One change to one account's balance on one day. */
export interface Effect {
  accountId: string;
  date: string;
  amount: number;
  kind: 'income' | 'expense' | 'credit' | 'transfer';
  txId?: string;
  /** Credit charges: the card. */
  methodId?: string;
}

export interface Ledger {
  accounts: Account[];
  methods: PaymentMethod[];
  transactions: Transaction[];
  recurring?: Recurring[];
  startDate: string;
}

/** First day strictly after `after` on which a card with this charge day is charged. */
export function nextChargeDate(after: string, chargeDay: number) {
  const thisMonth = dayInMonth(after, 0, chargeDay);
  return thisMonth > after ? thisMonth : dayInMonth(after, 1, chargeDay);
}

/** Splits an amount into n monthly payments; any leftover agorot go on the first one. */
export function splitInstallments(amount: number, n: number) {
  const base = Math.floor(amount / n);
  const parts = Array<number>(n).fill(base);
  parts[0] += amount - base * n;
  return parts;
}

export function transactionEffects(tx: Transaction, methods: Map<string, PaymentMethod>): Effect[] {
  const txId = tx.id;
  if (tx.type === 'income') {
    return tx.accountId ? [{ accountId: tx.accountId, date: tx.date, amount: tx.amount, kind: 'income', txId }] : [];
  }
  if (tx.type === 'transfer') {
    if (!tx.accountId || !tx.toAccountId) return [];
    return [
      { accountId: tx.accountId, date: tx.date, amount: -tx.amount, kind: 'transfer', txId },
      { accountId: tx.toAccountId, date: tx.date, amount: tx.amount, kind: 'transfer', txId },
    ];
  }
  const method = tx.methodId ? methods.get(tx.methodId) : undefined;
  if (!method) return [];
  if (method.kind === 'credit' && method.chargeDay) {
    // The purchase is recorded on its own date, but the bank only pays it on the card's charge days
    const first = nextChargeDate(tx.date, method.chargeDay);
    return splitInstallments(tx.amount, Math.max(1, tx.installments ?? 1)).map((amount, i) => ({
      accountId: method.accountId,
      date: dayInMonth(first, i, method.chargeDay!),
      amount: -amount,
      kind: 'credit' as const,
      txId,
      methodId: method.id,
    }));
  }
  return [{ accountId: method.accountId, date: tx.date, amount: -tx.amount, kind: 'expense', txId }];
}

/**
 * Every balance change since the start date. Transactions dated before the start date are
 * left out: they are already part of the opening balances (and, for cards, of openingPending).
 */
export function allEffects(ledger: Ledger, today?: string): Effect[] {
  const methods = new Map(ledger.methods.map(m => [m.id, m]));
  // Expected recurring occurrences are always dated after today, so they only ever reach the forecast
  const expected =
    today && ledger.recurring
      ? expectedTransactions(ledger.recurring, ledger.transactions, today, endOfNextMonth(today), ledger.startDate)
      : [];
  const effects = [...ledger.transactions, ...expected]
    .filter(tx => tx.date >= ledger.startDate)
    .flatMap(tx => transactionEffects(tx, methods));
  for (const m of ledger.methods) {
    if (m.kind === 'credit' && m.chargeDay && m.openingPending) {
      effects.push({
        accountId: m.accountId,
        date: nextChargeDate(ledger.startDate, m.chargeDay),
        amount: -m.openingPending,
        kind: 'credit',
        methodId: m.id,
      });
    }
  }
  return effects;
}

export interface Summary {
  /** All money available right now, across every account. */
  liquid: number;
  byAccount: { account: Account; balance: number }[];
  upcoming: {
    until: string;
    credit: number;
    income: number;
    expenses: number;
    /** liquid plus everything expected up to `until` */
    projected: number;
  };
}

export function summarize(ledger: Ledger, today: string): Summary {
  const effects = allEffects(ledger, today);
  const balances = new Map(ledger.accounts.map(a => [a.id, a.openingBalance]));
  const until = endOfNextMonth(today);
  const upcoming = { until, credit: 0, income: 0, expenses: 0, projected: 0 };
  let future = 0;

  for (const e of effects) {
    if (e.date <= today) {
      balances.set(e.accountId, (balances.get(e.accountId) ?? 0) + e.amount);
    } else if (e.date <= until) {
      future += e.amount;
      if (e.kind === 'credit') upcoming.credit += e.amount;
      else if (e.kind === 'income') upcoming.income += e.amount;
      else if (e.kind === 'expense') upcoming.expenses += e.amount;
    }
  }

  const byAccount = ledger.accounts
    .filter(a => !a.archived || balances.get(a.id))
    .map(account => ({ account, balance: balances.get(account.id) ?? 0 }));
  const liquid = [...balances.values()].reduce((a, b) => a + b, 0);
  upcoming.projected = liquid + future;
  return { liquid, byAccount, upcoming };
}

export interface CardUsage {
  card: PaymentMethod;
  /** Everything bought on the card and not yet charged, including all future installments. */
  used: number;
  /** limit − used; undefined when no limit is set. */
  available?: number;
  nextCharge?: { date: string; amount: number };
}

/** How much of each credit card's limit is taken up right now. Purchases dated in the future don't count yet. */
export function cardUsage(ledger: Ledger, today: string): CardUsage[] {
  const txDates = new Map(ledger.transactions.map(t => [t.id, t.date]));
  const pending = allEffects(ledger).filter(
    e => e.kind === 'credit' && e.date > today && (!e.txId || (txDates.get(e.txId) ?? '') <= today),
  );
  return ledger.methods
    .filter(m => m.kind === 'credit')
    .map(card => {
      const own = pending.filter(e => e.methodId === card.id);
      const used = -own.reduce((a, e) => a + e.amount, 0);
      const first = own.map(e => e.date).sort()[0];
      return {
        card,
        used,
        available: card.creditLimit ? card.creditLimit - used : undefined,
        nextCharge: first ? { date: first, amount: -own.filter(e => e.date === first).reduce((a, e) => a + e.amount, 0) } : undefined,
      };
    })
    .filter(u => !u.card.archived || u.used);
}

/** One line in the forecast: a future income or expense, or one card's charge on one day. */
export interface UpcomingItem {
  date: string;
  amount: number;
  kind: 'income' | 'expense' | 'credit';
  txId?: string;
  methodId?: string;
  /** Credit charges: how many purchases/installments make up this charge. */
  purchases: number;
  /** Credit charges: includes what was already on the card on the start date. */
  opening?: boolean;
}

/** Everything expected after today up to the end of next month, oldest first. Transfers are left out: they don't change the total. */
export function upcomingItems(ledger: Ledger, today: string): UpcomingItem[] {
  const until = endOfNextMonth(today);
  const items: UpcomingItem[] = [];
  const charges = new Map<string, UpcomingItem>();
  for (const e of allEffects(ledger, today)) {
    if (e.date <= today || e.date > until || e.kind === 'transfer') continue;
    if (e.kind !== 'credit') {
      items.push({ date: e.date, amount: e.amount, kind: e.kind, txId: e.txId, purchases: 0 });
      continue;
    }
    const key = `${e.methodId}|${e.date}`;
    const charge = charges.get(key) ?? { date: e.date, amount: 0, kind: 'credit', methodId: e.methodId, purchases: 0 };
    charge.amount += e.amount;
    if (e.txId) charge.purchases++;
    else charge.opening = true;
    charges.set(key, charge);
  }
  return [...items, ...charges.values()].sort((a, b) => a.date.localeCompare(b.date));
}

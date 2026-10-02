import { addDays, dayInMonth, endOfNextMonth } from './dates';
import { expectedTransactions } from './recurring';
import { isGoal, type Account, type PaymentMethod, type Recurring, type Transaction } from './types';

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

/** The charge a card purchase (or refund) goes into: the one the user said, or the next one after it. */
export const chargeOf = (tx: Pick<Transaction, 'date' | 'chargeDate'>, chargeDay: number) => tx.chargeDate ?? nextChargeDate(tx.date, chargeDay);

/** How many days before a charge day a purchase may still go into the charge after it. */
export const EDGE_DAYS = 3;

/**
 * A purchase close to the card's charge day — up to EDGE_DAYS before it, or on the day itself — can land in
 * that charge or in the one after, depending on when the shop passes it on. Returns the two, or nothing.
 */
export function edgeCharges(date: string, chargeDay: number): { early: string; late: string } | undefined {
  if (dayInMonth(date, 0, chargeDay) === date) return { early: date, late: nextChargeDate(date, chargeDay) };
  const next = nextChargeDate(date, chargeDay);
  return addDays(date, EDGE_DAYS) >= next ? { early: next, late: nextChargeDate(next, chargeDay) } : undefined;
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
    // A refund to a credit card takes that much off the card's next charge
    const card = tx.methodId ? methods.get(tx.methodId) : undefined;
    if (card?.kind === 'credit' && card.chargeDay) {
      return [{ accountId: card.accountId, date: chargeOf(tx, card.chargeDay), amount: tx.amount, kind: 'credit', txId, methodId: card.id }];
    }
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
  // Spent straight from a savings goal
  if (!method) return tx.accountId ? [{ accountId: tx.accountId, date: tx.date, amount: -tx.amount, kind: 'expense', txId }] : [];
  if (method.kind === 'credit' && method.chargeDay) {
    // The purchase is recorded on its own date, but the bank only pays it on the card's charge days
    const first = chargeOf(tx, method.chargeDay);
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
export function allEffects(ledger: Ledger, today?: string, expectedUntil?: string): Effect[] {
  const methods = new Map(ledger.methods.map(m => [m.id, m]));
  // Expected recurring occurrences are always dated after today, so they only ever reach the forecast
  const expected =
    today && ledger.recurring
      ? expectedTransactions(ledger.recurring, ledger.transactions, today, expectedUntil ?? endOfNextMonth(today), ledger.startDate)
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
  /** All money available right now, across every account (savings goals aren't available, so not counted). */
  liquid: number;
  byAccount: { account: Account; balance: number }[];
  /** Savings goals, each with what's in it. */
  goals: { account: Account; balance: number }[];
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

  const shown = ledger.accounts
    .filter(a => !a.archived || balances.get(a.id))
    .map(account => ({ account, balance: balances.get(account.id) ?? 0 }));
  const byAccount = shown.filter(b => !isGoal(b.account));
  const goals = shown.filter(b => isGoal(b.account));
  const liquid = byAccount.reduce((a, b) => a + b.balance, 0);
  // Moving money into or out of a goal is a transfer: it changes what's liquid, not the future
  const goalIds = new Set(goals.map(g => g.account.id));
  const futureGoalMoves = effects.filter(e => e.date > today && e.date <= until && goalIds.has(e.accountId)).reduce((a, e) => a + e.amount, 0);
  upcoming.projected = liquid + future - futureGoalMoves;
  return { liquid, byAccount, goals, upcoming };
}

/** One line of a card's bill: a purchase (or one of its installments), a refund, or what was on the card at the start. */
export interface StatementItem {
  tx?: Transaction;
  /** Negative for a refund (זיכוי). */
  amount: number;
  installment?: { n: number; of: number };
  opening?: boolean;
}

/** One charge of a credit card to the bank, and what it's made of. */
export interface Statement {
  methodId: string;
  date: string;
  amount: number;
  items: StatementItem[];
}

/**
 * A credit card's charges, oldest first: every purchase (from the start date) lands in the charge after it
 * was made, installments one per month - the same rule the balance uses (transactionEffects).
 */
export function cardStatements(ledger: Ledger, methodId: string): Statement[] {
  const card = ledger.methods.find(m => m.id === methodId);
  if (!card || card.kind !== 'credit' || !card.chargeDay) return [];
  const byDate = new Map<string, Statement>();
  const add = (date: string, item: StatementItem) => {
    const s = byDate.get(date) ?? { methodId, date, amount: 0, items: [] };
    s.amount += item.amount;
    s.items.push(item);
    byDate.set(date, s);
  };
  for (const tx of ledger.transactions) {
    if (tx.methodId !== methodId || tx.date < ledger.startDate) continue;
    if (tx.type === 'income') {
      add(chargeOf(tx, card.chargeDay), { tx, amount: -tx.amount });
      continue;
    }
    if (tx.type !== 'expense') continue;
    const of = Math.max(1, tx.installments ?? 1);
    const first = chargeOf(tx, card.chargeDay);
    splitInstallments(tx.amount, of).forEach((amount, i) =>
      add(dayInMonth(first, i, card.chargeDay!), { tx, amount, installment: of > 1 ? { n: i + 1, of } : undefined }),
    );
  }
  if (card.openingPending) add(nextChargeDate(ledger.startDate, card.chargeDay), { amount: card.openingPending, opening: true });
  for (const s of byDate.values()) s.items.sort((a, b) => (b.tx?.date ?? '').localeCompare(a.tx?.date ?? ''));
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export interface CardUsage {
  card: PaymentMethod;
  /** Everything bought on the card and not yet charged, including all future installments. */
  used: number;
  /** limit − used; undefined when no limit is set. */
  available?: number;
  nextCharge?: { date: string; amount: number };
  /** Date of the latest purchase recorded on the card (up to today): where to look from when it doesn't match the card's app. */
  lastEntry?: string;
}

/**
 * How much of each credit card's limit is taken up on a day (`today` unless said otherwise): purchases
 * made by then that the bank hasn't paid for by then. For a day still to come, the card's standing orders
 * due by then count too (from the charge the form's "החיוב הראשון" answer put the first one in).
 */
export function cardUsage(ledger: Ledger, today: string, now = today): CardUsage[] {
  const coming = today > now && ledger.recurring ? expectedTransactions(ledger.recurring, ledger.transactions, now, today, ledger.startDate) : [];
  const withComing = coming.length ? { ...ledger, transactions: [...ledger.transactions, ...coming] } : ledger;
  const txDates = new Map(withComing.transactions.map(t => [t.id, t.date]));
  const pending = allEffects(withComing).filter(
    e => e.kind === 'credit' && e.date > today && (!e.txId || (txDates.get(e.txId) ?? '') <= today),
  );
  return ledger.methods
    .filter(m => m.kind === 'credit')
    .map(card => {
      const own = pending.filter(e => e.methodId === card.id);
      // More refunded than bought: nothing is used (the refund waits for the next charge)
      const used = Math.max(0, -own.reduce((a, e) => a + e.amount, 0));
      const first = own.map(e => e.date).sort()[0];
      const lastEntry = ledger.transactions
        .filter(t => t.type === 'expense' && t.methodId === card.id && t.date <= today)
        .reduce<string | undefined>((max, t) => (!max || t.date > max ? t.date : max), undefined);
      return {
        card,
        lastEntry,
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

/** Everything expected after today up to `until` (default: end of next month), oldest first. Transfers are left out: they don't change the total. */
export function upcomingItems(ledger: Ledger, today: string, until = endOfNextMonth(today)): UpcomingItem[] {
  const items: UpcomingItem[] = [];
  const charges = new Map<string, UpcomingItem>();
  for (const e of allEffects(ledger, today, until > endOfNextMonth(today) ? until : undefined)) {
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

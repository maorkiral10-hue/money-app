// All amounts are whole agorot (100 = 1 ₪) so sums never pick up rounding errors.
// All dates are local calendar days as 'YYYY-MM-DD'.

export interface Note {
  id: string;
  text: string;
  createdAt: string;
  appVersion: number;
}

/**
 * A place money sits: bank account, cash, a payment app's balance. Together they make up the liquid total.
 * A savings goal is kept as an account of its own kind ("goal"): money moved into it leaves the liquid
 * total (by an ordinary transfer), and can be moved back the same way.
 */
export type AccountKind = 'bank' | 'cash' | 'app' | 'other' | 'goal';
export interface Account {
  id: string;
  name: string;
  kind: AccountKind;
  /** Balance on the start date, as the user typed it. For a goal: what was already saved for it. */
  openingBalance: number;
  order: number;
  archived?: boolean;
  /** Goals: the amount to reach (with or without a date). */
  goalTarget?: number;
  /** Goals: when to reach it by. */
  goalDate?: string;
  /** Goals without a target: a fixed amount to put aside every month. */
  goalMonthly?: number;
  /** Goals: the expense category the money is for, used when it's spent straight from the goal. */
  goalCategoryId?: string;
}

export const isGoal = (a: Pick<Account, 'kind'>) => a.kind === 'goal';

/** How an expense is paid, and which account the money eventually leaves. */
export type MethodKind = 'cash' | 'credit' | 'bank' | 'app' | 'other';
export interface PaymentMethod {
  id: string;
  name: string;
  kind: MethodKind;
  accountId: string;
  /** Credit cards: day of month the card is charged to `accountId`. */
  chargeDay?: number;
  /** Credit cards: purchases made before the start date that the next charge will include. */
  openingPending?: number;
  /** Credit cards: the card's limit (מסגרת). Optional; added in app version 8. */
  creditLimit?: number;
  order: number;
  archived?: boolean;
}

export interface Category {
  id: string;
  name: string;
  kind: 'expense' | 'income';
  order: number;
  archived?: boolean;
  /** Chosen color; when missing, one is given by the category's place in its list (see data/colors.ts). */
  color?: string;
}

export type TxType = 'expense' | 'income' | 'transfer';
export interface Transaction {
  id: string;
  type: TxType;
  amount: number;
  date: string;
  categoryId?: string;
  /** Expenses: how it was paid. */
  methodId?: string;
  /** Income: account it went into. Transfers: account it left. Expenses paid straight from a savings goal: the goal. */
  accountId?: string;
  /** Transfers: account it went into. */
  toAccountId?: string;
  /** Credit card expenses split into monthly payments. */
  installments?: number;
  note?: string;
  /** Set when the transaction was created from a recurring item, for that item's occurrence on `occurrence`. */
  recurringId?: string;
  occurrence?: string;
  createdAt: string;
  updatedAt: string;
}

/** Salary, rent, standing orders: something that repeats on a schedule. */
export interface Recurring {
  id: string;
  name: string;
  type: 'income' | 'expense';
  frequency: 'yearly' | 'monthly' | 'weekly' | 'daily';
  /** First occurrence; its day of month / weekday sets the schedule. */
  firstDate: string;
  /** No occurrences after this day (set when the user ends the item). */
  endDate?: string;
  /** Fixed amounts are recorded automatically; variable ones wait for the user to confirm how much it really was. */
  variable: boolean;
  /** Variable only: forecast with `amount`, or with the average of the last few confirmed amounts. */
  estimate: 'set' | 'average';
  amount: number;
  categoryId?: string;
  methodId?: string;
  accountId?: string;
  /** Every occurrence up to and including this day has been recorded or dismissed. */
  handledThrough: string;
  createdAt: string;
}

/**
 * Something coming up on the calendar (a wedding, a car test, a bonus), with what it's expected to cost
 * or bring in. Planning only: events never touch balances, the budget or the forecast.
 */
export interface CalendarEvent {
  id: string;
  date: string;
  title: string;
  /** 'none': an event with no money attached. */
  type: 'income' | 'expense' | 'none';
  /** Expected amount; 0 when there isn't one. */
  amount: number;
  note?: string;
  /** 'HH:MM'; missing for an all-day event. */
  startTime?: string;
  /** 'HH:MM'; missing when only the start is known. */
  endTime?: string;
  /** Once it's over: the user said what it came to (the transaction recorded), or that there was nothing. */
  settled?: EventAnswer;
  /**
   * Repeats from `date` on: every day, on chosen weekdays (`repeatDays`), every week (same weekday),
   * month (same day) or year.
   */
  repeat?: 'daily' | 'days' | 'weekly' | 'monthly' | 'yearly';
  /** Repeat on these weekdays: 0 = Sunday … 6 = Saturday (Sunday to Thursday for a working week). */
  repeatDays?: number[];
  /** Repeating events: single days taken out of the series (cancelled that time only). */
  skipDates?: string[];
  /** Repeating events: no repeats after this day. */
  repeatUntil?: string;
  /** Repeating events: the answer for each date it came round on (`settled` is for one-off events). */
  settledDates?: Record<string, EventAnswer>;
  createdAt: string;
}

/** What an event came to once it was over: the transaction recorded, or none when there was nothing. */
export interface EventAnswer {
  at: string;
  txId?: string;
}

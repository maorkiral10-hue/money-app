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
  /**
   * Goals: where its money really is. "deposit" (a deposit or separate account) and "envelope" (cash put away
   * apart): out of the liquid money, as before (missing: "deposit"). "inside": still in a money source
   * (`goalSource`), only marked as set aside, so that source's balance and its checks include it.
   */
  goalPlace?: 'deposit' | 'envelope' | 'inside';
  /** Goals: the money source it's inside ("inside"), or that its money comes back to (a deposit: the bank; an envelope: cash). */
  goalSource?: string;
  /**
   * Goals: a deposit every month, on this day, of `goalEveryAmount`. Recorded on its own only when a real
   * standing order in the bank moves it (`goalEveryByBank`); otherwise a reminder asks on the day.
   */
  goalEveryDay?: number;
  goalEveryAmount?: number;
  goalEveryByBank?: boolean;
  /** Every monthly deposit up to this day has been made, or said not to happen. */
  goalEveryHandled?: string;
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
  /**
   * Expense categories: money put into savings (a pension or provident fund, a deposit). It leaves the
   * account like any expense, but isn't spending: the month shows it apart, as savings.
   */
  savings?: boolean;
}

export type TxType = 'expense' | 'income' | 'transfer';
export interface Transaction {
  id: string;
  type: TxType;
  amount: number;
  date: string;
  categoryId?: string;
  /** Expenses: how it was paid. Income: the credit card it was refunded to (זיכוי), instead of an account. */
  methodId?: string;
  /** Income: account it went into. Transfers: account it left. Expenses paid straight from a savings goal: the goal. */
  accountId?: string;
  /** Transfers: account it went into. */
  toAccountId?: string;
  /** Credit card expenses split into monthly payments. */
  installments?: number;
  /**
   * Credit card purchases (and refunds) bought close to the card's charge day: the charge it really went
   * into, as the user said (otherwise the next charge after the purchase). With payments, the first one.
   */
  chargeDate?: string;
  note?: string;
  /**
   * Spent (or received) as part of a calendar event with an expected amount: it adds up in the event's
   * "pot" (its own category still shows where the money went). `eventDate` is the day that time round of
   * the event started (a repeating event has one pot each time).
   */
  eventId?: string;
  eventDate?: string;
  /** An extra deposit into a long-term savings fund (besides its standing order): counts in its estimated balance. */
  fundId?: string;
  /**
   * A move back out of a goal made to pay for something on it from other money ("מהכסף שבצד"): the id of
   * that expense. It isn't money taken back from savings, so the month's savings don't count it.
   */
  coverFor?: string;
  /** Paid with other money for what a savings goal is for (a flight for the trip): counts as paid on that goal. */
  goalId?: string;
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
  estimate: 'set' | 'average' | 'last';
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
  /** With an expected amount: the category its money goes under (what's recorded into it starts with it). */
  categoryId?: string;
  note?: string;
  /** 'HH:MM'; missing for an all-day event. */
  startTime?: string;
  /** 'HH:MM' ('24:00' = until the end of the day); missing when only the start is known. */
  endTime?: string;
  /**
   * An event that goes on past its first day: the day it ends (`endTime` is then on that day). Set for
   * several days (a holiday), and for one that runs past midnight (20:00 to 04:00 the next day).
   */
  endDate?: string;
  /**
   * Shown in the calendar only, never saved: one day of an event that spans several, and which part —
   * its first day (from its start), a middle day (all of it), or its last day (until its end).
   */
  part?: 'first' | 'middle' | 'last';
  /** Shown in the calendar only: the day this time round of the event started (its answers are kept by it). */
  startedOn?: string;
  /** Shown in the calendar only: the event as saved (its own times and days). */
  base?: CalendarEvent;
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

// All amounts are whole agorot (100 = 1 ₪) so sums never pick up rounding errors.
// All dates are local calendar days as 'YYYY-MM-DD'.

export interface Note {
  id: string;
  text: string;
  createdAt: string;
  appVersion: number;
}

/** A place money sits: bank account, cash, a payment app's balance. Together they make up the liquid total. */
export type AccountKind = 'bank' | 'cash' | 'app' | 'other';
export interface Account {
  id: string;
  name: string;
  kind: AccountKind;
  /** Balance on the start date, as the user typed it. */
  openingBalance: number;
  order: number;
  archived?: boolean;
}

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
  /** Income: account it went into. Transfers: account it left. */
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

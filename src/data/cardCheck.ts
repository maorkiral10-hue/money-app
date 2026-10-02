import { cardStatements, chargeOf, edgeCharges, splitInstallments, type Statement } from './balance';
import { addDays } from './dates';
import { getMeta, setMeta } from './db';
import type { AppData } from './store';
import type { PaymentMethod, Transaction } from './types';

/**
 * What a card was really charged on one of its charge days, as the user said. `done` once it matches what
 * was recorded (or the gap was recorded); until then the amount is kept, so closing the app on the way
 * (to add what's missing) doesn't lose it.
 */
export interface CardCheck {
  methodId: string;
  /** The charge day. */
  date: string;
  /** What the card company really charged. */
  actual: number;
  done: boolean;
  at: string;
}

const KEEP = 60;

/**
 * Cards whose latest charge has come and wasn't checked yet: the card, that charge as recorded, and the
 * amount the user already said (when they did, but haven't closed the gap yet). Only each card's latest
 * charge: an older one isn't asked about once a newer one came.
 */
export function cardChecksDue(data: Pick<AppData, 'methods' | 'transactions' | 'accounts' | 'recurring' | 'startDate' | 'cardChecks'>, today: string) {
  return data.methods
    .filter(m => m.kind === 'credit' && m.chargeDay && !m.archived)
    .flatMap(card => {
      const charge = cardStatements(data, card.id).filter(s => s.date <= today && s.date > data.startDate).pop();
      if (!charge) return [];
      const check = data.cardChecks.find(c => c.methodId === card.id && c.date === charge.date);
      if (check?.done) return [];
      return [{ card, charge, actual: check?.actual }];
    });
}

/** The days a purchase has to be dated within to be part of this charge: from the charge before it, to the day before. */
export function chargeWindow(card: PaymentMethod, charge: Statement) {
  const prev = addDays(charge.date, -1);
  // The charge day a month before (the same rule nextChargeDate uses, backwards)
  const [y, m] = charge.date.split('-').map(Number);
  const before = new Date(y, m - 2, 1);
  const last = new Date(before.getFullYear(), before.getMonth() + 1, 0).getDate();
  const from = `${before.getFullYear()}-${String(before.getMonth() + 1).padStart(2, '0')}-${String(Math.min(card.chargeDay!, last)).padStart(2, '0')}`;
  return { from, to: prev };
}

/**
 * Purchases (and refunds) on the edge of this charge — bought up to a few days before it, or on its day —
 * that may be in it or in the next one: where each is now, and how much of it that charge holds.
 */
export function edgeItems(data: Pick<AppData, 'transactions'>, card: PaymentMethod, charge: Statement) {
  return data.transactions
    .filter(t => t.methodId === card.id && t.type !== 'transfer')
    .flatMap(tx => {
      const edge = edgeCharges(tx.date, card.chargeDay!);
      if (!edge || edge.early !== charge.date) return [];
      const share = splitInstallments(tx.amount, Math.max(1, tx.installments ?? 1))[0] * (tx.type === 'income' ? -1 : 1);
      return [{ tx, edge, inThis: chargeOf(tx, card.chargeDay!) === charge.date, share }];
    })
    .sort((a, b) => b.tx.date.localeCompare(a.tx.date));
}

/** One edge purchase moved: into this charge, or into the next one. */
export const movedTo = (tx: Transaction, charge: string): Transaction => ({ ...tx, chargeDate: charge });

export async function saveCardCheck(db: IDBDatabase, check: CardCheck) {
  const all = (await getMeta<CardCheck[]>(db, 'cardChecks')) ?? [];
  const others = all.filter(c => !(c.methodId === check.methodId && c.date === check.date));
  await setMeta(db, 'cardChecks', [check, ...others].slice(0, KEEP));
}

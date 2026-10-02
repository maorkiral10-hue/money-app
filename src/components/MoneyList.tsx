import { useState } from 'preact/hooks';
import { cardStatements, chargeOf, edgeCharges, type Statement } from '../data/balance';
import { categoryColor } from '../data/colors';
import { dayLabel, parseDate } from '../data/dates';
import { expectedTransactions } from '../data/recurring';
import { formatMoney } from '../data/money';
import type { AppData } from '../data/store';
import type { Transaction } from '../data/types';
import { StatementItems } from './StatementItems';

/** One line of money on a day: something recorded, or a card's charge to the bank. */
export type MoneyRow = { kind: 'tx'; date: string; tx: Transaction } | { kind: 'charge'; date: string; st: Statement };

const shortDate = (s: string) => {
  const { m0, d } = parseDate(s);
  return `${d}.${m0 + 1}`;
};

/**
 * A standing order charged to a credit card: it takes up the card's limit and is paid in the card's
 * charge, so it's listed inside that charge only, not again on its own day.
 */
export function onCardStandingOrder(tx: Transaction, methods: AppData['methods']) {
  if (tx.type !== 'expense' || !tx.recurringId || !tx.methodId) return false;
  return methods.find(m => m.id === tx.methodId)?.kind === 'credit';
}

/**
 * Tapping a standing order or fixed income that hasn't come yet: ask the app to offer recording it now
 * (it came early). The app listens for this and opens EarlyRecordCard.
 */
export const RECORD_EARLY_EVENT = 'record-early';
export const askRecordEarly = (tx: Transaction) =>
  window.dispatchEvent(new CustomEvent(RECORD_EARLY_EVENT, { detail: { recurringId: tx.recurringId, occurrence: tx.occurrence } }));

/** A standing order that hasn't come round yet: shown on its day, but it isn't a record to open. */
export const isExpected = (tx: Transaction) => tx.id.startsWith('expected:');

/**
 * What's coming after today up to `until`: standing orders and fixed income on their days, and each
 * card's charges with what they're for so far (purchases recorded, plus standing orders on the card
 * that fall before the charge). A new purchase on a card changes its coming charge.
 */
export function plannedMoney(data: AppData, today: string, until: string) {
  if (until <= today) return { expected: [] as Transaction[], variable: [] as Transaction[], charges: [] as Statement[] };
  const expected = expectedTransactions(data.recurring, data.transactions, today, until, data.startDate);
  // Changing amounts: only their days, for the calendar (asked about on the day, counted nowhere before)
  const variableIds = new Set(data.recurring.filter(r => r.variable).map(r => r.id));
  const variable = expectedTransactions(data.recurring, data.transactions, today, until, data.startDate, true).filter(
    t => variableIds.has(t.recurringId ?? '') && (t.occurrence ?? t.date) > today,
  );
  const ledger = { ...data, transactions: [...data.transactions, ...expected] };
  const charges = data.methods
    .filter(m => m.kind === 'credit')
    .flatMap(m => cardStatements(ledger, m.id))
    .filter(st => st.date > today && st.date <= until);
  return { expected, variable, charges };
}

/**
 * Every money line between two days, newest first. Each purchase is on the day it was made (a card
 * purchase too, marked with when the card is charged for it); on a card's charge day there's also a
 * line for the charge itself, which is when the money leaves the bank. Days still to come show what's
 * expected: standing orders, and the coming card charges.
 */
export function moneyRows(data: AppData, from: string, to: string, today: string): MoneyRow[] {
  const past = data.methods
    .filter(m => m.kind === 'credit')
    .flatMap(m => cardStatements(data, m.id))
    .filter(st => st.date >= from && st.date <= to && st.date <= today);
  const planned = plannedMoney(data, today, to);
  return [
    ...data.transactions.filter(t => t.date >= from && t.date <= to && !onCardStandingOrder(t, data.methods)).map(tx => ({ kind: 'tx' as const, date: tx.date, tx })),
    ...planned.expected.filter(t => t.date >= from && !onCardStandingOrder(t, data.methods)).map(tx => ({ kind: 'tx' as const, date: tx.date, tx })),
    ...planned.variable.filter(t => t.date >= from).map(tx => ({ kind: 'tx' as const, date: tx.date, tx })),
    ...[...past, ...planned.charges.filter(st => st.date >= from)].map(st => ({ kind: 'charge' as const, date: st.date, st })),
  ].sort((a, b) => b.date.localeCompare(a.date) || (a.kind === 'tx' && b.kind === 'tx' ? b.tx.createdAt.localeCompare(a.tx.createdAt) : a.kind === 'charge' ? 1 : -1));
}

/** Money lines, one after the other; a card's charge opens to show the purchases it's made of. */
export function MoneyLines(props: { data: AppData; rows: MoneyRow[]; today: string; onEdit: (tx: Transaction) => void }) {
  const { data } = props;
  const [open, setOpen] = useState<string | null>(null);
  const name = new Map<string, string>([...data.accounts, ...data.methods, ...data.categories].map(x => [x.id, x.name]));
  const methods = new Map(data.methods.map(m => [m.id, m]));

  return (
    <>
      {props.rows.map(row => {
        if (row.kind === 'charge') {
          const key = row.st.methodId + row.st.date;
          const coming = row.st.date > props.today;
          return (
            <div key={`c${key}`}>
              <button class="tx charge-row" onClick={() => setOpen(open === key ? null : key)}>
                <div>
                  <div>
                    {coming ? 'חיוב צפוי' : 'חיוב'} {name.get(row.st.methodId)}
                  </div>
                  <div class="muted small">
                    {coming ? 'יירד מהבנק · מתעדכן עם כל קנייה בכרטיס · לחץ לפירוט' : 'יורד מהבנק · הקניות מופיעות בימים שלהן · לחץ לפירוט'}
                  </div>
                </div>
                <div class="muted">{formatMoney(-row.st.amount)}</div>
              </button>
              {open === key && <StatementItems data={data} items={row.st.items} today={props.today} onEdit={props.onEdit} />}
            </div>
          );
        }
        const tx = row.tx;
        const card = tx.type !== 'transfer' && tx.methodId ? methods.get(tx.methodId) : undefined;
        // A card purchase: when the bank pays for it
        const charged = card?.kind === 'credit' && card.chargeDay ? chargeOf(tx, card.chargeDay) : undefined;
        // Close to the charge day and not settled yet: it may turn out to be in the other charge
        const edge = charged && !tx.chargeDate && charged > props.today ? edgeCharges(tx.date, card!.chargeDay!) : undefined;
        const otherCharge = edge && (charged === edge.early ? edge.late : edge.early);
        // Only while that other charge is still to come
        const other = otherCharge && otherCharge > props.today ? otherCharge : undefined;
        const expected = isExpected(tx);
        const changing = expected && data.recurring.find(r => r.id === tx.recurringId)?.variable;
        // A standing order still to come opens "came already?" (it's recorded on its day otherwise)
        return (
          <button key={tx.id} class="tx" onClick={() => (expected ? askRecordEarly(tx) : props.onEdit(tx))}>
            <div>
              <div>
                {tx.type !== 'transfer' && <span class="cat-dot" style={{ background: categoryColor(tx.categoryId, data.categories) }} />}
                {tx.type === 'transfer' ? `${name.get(tx.accountId!)} ← ${name.get(tx.toAccountId!)}` : tx.recurringId ? tx.note : name.get(tx.categoryId!)}
              </div>
              <div class="muted small">
                {[
                  tx.type === 'expense' ? (tx.methodId ? name.get(tx.methodId) : `מהיעד ${name.get(tx.accountId!)}`) : tx.type === 'income' ? (tx.methodId ? `זיכוי ל${name.get(tx.methodId)}` : name.get(tx.accountId!)) : 'העברה',
                  charged &&
                    (tx.type === 'income'
                      ? charged > props.today
                        ? `יורד מהחיוב של ${shortDate(charged)}`
                        : `ירד מהחיוב של ${shortDate(charged)}`
                      : charged > props.today
                        ? `תיגבה ב־${shortDate(charged)}${other ? ` (או ב־${shortDate(other)})` : ''}`
                        : `נגבתה ב־${shortDate(charged)}`),
                  tx.recurringId &&
                    (changing
                      ? 'סכום משתנה · יתעדכן ביום'
                      : expected
                        ? tx.type === 'income'
                          ? 'הכנסה קבועה · נכנסת אוטומטית'
                          : 'הוראת קבע · יורדת אוטומטית'
                        : tx.type === 'income'
                          ? 'הכנסה קבועה'
                          : 'הוראת קבע'),
                  tx.installments && `${tx.installments} תשלומים`,
                  !tx.recurringId && tx.note,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </div>
            {changing ? (
              <div class="muted small">לא נספר</div>
            ) : (
              <div class={`amount ${tx.type}`}>{formatMoney(tx.type === 'expense' ? -tx.amount : tx.amount, { sign: tx.type === 'income' })}</div>
            )}
          </button>
        );
      })}
    </>
  );
}

/** Money lines grouped under their days, newest day first. */
export function MoneyByDay(props: { data: AppData; rows: MoneyRow[]; today: string; onEdit: (tx: Transaction) => void }) {
  const groups = new Map<string, MoneyRow[]>();
  for (const r of props.rows) groups.set(r.date, [...(groups.get(r.date) ?? []), r]);
  return (
    <>
      {[...groups].map(([date, rows]) => (
        <div key={date} class="money-day">
          <div class="day-label">
            {dayLabel(date, props.today)}
          </div>
          <MoneyLines data={props.data} rows={rows} today={props.today} onEdit={props.onEdit} />
        </div>
      ))}
    </>
  );
}

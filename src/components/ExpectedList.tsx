import type { UpcomingItem } from '../data/balance';
import { dayLabel } from '../data/dates';
import { formatMoney } from '../data/money';
import type { AppData } from '../data/store';
import type { Recurring, Transaction } from '../data/types';

/**
 * Rows of expected incomes and expenses: future transactions, recurring items (salary, standing
 * orders) and card charges. Used by the forecast and by the overview's rest-of-month card.
 */
export function ExpectedList(props: {
  data: AppData;
  items: UpcomingItem[];
  today: string;
  onEdit: (tx: Transaction) => void;
  onEditRecurring: (rec: Recurring) => void;
}) {
  const { data, today } = props;
  const name = new Map<string, string>([...data.accounts, ...data.methods, ...data.categories].map(x => [x.id, x.name]));
  const txs = new Map(data.transactions.map(t => [t.id, t]));
  const recs = new Map(data.recurring.map(r => [r.id, r]));

  const describe = (item: UpcomingItem): { title: string; sub: string; tx?: Transaction; rec?: Recurring } => {
    if (item.kind === 'credit') {
      return {
        title: `חיוב ${name.get(item.methodId!) ?? 'אשראי'}`,
        sub: [
          item.purchases === 1 ? 'קנייה או תשלום אחד' : item.purchases > 1 ? `${item.purchases} קניות ותשלומים` : '',
          item.opening ? 'מה שנצבר לפני תחילת המעקב' : '',
        ]
          .filter(Boolean)
          .join(' + '),
      };
    }
    if (item.txId?.startsWith('expected:')) {
      const rec = recs.get(item.txId.split(':')[1])!;
      return { title: rec.name, sub: rec.variable ? 'קבועה · הערכה' : 'קבועה', rec };
    }
    const tx = txs.get(item.txId!)!;
    return {
      title: name.get(tx.categoryId!) ?? '',
      sub: [tx.type === 'income' ? name.get(tx.accountId!) : name.get(tx.methodId!), tx.note].filter(Boolean).join(' · '),
      tx,
    };
  };

  return (
    <>
      {props.items.map(item => {
        const d = describe(item);
        const content = (
          <>
            <div>
              <div>{d.title}</div>
              <div class="muted small">{[dayLabel(item.date, today), d.sub].filter(Boolean).join(' · ')}</div>
            </div>
            <div class={`amount ${item.kind === 'income' ? 'income' : 'expense'}`}>{formatMoney(item.amount, { sign: item.kind === 'income' })}</div>
          </>
        );
        return d.tx || d.rec ? (
          <button key={`${item.date}${item.txId}`} class="tx" onClick={() => (d.tx ? props.onEdit(d.tx) : props.onEditRecurring(d.rec!))}>
            {content}
          </button>
        ) : (
          <div key={`${item.date}${item.methodId}`} class="tx">
            {content}
          </div>
        );
      })}
    </>
  );
}

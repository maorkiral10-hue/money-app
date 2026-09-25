import { summarize, upcomingItems, type UpcomingItem } from '../data/balance';
import { dayLabel, monthName, todayStr } from '../data/dates';
import { formatMoney } from '../data/money';
import type { AppData } from '../data/store';
import type { Transaction } from '../data/types';

export function Forecast(props: { data: AppData; onBack: () => void; onEdit: (tx: Transaction) => void }) {
  const { data } = props;
  const today = todayStr();
  const summary = summarize(data, today);
  const items = upcomingItems(data, today);
  const income = items.filter(i => i.kind === 'income');
  const expenses = items.filter(i => i.kind !== 'income');
  const sum = (list: UpcomingItem[]) => list.reduce((a, i) => a + i.amount, 0);

  const name = new Map<string, string>([...data.accounts, ...data.methods, ...data.categories].map(x => [x.id, x.name]));
  const txs = new Map(data.transactions.map(t => [t.id, t]));

  const describe = (item: UpcomingItem) => {
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
    const tx = txs.get(item.txId!)!;
    return {
      title: name.get(tx.categoryId!) ?? '',
      sub: [tx.type === 'income' ? name.get(tx.accountId!) : name.get(tx.methodId!), tx.note].filter(Boolean).join(' · '),
      tx,
    };
  };

  const List = (p: { title: string; list: UpcomingItem[] }) => (
    <div class="card">
      <div class="line strong-head">
        <h2>{p.title}</h2>
        <span>{formatMoney(sum(p.list), { sign: true })}</span>
      </div>
      {p.list.length === 0 && <p class="muted small">אין</p>}
      {p.list.map(item => {
        const d = describe(item);
        const content = (
          <>
            <div>
              <div>{d.title}</div>
              <div class="muted small">{[dayLabel(item.date, today), d.sub].filter(Boolean).join(' · ')}</div>
            </div>
            <div class={`amount ${item.kind === 'income' ? 'income' : ''}`}>{formatMoney(item.amount, { sign: item.kind === 'income' })}</div>
          </>
        );
        return d.tx ? (
          <button key={`${item.date}${item.txId}`} class="tx" onClick={() => props.onEdit(d.tx!)}>
            {content}
          </button>
        ) : (
          <div key={`${item.date}${item.methodId}`} class="tx">
            {content}
          </div>
        );
      })}
    </div>
  );

  return (
    <>
      <header class="top">
        <h1>צפי לחודש הבא</h1>
        <button class="link" onClick={props.onBack}>
          חזרה
        </button>
      </header>
      <p class="muted small">כל מה שצפוי לרדת ולהיכנס מהיום ועד סוף {monthName(summary.upcoming.until)}.</p>

      <div class="card">
        <div class="line">
          <span>כסף נזיל עכשיו</span>
          <span>{formatMoney(summary.liquid)}</span>
        </div>
      </div>
      <List title="הכנסות צפויות" list={income} />
      <List title="הוצאות צפויות" list={expenses} />
      <div class="card hero">
        <div class="muted small">צפוי להישאר בסוף {monthName(summary.upcoming.until)}</div>
        <div class="big-number">{formatMoney(summary.upcoming.projected)}</div>
      </div>
      <p class="muted small center">משכורת קבועה והוראות קבע יופיעו כאן אוטומטית אחרי שלב 3. עד אז אפשר לרשום אותן כתנועה עם תאריך עתידי.</p>
    </>
  );
}

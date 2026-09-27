import { summarize, upcomingItems, type UpcomingItem } from '../data/balance';
import { ExpectedList } from '../components/ExpectedList';
import { monthName, todayStr } from '../data/dates';
import { formatMoney } from '../data/money';
import type { AppData } from '../data/store';
import type { Recurring, Transaction } from '../data/types';

export function Forecast(props: {
  data: AppData;
  onBack: () => void;
  onEdit: (tx: Transaction) => void;
  onEditRecurring: (rec: Recurring) => void;
  onOpenRecurring: () => void;
}) {
  const { data } = props;
  const today = todayStr();
  const summary = summarize(data, today);
  const items = upcomingItems(data, today);
  const income = items.filter(i => i.kind === 'income');
  const expenses = items.filter(i => i.kind !== 'income');
  const sum = (list: UpcomingItem[]) => list.reduce((a, i) => a + i.amount, 0);

  const List = (p: { title: string; list: UpcomingItem[] }) => (
    <div class="card">
      <div class="line strong-head">
        <h2>{p.title}</h2>
        <span>{formatMoney(sum(p.list), { sign: true })}</span>
      </div>
      {p.list.length === 0 && <p class="muted small">אין</p>}
      <ExpectedList data={data} items={p.list} today={today} onEdit={props.onEdit} onEditRecurring={props.onEditRecurring} />
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
      <button class="secondary" onClick={props.onOpenRecurring}>
        הכנסות והוצאות קבועות ({data.recurring.filter(r => !r.endDate).length})
      </button>
    </>
  );
}

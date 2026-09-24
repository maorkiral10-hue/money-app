import { summarize } from '../data/balance';
import { dayLabel, monthName, todayStr } from '../data/dates';
import { formatMoney } from '../data/money';
import type { AppData } from '../data/store';
import type { Transaction } from '../data/types';

function daysAgo(iso: string) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return days === 0 ? 'היום' : days === 1 ? 'אתמול' : `לפני ${days} ימים`;
}

export function Home(props: {
  data: AppData;
  onAdd: () => void;
  onEdit: (tx: Transaction) => void;
  onOpenSettings: () => void;
  onOpenData: () => void;
}) {
  const { data } = props;
  const today = todayStr();
  const summary = summarize(data, today);
  const { upcoming } = summary;
  const hasUpcoming = upcoming.credit || upcoming.income || upcoming.expenses;

  const name = new Map<string, string>([...data.accounts, ...data.methods, ...data.categories].map(x => [x.id, x.name]));
  const sorted = [...data.transactions].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const groups = new Map<string, Transaction[]>();
  for (const tx of sorted) groups.set(tx.date, [...(groups.get(tx.date) ?? []), tx]);

  return (
    <>
      <header class="top">
        <h1>הכסף שלי</h1>
        <button class="link" onClick={props.onOpenSettings}>
          הגדרות
        </button>
      </header>

      <div class="card hero">
        <div class="muted small">כסף נזיל עכשיו</div>
        <div class="big-number">{formatMoney(summary.liquid)}</div>
        <div class="breakdown">
          {summary.byAccount.map(({ account, balance }) => (
            <span key={account.id}>
              {account.name} {formatMoney(balance)}
            </span>
          ))}
        </div>
        {hasUpcoming ? (
          <div class="upcoming">
            <div class="muted small">צפוי עד סוף {monthName(upcoming.until)}</div>
            {upcoming.credit !== 0 && <Line label="חיובי אשראי" value={upcoming.credit} />}
            {upcoming.income !== 0 && <Line label="הכנסות צפויות" value={upcoming.income} />}
            {upcoming.expenses !== 0 && <Line label="הוצאות צפויות" value={upcoming.expenses} />}
            <Line label="יתרה צפויה" value={upcoming.projected} strong />
          </div>
        ) : null}
      </div>

      <button class="quiet" onClick={props.onOpenData}>
        {data.lastBackupAt ? `גיבוי אחרון: ${daysAgo(data.lastBackupAt)}` : 'עדיין לא בוצע גיבוי'}
      </button>

      {groups.size === 0 && <p class="muted center">עדיין אין תנועות. לחץ על + כדי להוסיף את הראשונה.</p>}
      {[...groups].map(([date, txs]) => (
        <div key={date} class="day">
          <div class="day-label">
            {dayLabel(date, today)}
            {date > today && <span class="tag">צפויה</span>}
            {date < data.startDate && <span class="tag">לפני תחילת המעקב</span>}
          </div>
          <div class="card list">
            {txs.map(tx => (
              <button key={tx.id} class="tx" onClick={() => props.onEdit(tx)}>
                <div>
                  <div>{tx.type === 'transfer' ? `${name.get(tx.accountId!)} ← ${name.get(tx.toAccountId!)}` : name.get(tx.categoryId!)}</div>
                  <div class="muted small">
                    {[
                      tx.type === 'expense' ? name.get(tx.methodId!) : tx.type === 'income' ? name.get(tx.accountId!) : 'העברה',
                      tx.installments && `${tx.installments} תשלומים`,
                      tx.note,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
                <div class={`amount ${tx.type}`}>
                  {formatMoney(tx.type === 'expense' ? -tx.amount : tx.amount, { sign: tx.type === 'income' })}
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}

      <button class="fab" aria-label="תנועה חדשה" onClick={props.onAdd}>
        +
      </button>
    </>
  );
}

function Line(props: { label: string; value: number; strong?: boolean }) {
  return (
    <div class={`line ${props.strong ? 'strong' : ''}`}>
      <span>{props.label}</span>
      <span>{formatMoney(props.value, { sign: !props.strong })}</span>
    </div>
  );
}

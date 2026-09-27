import { useState } from 'preact/hooks';
import { CardLine } from '../components/CardLine';
import { cardUsage, summarize } from '../data/balance';
import { PendingCard } from '../components/PendingCard';
import { SettingsButton } from '../components/SettingsButton';
import { categoryColor } from '../data/colors';
import { dayLabel, todayStr } from '../data/dates';
import { openOccurrences } from '../data/recurring';
import { formatMoney } from '../data/money';
import type { Toast } from '../app';
import type { AppData } from '../data/store';
import type { Transaction } from '../data/types';

function daysAgo(iso: string) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return days === 0 ? 'היום' : days === 1 ? 'אתמול' : `לפני ${days} ימים`;
}

export function Home(props: {
  db: IDBDatabase;
  data: AppData;
  toast: Toast | null;
  onUndo: (txId: string) => void;
  onChange: () => void;
  onEdit: (tx: Transaction) => void;
  onOpenSettings: () => void;
  onOpenData: () => void;
}) {
  const { data } = props;
  const today = todayStr();
  const summary = summarize(data, today);
  const cards = cardUsage(data, today);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const pending = data.recurring
    .filter(r => r.variable)
    .map(rec => ({ rec, open: openOccurrences(rec, today, data.startDate) }))
    .filter(p => p.open.length > 0);

  const name = new Map<string, string>([...data.accounts, ...data.methods, ...data.categories].map(x => [x.id, x.name]));
  const sorted = [...data.transactions].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const groups = new Map<string, Transaction[]>();
  for (const tx of sorted) groups.set(tx.date, [...(groups.get(tx.date) ?? []), tx]);

  return (
    <>
      <header class="top">
        <h1>הכסף שלי</h1>
        <SettingsButton onClick={props.onOpenSettings} />
      </header>

      {props.toast && (
        <div class="card toast">
          <span>✓ {props.toast.text}</span>
          {props.toast.undoId && (
            <button class="link" onClick={() => props.onUndo(props.toast!.undoId!)}>
              ביטול
            </button>
          )}
        </div>
      )}

      <div class="card hero">
        <div class="muted small">כסף נזיל עכשיו</div>
        <div class="big-number">{formatMoney(summary.liquid)}</div>
        {showBreakdown && (
          <div class="upcoming">
            {summary.byAccount.map(({ account, balance }) => (
              <Line key={account.id} label={account.name} value={balance} />
            ))}
            {cards.length > 0 && <div class="muted small section-label">מסגרות אשראי</div>}
            {cards.map(u => (
              <CardLine key={u.card.id} usage={u} today={today} />
            ))}
          </div>
        )}
        <div class="hero-buttons">
          <button class="secondary" onClick={() => setShowBreakdown(!showBreakdown)}>
            {showBreakdown ? 'הסתר פירוט' : 'פירוט'}
          </button>
        </div>
      </div>

      <button class="quiet" onClick={props.onOpenData}>
        {data.lastBackupAt ? `גיבוי אחרון: ${daysAgo(data.lastBackupAt)}` : 'עדיין לא בוצע גיבוי'}
      </button>

      {pending.map(({ rec, open }) => (
        <PendingCard key={`${rec.id}${open[0]}`} db={props.db} data={data} rec={rec} occurrence={open[0]} more={open.length - 1} onDone={props.onChange} />
      ))}

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
                  <div>
                    {tx.type !== 'transfer' && <span class="cat-dot" style={{ background: categoryColor(tx.categoryId, data.categories) }} />}
                    {tx.type === 'transfer' ? `${name.get(tx.accountId!)} ← ${name.get(tx.toAccountId!)}` : name.get(tx.categoryId!)}
                  </div>
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

    </>
  );
}

function Line(props: { label: string; value: number }) {
  return (
    <div class="line">
      <span>{props.label}</span>
      <span>{formatMoney(props.value)}</span>
    </div>
  );
}

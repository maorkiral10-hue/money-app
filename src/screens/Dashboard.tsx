import { useState } from 'preact/hooks';
import { bestAndWorst, monthKey, monthsSince, monthStats, restOfMonth } from '../data/dashboard';
import { dayLabel, todayStr } from '../data/dates';
import { formatMoney } from '../data/money';
import type { AppData } from '../data/store';
import type { Transaction } from '../data/types';

const monthTitle = (key: string, withYear = true) =>
  new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, 1).toLocaleDateString('he-IL', withYear ? { month: 'long', year: 'numeric' } : { month: 'long' });

/** How many months the comparison shows. */
const COMPARE = 6;

export function Dashboard(props: { data: AppData; onEdit: (tx: Transaction) => void }) {
  const { data } = props;
  const today = todayStr();
  const months = monthsSince(data.startDate, today);
  const [key, setKey] = useState(monthKey(today));
  const [openCategory, setOpenCategory] = useState<string | null>(null);

  const index = months.indexOf(key);
  const stats = monthStats(data.transactions, key);
  const isCurrent = key === monthKey(today);
  const rest = isCurrent ? restOfMonth(data, today) : undefined;
  const allStats = months.map(k => monthStats(data.transactions, k));
  const { best, worst } = bestAndWorst(allStats, today);
  const recent = allStats.slice(-COMPARE).reverse();
  const maxNet = Math.max(1, ...recent.map(s => Math.abs(s.net)));
  const maxCat = Math.max(1, ...stats.byCategory.map(c => c.amount));
  const name = (id: string) => data.categories.find(c => c.id === id)?.name ?? 'ללא קטגוריה';

  return (
    <>
      <header class="top">
        <h1>תמונת מצב</h1>
      </header>

      <div class="month-switch">
        <button class="link" disabled={index <= 0} onClick={() => setKey(months[index - 1])} aria-label="חודש קודם">
          ›
        </button>
        <span>{monthTitle(key)}</span>
        <button class="link" disabled={index >= months.length - 1} onClick={() => setKey(months[index + 1])} aria-label="חודש הבא">
          ‹
        </button>
      </div>

      <div class="stat-row">
        <Stat label="הכנסות" value={stats.income} />
        <Stat label="הוצאות" value={-stats.expenses} />
        <Stat label={stats.net >= 0 ? 'נשאר' : 'חסר'} value={stats.net} strong />
      </div>
      {isCurrent && <p class="muted small center">עד היום, לפי תאריך כל תנועה. קנייה באשראי נספרת בחודש שבו קנית.</p>}

      {rest && (
        <div class="card">
          <h2>עד סוף {monthTitle(key, false)}</h2>
          <div class="line">
            <span>עוד צפוי לרדת</span>
            <span>{formatMoney(rest.expectedOut)}</span>
          </div>
          <div class="line">
            <span>עוד צפוי להיכנס</span>
            <span>{formatMoney(rest.expectedIn, { sign: true })}</span>
          </div>
          <div class="line strong">
            <span>יתרה צפויה בסוף החודש</span>
            <span>{formatMoney(rest.projectedEnd)}</span>
          </div>
        </div>
      )}

      <div class="card">
        <h2>על מה הלך הכסף</h2>
        {stats.byCategory.length === 0 && <p class="muted small">אין הוצאות בחודש הזה</p>}
        {stats.byCategory.map(c => (
          <div key={c.categoryId}>
            <button class="bar-row" onClick={() => setOpenCategory(openCategory === c.categoryId ? null : c.categoryId)}>
              <div class="line">
                <span>{name(c.categoryId)}</span>
                <span>
                  {formatMoney(c.amount)} <span class="muted small">· {Math.round((c.amount / stats.expenses) * 100)}%</span>
                </span>
              </div>
              <div class="bar">
                <span style={{ width: `${(c.amount / maxCat) * 100}%` }} />
              </div>
            </button>
            {openCategory === c.categoryId && (
              <div class="bar-detail">
                {data.transactions
                  .filter(t => t.type === 'expense' && monthKey(t.date) === key && (t.categoryId ?? '') === c.categoryId)
                  .sort((a, b) => b.date.localeCompare(a.date))
                  .map(t => (
                    <button key={t.id} class="tx" onClick={() => props.onEdit(t)}>
                      <span class="muted small">{[dayLabel(t.date, today), t.note].filter(Boolean).join(' · ')}</span>
                      <span class="small">{formatMoney(t.amount)}</span>
                    </button>
                  ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div class="card">
        <h2>השוואה בין חודשים</h2>
        {!best && <p class="muted small">ההשוואה תתמלא כשיסתיים החודש הראשון. עד אז אפשר לראות את החודש הנוכחי.</p>}
        {best && (
          <p class="small">
            הכי רווחי: <b>{monthTitle(best.key, false)}</b> ({formatMoney(best.net, { sign: true })})
            {worst && (
              <>
                {' '}· הכי פחות: <b>{monthTitle(worst.key, false)}</b> ({formatMoney(worst.net, { sign: true })})
              </>
            )}
          </p>
        )}
        {recent.map(s => (
          <button key={s.key} class="bar-row" onClick={() => setKey(s.key)}>
            <div class="line">
              <span>
                {monthTitle(s.key, false)}
                {s.key === monthKey(today) && <span class="muted small"> (עד כה)</span>}
              </span>
              <span>{formatMoney(s.net, { sign: true })}</span>
            </div>
            <div class="bar">
              <span class={s.net < 0 ? 'neg' : ''} style={{ width: `${(Math.abs(s.net) / maxNet) * 100}%` }} />
            </div>
          </button>
        ))}
      </div>
    </>
  );
}

function Stat(props: { label: string; value: number; strong?: boolean }) {
  return (
    <div class={`stat ${props.strong ? 'strong' : ''}`}>
      <div class="muted small">{props.label}</div>
      <div class="stat-value">{formatMoney(props.value, { sign: props.strong })}</div>
    </div>
  );
}

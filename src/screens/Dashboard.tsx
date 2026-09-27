import { useState } from 'preact/hooks';
import { CardLine } from '../components/CardLine';
import { ExpectedList } from '../components/ExpectedList';
import { cardUsage, upcomingItems } from '../data/balance';
import { bestAndWorst, monthsSince, monthStats, periodEnd, periodKey, periodStart, restOfMonth } from '../data/dashboard';
import { dayLabel, parseDate, todayStr } from '../data/dates';
import { formatMoney } from '../data/money';
import type { AppData } from '../data/store';
import type { Recurring, Transaction } from '../data/types';

/** How many months the comparison shows. */
const COMPARE = 6;

const shortDate = (date: string) => {
  const { m0, d } = parseDate(date);
  return `${d}.${m0 + 1}`;
};

export function Dashboard(props: { data: AppData; onEdit: (tx: Transaction) => void; onEditRecurring: (rec: Recurring) => void }) {
  const { data } = props;
  const startDay = data.monthStartDay;
  const today = todayStr();
  const months = monthsSince(data.startDate, today, startDay);
  const currentKey = periodKey(today, startDay);
  const [key, setKey] = useState(currentKey);
  const [openCategory, setOpenCategory] = useState<string | null>(null);

  // A calendar month is named ("ספטמבר"); one starting on another day shows its dates ("10.9–9.10")
  const title = (k: string, withYear = true) =>
    startDay === 1
      ? new Date(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1, 1).toLocaleDateString('he-IL', withYear ? { month: 'long', year: 'numeric' } : { month: 'long' })
      : `${shortDate(periodStart(k, startDay))}–${shortDate(periodEnd(k, startDay))}`;

  const index = months.indexOf(key);
  const stats = monthStats(data.transactions, key, startDay);
  const isCurrent = key === currentKey;
  const rest = isCurrent ? restOfMonth(data, today, startDay) : undefined;
  const restItems = rest ? upcomingItems(data, today, rest.end) : [];
  const cards = cardUsage(data, today);
  const cardName = (id: string) => data.methods.find(m => m.id === id)?.name ?? 'אשראי';
  const allStats = months.map(k => monthStats(data.transactions, k, startDay));
  const { best, worst } = bestAndWorst(allStats, today, startDay);
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
        <span>{title(key)}</span>
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
          <h2>עד סוף החודש ({dayLabel(rest.end, today)})</h2>
          {restItems.length === 0 && <p class="muted small">לא צפוי לרדת או להיכנס עוד כלום עד סוף החודש.</p>}
          <ExpectedList data={data} items={restItems} today={today} onEdit={props.onEdit} onEditRecurring={props.onEditRecurring} />
          <div class="totals">
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
            {rest.lateCharges.length > 0 && (
              <>
                {rest.lateCharges.map(c => (
                  <div key={c.methodId} class="line">
                    <span>
                      חיוב {cardName(c.methodId)} ב-{shortDate(c.date)} <span class="muted small">(על קניות החודש)</span>
                    </span>
                    <span>{formatMoney(c.amount)}</span>
                  </div>
                ))}
                <div class="line strong">
                  <span>ואחרי חיובי האשראי</span>
                  <span>{formatMoney(rest.afterCards)}</span>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {cards.length > 0 && (
        <div class="card">
          <h2>כרטיסי אשראי</h2>
          {cards.map(u => (
            <CardLine key={u.card.id} usage={u} today={today} />
          ))}
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
                  .filter(
                    t =>
                      t.type === 'expense' &&
                      t.date >= periodStart(key, startDay) &&
                      t.date <= periodEnd(key, startDay) &&
                      (t.categoryId ?? '') === c.categoryId,
                  )
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
            הכי רווחי: <b>{title(best.key, false)}</b> ({formatMoney(best.net, { sign: true })})
            {worst && (
              <>
                {' '}· הכי פחות: <b>{title(worst.key, false)}</b> ({formatMoney(worst.net, { sign: true })})
              </>
            )}
          </p>
        )}
        {recent.map(s => (
          <button key={s.key} class="bar-row" onClick={() => setKey(s.key)}>
            <div class="line">
              <span>
                {title(s.key, false)}
                {s.key === currentKey && <span class="muted small"> (עד כה)</span>}
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

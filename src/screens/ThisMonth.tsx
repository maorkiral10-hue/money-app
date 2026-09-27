import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { CardLine } from '../components/CardLine';
import { ExpectedList } from '../components/ExpectedList';
import { cardUsage, upcomingItems } from '../data/balance';
import { monthsSince, monthStats, periodEnd, periodKey, periodStart, restOfMonth } from '../data/dashboard';
import { dayLabel, parseDate, todayStr } from '../data/dates';
import { formatMoney } from '../data/money';
import type { AppData } from '../data/store';
import type { Recurring, Transaction } from '../data/types';

const shortDate = (date: string) => {
  const { m0, d } = parseDate(date);
  return `${d}.${m0 + 1}`;
};

/** A financial month's name: "ספטמבר 2026", or its dates when it doesn't start on the 1st ("10.9–9.10"). */
export function periodTitle(key: string, startDay: number, withYear = true) {
  return startDay === 1
    ? new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, 1).toLocaleDateString('he-IL', withYear ? { month: 'long', year: 'numeric' } : { month: 'long' })
    : `${shortDate(periodStart(key, startDay))}–${shortDate(periodEnd(key, startDay))}`;
}

/** "What's happening this month": short headings with the number that matters; tap one for the details. */
export function ThisMonth(props: { data: AppData; onEdit: (tx: Transaction) => void; onEditRecurring: (rec: Recurring) => void }) {
  const { data } = props;
  const startDay = data.monthStartDay;
  const today = todayStr();
  const months = monthsSince(data.startDate, today, startDay);
  const currentKey = periodKey(today, startDay);
  const [key, setKey] = useState(currentKey);
  const [openCategory, setOpenCategory] = useState<string | null>(null);

  const index = months.indexOf(key);
  const stats = monthStats(data.transactions, key, startDay);
  const isCurrent = key === currentKey;
  const rest = isCurrent ? restOfMonth(data, today, startDay) : undefined;
  const restItems = rest ? upcomingItems(data, today, rest.end) : [];
  const cards = cardUsage(data, today);
  const cardName = (id: string) => data.methods.find(m => m.id === id)?.name ?? 'אשראי';
  const maxCat = Math.max(1, ...stats.byCategory.map(c => c.amount));
  const name = (id: string) => data.categories.find(c => c.id === id)?.name ?? 'ללא קטגוריה';
  const free = cards.filter(c => c.available !== undefined).reduce((a, c) => a + c.available!, 0);

  return (
    <>
      <header class="top">
        <h1>החודש</h1>
      </header>

      <div class="month-switch">
        <button class="link" disabled={index <= 0} onClick={() => setKey(months[index - 1])} aria-label="חודש קודם">
          ›
        </button>
        <span>{periodTitle(key, startDay)}</span>
        <button class="link" disabled={index >= months.length - 1} onClick={() => setKey(months[index + 1])} aria-label="חודש הבא">
          ‹
        </button>
      </div>

      <div class="stat-row">
        <Stat label="הכנסות" value={stats.income} />
        <Stat label="הוצאות" value={-stats.expenses} />
        <Stat label={stats.net >= 0 ? 'נשאר' : 'חסר'} value={stats.net} strong />
      </div>

      {rest && (
        <Section
          title="עד סוף החודש"
          sub={rest.lateCharges.length ? 'אחרי חיובי האשראי' : `יתרה צפויה ב-${shortDate(rest.end)}`}
          value={formatMoney(rest.lateCharges.length ? rest.afterCards : rest.projectedEnd)}
        >
          {restItems.length === 0 && <p class="muted small">לא צפוי לרדת או להיכנס עוד כלום עד סוף החודש.</p>}
          <ExpectedList data={data} items={restItems} today={today} onEdit={props.onEdit} onEditRecurring={props.onEditRecurring} />
          <div class="totals">
            <Line label="עוד צפוי לרדת" value={formatMoney(rest.expectedOut)} />
            <Line label="עוד צפוי להיכנס" value={formatMoney(rest.expectedIn, { sign: true })} />
            <Line label={`יתרה צפויה ב-${shortDate(rest.end)}`} value={formatMoney(rest.projectedEnd)} strong />
            {rest.lateCharges.map(c => (
              <Line key={c.methodId} label={`חיוב ${cardName(c.methodId)} ב-${shortDate(c.date)}`} value={formatMoney(c.amount)} />
            ))}
            {rest.lateCharges.length > 0 && <Line label="אחרי חיובי האשראי" value={formatMoney(rest.afterCards)} strong />}
          </div>
        </Section>
      )}

      {cards.length > 0 && (
        <Section title="כרטיסי אשראי" sub={cards.some(c => c.available !== undefined) ? 'פנוי במסגרות' : 'נוצל'} value={formatMoney(cards.some(c => c.available !== undefined) ? free : cards.reduce((a, c) => a + c.used, 0))}>
          {cards.map(u => (
            <CardLine key={u.card.id} usage={u} today={today} />
          ))}
        </Section>
      )}

      <Section title="על מה הלך הכסף" sub={stats.byCategory[0] ? `הכי הרבה: ${name(stats.byCategory[0].categoryId)}` : 'אין הוצאות'} value={formatMoney(stats.expenses)}>
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
      </Section>
    </>
  );
}

/** A card showing only its title and main number until tapped. */
function Section(props: { title: string; sub: string; value: string; children: ComponentChildren }) {
  const [open, setOpen] = useState(false);
  return (
    <div class="card section">
      <button class="section-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span>
          <span class="section-title">{props.title}</span>
          <span class="muted small block">{props.sub}</span>
        </span>
        <span class="section-value">
          {props.value} <span class={`chevron ${open ? 'open' : ''}`}>‹</span>
        </span>
      </button>
      {open && <div class="section-body">{props.children}</div>}
    </div>
  );
}

function Line(props: { label: string; value: string; strong?: boolean }) {
  return (
    <div class={`line ${props.strong ? 'strong' : ''}`}>
      <span>{props.label}</span>
      <span>{props.value}</span>
    </div>
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

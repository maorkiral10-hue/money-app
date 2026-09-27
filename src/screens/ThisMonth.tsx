import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { CardLine } from '../components/CardLine';
import { ExpectedGroups } from '../components/ExpectedGroups';
import { cardUsage, upcomingItems } from '../data/balance';
import { categoryColor } from '../data/colors';
import { addMonths, expectedExpenses, monthsSince, monthStats, periodEnd, periodKey, periodStart, restOfMonth } from '../data/dashboard';
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
export function ThisMonth(props: {
  data: AppData;
  onEdit: (tx: Transaction) => void;
  onEditRecurring: (rec: Recurring) => void;
}) {
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
  // The card bills just after the month (e.g. on the 2nd) pay for this month's purchases, so they're listed here too
  const lateEnd = rest?.lateCharges.at(-1)?.date ?? rest?.end ?? today;
  const restItems = rest
    ? upcomingItems(data, today, lateEnd).filter(
        i => i.date <= rest.end || (i.kind === 'credit' && rest.lateCharges.some(c => c.methodId === i.methodId && c.date === i.date)),
      )
    : [];
  const next = rest
    ? (() => {
        const end = periodEnd(addMonths(currentKey, 1), startDay);
        const items = upcomingItems(data, today, end).filter(i => i.date > rest.end);
        return { end, items, projected: rest.projectedEnd + items.reduce((a, i) => a + i.amount, 0) };
      })()
    : undefined;
  const cards = cardUsage(data, today);
  // This month's spending by category includes the standing orders still to come before it ends
  const expected = isCurrent ? expectedExpenses(data, today, periodEnd(key, startDay)) : [];
  const expectedTotal = expected.reduce((a, t) => a + t.amount, 0);
  const spendingMap = new Map(stats.byCategory.map(c => [c.categoryId, { categoryId: c.categoryId, spent: c.amount, expected: 0 }]));
  for (const t of expected) {
    const id = t.categoryId ?? '';
    const row = spendingMap.get(id) ?? { categoryId: id, spent: 0, expected: 0 };
    row.expected += t.amount;
    spendingMap.set(id, row);
  }
  const spending = [...spendingMap.values()].sort((a, b) => b.spent + b.expected - (a.spent + a.expected));
  const maxCat = Math.max(1, ...spending.map(c => c.spent + c.expected));
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
        <Stat label="הכנסות" value={stats.income} tone="inc" />
        <Stat label="הוצאות" value={-stats.expenses} tone="exp" />
        <Stat label={stats.net >= 0 ? 'נשאר' : 'חסר'} value={stats.net} tone={stats.net >= 0 ? 'inc' : 'exp'} strong />
      </div>

      {rest && (
        <Section
          title="עד סוף החודש"
          sub={rest.lateCharges.length ? 'אחרי חיובי האשראי' : `יתרה צפויה ב-${shortDate(rest.end)}`}
          value={formatMoney(rest.lateCharges.length ? rest.afterCards : rest.projectedEnd)}
        >
          <ExpectedGroups data={data} items={restItems} today={today} onEdit={props.onEdit} onEditRecurring={props.onEditRecurring} />
          <div class="totals">
            <Line label={`יתרה צפויה ב-${shortDate(rest.end)}`} value={formatMoney(rest.projectedEnd)} strong />
            {rest.lateCharges.length > 0 && <Line label="אחרי חיובי האשראי" value={formatMoney(rest.afterCards)} strong />}
          </div>
        </Section>
      )}

      {next && (
        <Section title="החודש הבא" sub={`יתרה צפויה ב-${shortDate(next.end)}`} value={formatMoney(next.projected)}>
          <ExpectedGroups data={data} items={next.items} today={today} onEdit={props.onEdit} onEditRecurring={props.onEditRecurring} />
        </Section>
      )}

      {cards.length > 0 && (
        <Section title="כרטיסי אשראי" sub={cards.some(c => c.available !== undefined) ? 'פנוי במסגרות' : 'נוצל'} value={formatMoney(cards.some(c => c.available !== undefined) ? free : cards.reduce((a, c) => a + c.used, 0))}>
          {cards.map(u => (
            <CardLine key={u.card.id} usage={u} today={today} />
          ))}
        </Section>
      )}

      <Section
        title="על מה הולך הכסף"
        sub={spending[0] ? `הכי הרבה: ${name(spending[0].categoryId)}${expectedTotal ? ' · כולל קבועות שעוד ירדו' : ''}` : 'אין הוצאות'}
        value={formatMoney(-(stats.expenses + expectedTotal))}
        tone="exp"
      >
        {spending.map(c => (
          <div key={c.categoryId}>
            <button class="bar-row" onClick={() => setOpenCategory(openCategory === c.categoryId ? null : c.categoryId)}>
              <div class="line">
                <span>
                  <span class="cat-dot" style={{ background: categoryColor(c.categoryId, data.categories) }} />
                  {name(c.categoryId)}
                </span>
                <span>
                  {formatMoney(c.spent + c.expected)}
                  {c.expected > 0 && <span class="muted small"> (מתוכם {formatMoney(c.expected)} צפוי)</span>}
                </span>
              </div>
              {/* solid: already spent · light: standing orders still to come this month */}
              <div class="bar split">
                <span style={{ width: `${(c.spent / maxCat) * 100}%`, background: categoryColor(c.categoryId, data.categories) }} />
                <span class="expected" style={{ width: `${(c.expected / maxCat) * 100}%`, background: categoryColor(c.categoryId, data.categories) }} />
              </div>
            </button>
            {openCategory === c.categoryId && (
              <div class="bar-detail">
                {expected
                  .filter(t => (t.categoryId ?? '') === c.categoryId)
                  .map(t => (
                    <div key={t.id} class="tx">
                      <span class="muted small">
                        {[dayLabel(t.date, today), t.note].filter(Boolean).join(' · ')} <span class="tag">צפוי</span>
                      </span>
                      <span class="small exp">{formatMoney(-t.amount)}</span>
                    </div>
                  ))}
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
                      <span class="small exp">{formatMoney(-t.amount)}</span>
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
function Section(props: { title: string; sub: string; value: string; tone?: 'inc' | 'exp'; children: ComponentChildren }) {
  const [open, setOpen] = useState(false);
  return (
    <div class="card section">
      <button class="section-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span>
          <span class="section-title">{props.title}</span>
          <span class="muted small block">{props.sub}</span>
        </span>
        <span class={`section-value ${props.tone ?? ''}`}>
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

function Stat(props: { label: string; value: number; strong?: boolean; tone: 'inc' | 'exp' }) {
  return (
    <div class={`stat ${props.strong ? 'strong' : ''}`}>
      <div class={`small ${props.tone}`}>{props.label}</div>
      <div class={`stat-value ${props.tone}`}>{formatMoney(props.value, { sign: props.strong })}</div>
    </div>
  );
}

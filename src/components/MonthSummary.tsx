import { useState } from 'preact/hooks';
import { AnimatedMoney } from './AnimatedMoney';
import { CardLine } from './CardLine';
import { cardStatements, cardUsage } from '../data/balance';
import { statsTransactions } from '../data/budget';
import { categoryColor } from '../data/colors';
import { monthsSince, monthStats, periodEnd, periodKey, periodStart } from '../data/dashboard';
import { dayLabel, parseDate, todayStr } from '../data/dates';
import { formatMoney } from '../data/money';
import { expectedTransactions } from '../data/recurring';
import type { AppData } from '../data/store';
import type { Transaction } from '../data/types';

// The rest-of-month and next-month forecasts were taken off this screen (28.9.2026) until they come
// back in a clearer form; components/ExpectedGroups.tsx and data/dashboard.ts restOfMonth() keep the logic.

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

type Open = 'income' | 'expenses' | null;

/** Share of a total, "<1%" rather than a misleading 0% for a small real amount. */
const pct = (part: number, total: number) => {
  const p = total > 0 ? (part / total) * 100 : 0;
  return p > 0 && p < 1 ? '<1%' : `${Math.round(p)}%`;
};

/**
 * The month on the home screen, under the big number: income and spending (tap either for its breakdown)
 * and the credit cards together. There's no "left over" figure: income and spending land in different
 * months (salary, card bills), so their difference didn't mean much.
 */
export function MonthSummary(props: {
  data: AppData;
  onEdit: (tx: Transaction) => void;
  /** The financial month to show, set from outside (the home screen's calendar); then there are no arrows of its own. */
  monthKey?: string;
  /**
   * The day the cards' usage is shown for (the day chosen in the calendar): purchases recorded up to it
   * that the bank hasn't paid for by then. After a charge day, what that charge paid for is free again.
   */
  asOf?: string;
}) {
  const { data } = props;
  const startDay = data.monthStartDay;
  const today = todayStr();
  const months = monthsSince(data.startDate, today, startDay);
  const currentKey = periodKey(today, startDay);
  const [ownKey, setKey] = useState(currentKey);
  const key = props.monthKey ?? ownKey;
  const [open, setOpen] = useState<Open>(null);
  const [openCategory, setOpenCategory] = useState<string | null>(null);
  const [cardsOpen, setCardsOpen] = useState(false);

  const index = months.indexOf(key);
  const start = periodStart(key, startDay);
  const end = periodEnd(key, startDay);
  const txs = statsTransactions(data);
  const stats = monthStats(txs, key, startDay);
  const isCurrent = key === currentKey;
  const name = (id: string) => data.categories.find(c => c.id === id)?.name ?? 'ללא קטגוריה';

  // Standing orders and fixed income: the ones recorded this month, and the ones still to come in it. They
  // happen for sure (recorded automatically on their day), so they count in the month's totals already.
  const savingsId = data.budget?.savingsMode === 'separate' ? data.budget.savingsCategoryId : undefined;
  const coming = end > today ? expectedTransactions(data.recurring, data.transactions, today, end, data.startDate).filter(t => t.date >= start) : [];
  const fixedOf = (type: 'income' | 'expense') =>
    [
      ...txs.filter(t => t.type === type && t.recurringId && t.date >= start && t.date <= end),
      ...coming.filter(t => t.type === type && !(type === 'expense' && t.categoryId === savingsId)),
    ].sort((a, b) => a.date.localeCompare(b.date));
  const fixedSpend = fixedOf('expense');
  const fixedIncome = fixedOf('income');
  const sum = (list: Transaction[]) => list.reduce((a, t) => a + t.amount, 0);
  const comingSpend = sum(coming.filter(t => t.type === 'expense' && t.categoryId !== savingsId));
  const comingIncome = sum(coming.filter(t => t.type === 'income'));
  const spendTotal = stats.expenses + comingSpend;
  const incomeTotal = stats.income + comingIncome;

  // Everything else, by category
  const oneOff = (type: 'income' | 'expense') => {
    const sums = new Map<string, number>();
    for (const t of txs) if (t.type === type && !t.recurringId && t.date >= start && t.date <= end) sums.set(t.categoryId ?? '', (sums.get(t.categoryId ?? '') ?? 0) + t.amount);
    return [...sums].map(([categoryId, amount]) => ({ categoryId, amount })).sort((a, b) => b.amount - a.amount);
  };
  const spendingRows = oneOff('expense');
  const incomeRows = oneOff('income');
  const maxSpend = Math.max(1, sum(fixedSpend), ...spendingRows.map(c => c.amount));
  const maxIncome = Math.max(1, sum(fixedIncome), ...incomeRows.map(r => r.amount));

  const inMonth = (t: Transaction, type: 'income' | 'expense', categoryId: string) =>
    t.type === type && !t.recurringId && t.date >= start && t.date <= end && (t.categoryId ?? '') === categoryId;

  /** The fixed ones as one row at the top of the panel, opening to each with its category. */
  const FixedGroup = (p: { type: 'income' | 'expense'; list: Transaction[]; total: number }) => {
    if (!p.list.length) return null;
    const total = sum(p.list);
    const income = p.type === 'income';
    const id = `fixed-${p.type}`;
    return (
      <div>
        <button class="bar-row" onClick={() => setOpenCategory(openCategory === id ? null : id)} aria-expanded={openCategory === id}>
          <div class="line">
            <span class="fixed-title">{income ? 'הכנסות קבועות' : 'הוצאות קבועות'}</span>
            <span class={income ? 'inc' : 'exp'}>
              {formatMoney(income ? total : -total, { sign: income })} <span class="muted small">· {pct(total, p.total)}</span>
            </span>
          </div>
          <div class="bar">
            <span class="fixed-bar" style={{ width: `${(total / (income ? maxIncome : maxSpend)) * 100}%` }} />
          </div>
        </button>
        {openCategory === id && (
          <div class="bar-detail">
            {p.list.map(t => {
              const upcoming = t.id.startsWith('expected:');
              const Line = upcoming ? 'div' : 'button';
              return (
                <Line key={t.id} class="tx" onClick={upcoming ? undefined : () => props.onEdit(t)}>
                  <div>
                    <div>{t.note}</div>
                    <div class="muted small">
                      <span class="cat-dot" style={{ background: categoryColor(t.categoryId, data.categories) }} />
                      {[name(t.categoryId ?? ''), upcoming ? `${income ? 'ייכנס' : 'יירד'} ב־${shortDate(t.date)}` : dayLabel(t.date, today)].join(' · ')}
                    </div>
                  </div>
                  <span class={`small ${income ? 'inc' : 'exp'}`}>{formatMoney(income ? t.amount : -t.amount, { sign: income })}</span>
                </Line>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  // Credit cards together: how much of all the limits is used
  const asOf = props.asOf ?? today;
  const cards = cardUsage(data, asOf, today);
  const used = cards.reduce((a, c) => a + c.used, 0);
  const limits = cards.reduce((a, c) => a + (c.card.creditLimit ?? 0), 0);
  const withLimit = cards.filter(c => c.card.creditLimit);
  const usedOfLimited = withLimit.reduce((a, c) => a + c.used, 0);

  const toggle = (o: Open) => {
    setOpen(open === o ? null : o);
    setOpenCategory(null);
  };

  return (
    <>
      {props.monthKey ? (
        <div class="month-switch single">
          <span>{periodTitle(key, startDay)}</span>
        </div>
      ) : (
      <div class="month-switch">
        <button class="link" disabled={index <= 0} onClick={() => setKey(months[index - 1])} aria-label="חודש קודם">
          ›
        </button>
        <span>{periodTitle(key, startDay)}</span>
        <button class="link" disabled={index >= months.length - 1} onClick={() => setKey(months[index + 1])} aria-label="חודש הבא">
          ‹
        </button>
      </div>
      )}

      <div class="stat-row two">
        <button class={`stat tappable ${open === 'income' ? 'on inc-bg' : ''}`} onClick={() => toggle('income')} aria-expanded={open === 'income'}>
          <div class="small inc">הכנסות</div>
          <div class="stat-value inc">
            <AnimatedMoney value={incomeTotal} />
          </div>
        </button>
        <button class={`stat tappable ${open === 'expenses' ? 'on exp-bg' : ''}`} onClick={() => toggle('expenses')} aria-expanded={open === 'expenses'}>
          <div class="small exp">הוצאות</div>
          <div class="stat-value exp">
            <AnimatedMoney value={-spendTotal} />
          </div>
        </button>
      </div>
      {!open && <p class="muted small center">לחץ על הכנסות או הוצאות לפירוט</p>}

      {open === 'expenses' && (
        <div class="card breakdown-panel exp-panel">
          {spendingRows.length === 0 && fixedSpend.length === 0 && <p class="muted small">אין הוצאות בחודש הזה</p>}
          <FixedGroup type="expense" list={fixedSpend} total={spendTotal} />
          {spendingRows.map(c => (
            <div key={c.categoryId}>
              <button class="bar-row" onClick={() => setOpenCategory(openCategory === c.categoryId ? null : c.categoryId)}>
                <div class="line">
                  <span>
                    <span class="cat-dot" style={{ background: categoryColor(c.categoryId, data.categories) }} />
                    {name(c.categoryId)}
                  </span>
                  <span class="exp">
                    {formatMoney(-c.amount)} <span class="muted small">· {pct(c.amount, spendTotal)}</span>
                  </span>
                </div>
                <div class="bar">
                  <span style={{ width: `${(c.amount / maxSpend) * 100}%`, background: categoryColor(c.categoryId, data.categories) }} />
                </div>
              </button>
              {openCategory === c.categoryId && (
                <div class="bar-detail">
                  {data.transactions
                    .filter(t => inMonth(t, 'expense', c.categoryId))
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
        </div>
      )}

      {open === 'income' && (
        <div class="card breakdown-panel inc-panel">
          {incomeRows.length === 0 && fixedIncome.length === 0 && <p class="muted small">אין הכנסות בחודש הזה</p>}
          <FixedGroup type="income" list={fixedIncome} total={incomeTotal} />
          {incomeRows.map(r => (
            <div key={r.categoryId}>
              <button class="bar-row" onClick={() => setOpenCategory(openCategory === r.categoryId ? null : r.categoryId)}>
                <div class="line">
                  <span>
                    <span class="cat-dot" style={{ background: categoryColor(r.categoryId, data.categories) }} />
                    {name(r.categoryId)}
                  </span>
                  <span class="inc">
                    {formatMoney(r.amount, { sign: true })} <span class="muted small">· {pct(r.amount, incomeTotal)}</span>
                  </span>
                </div>
                <div class="bar">
                  <span style={{ width: `${(r.amount / maxIncome) * 100}%`, background: categoryColor(r.categoryId, data.categories) }} />
                </div>
              </button>
              {openCategory === r.categoryId && (
                <div class="bar-detail">
                  {data.transactions
                    .filter(t => inMonth(t, 'income', r.categoryId))
                    .sort((a, b) => b.date.localeCompare(a.date))
                    .map(t => (
                      <button key={t.id} class="tx" onClick={() => props.onEdit(t)}>
                        <span class="muted small">{[dayLabel(t.date, today), t.note].filter(Boolean).join(' · ')}</span>
                        <span class="small inc">{formatMoney(t.amount, { sign: true })}</span>
                      </button>
                    ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {cards.length > 0 && (
        <div class="card section">
          <button class="section-head cards-head" onClick={() => setCardsOpen(!cardsOpen)} aria-expanded={cardsOpen}>
            <span class="cards-head-text">
              <span class="section-title">כרטיסי אשראי</span>
              <span class="cards-used exp">
                <AnimatedMoney value={used} />
                <span class="muted small"> נוצל</span>
              </span>
              {limits > 0 && (
                <>
                  <span class={`bar meter ${usedOfLimited / limits >= 0.9 ? 'high' : ''}`}>
                    <span style={{ width: `${Math.min(1, usedOfLimited / limits) * 100}%` }} />
                  </span>
                  <span class="muted small block">
                    סך המסגרות {formatMoney(limits)} · נותר לניצול {formatMoney(Math.max(0, limits - usedOfLimited))}
                  </span>
                </>
              )}
              {limits === 0 && <span class="muted small block">לא הוגדרו מסגרות. אפשר להוסיף בהגדרות</span>}
              {asOf !== today && <span class="muted small block">נכון ל{dayLabel(asOf, today)} (לפי הקניות שנרשמו עד אז)</span>}
            </span>
            <span class={`chevron ${cardsOpen ? 'open' : ''}`}>‹</span>
          </button>
          {cardsOpen && (
            <div class="section-body">
              {cards.map(u => (
                <CardLine key={u.card.id} usage={u} today={today} asOf={asOf} statements={cardStatements(data, u.card.id)} data={data} onEdit={props.onEdit} />
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

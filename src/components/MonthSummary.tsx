import { useState } from 'preact/hooks';
import { AnimatedMoney } from './AnimatedMoney';
import { CardLine } from './CardLine';
import { cardStatements, cardUsage } from '../data/balance';
import { statsTransactions } from '../data/budget';
import { categoryColor } from '../data/colors';
import { expectedExpenses, monthsSince, monthStats, periodEnd, periodKey, periodStart } from '../data/dashboard';
import { dayLabel, parseDate, todayStr } from '../data/dates';
import { formatMoney } from '../data/money';
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

  // Spending by category, with the standing orders still due this month as a lighter "expected" part
  const savingsId = data.budget?.savingsMode === 'separate' ? data.budget.savingsCategoryId : undefined;
  const expected = isCurrent ? expectedExpenses(data, today, end).filter(t => t.categoryId !== savingsId) : [];
  const expectedTotal = expected.reduce((a, t) => a + t.amount, 0);
  const spending = new Map(stats.byCategory.map(c => [c.categoryId, { categoryId: c.categoryId, spent: c.amount, expected: 0 }]));
  for (const t of expected) {
    const row = spending.get(t.categoryId ?? '') ?? { categoryId: t.categoryId ?? '', spent: 0, expected: 0 };
    row.expected += t.amount;
    spending.set(row.categoryId, row);
  }
  const spendingRows = [...spending.values()].sort((a, b) => b.spent + b.expected - (a.spent + a.expected));
  const maxSpend = Math.max(1, ...spendingRows.map(c => c.spent + c.expected));
  const spendTotal = stats.expenses + expectedTotal;

  const incomeRows = (() => {
    const sums = new Map<string, number>();
    for (const t of txs) if (t.type === 'income' && t.date >= start && t.date <= end) sums.set(t.categoryId ?? '', (sums.get(t.categoryId ?? '') ?? 0) + t.amount);
    return [...sums].map(([categoryId, amount]) => ({ categoryId, amount })).sort((a, b) => b.amount - a.amount);
  })();
  const maxIncome = Math.max(1, ...incomeRows.map(r => r.amount));

  const inMonth = (t: Transaction, type: 'income' | 'expense', categoryId: string) =>
    t.type === type && t.date >= start && t.date <= end && (t.categoryId ?? '') === categoryId;

  // Credit cards together: how much of all the limits is used
  const cards = cardUsage(data, today);
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
            <AnimatedMoney value={stats.income} />
          </div>
        </button>
        <button class={`stat tappable ${open === 'expenses' ? 'on exp-bg' : ''}`} onClick={() => toggle('expenses')} aria-expanded={open === 'expenses'}>
          <div class="small exp">הוצאות</div>
          <div class="stat-value exp">
            <AnimatedMoney value={-stats.expenses} />
          </div>
        </button>
      </div>
      {!open && <p class="muted small center">לחץ על הכנסות או הוצאות לפירוט</p>}

      {open === 'expenses' && (
        <div class="card breakdown-panel exp-panel">
          {spendingRows.length === 0 && <p class="muted small">אין הוצאות בחודש הזה</p>}
          {spendingRows.map(c => (
            <div key={c.categoryId}>
              <button class="bar-row" onClick={() => setOpenCategory(openCategory === c.categoryId ? null : c.categoryId)}>
                <div class="line">
                  <span>
                    <span class="cat-dot" style={{ background: categoryColor(c.categoryId, data.categories) }} />
                    {name(c.categoryId)}
                  </span>
                  <span class="exp">
                    {c.spent > 0 && formatMoney(-c.spent)}
                    {c.expected > 0 && <span class="muted small"> {c.spent > 0 ? '+' : ''}{formatMoney(c.expected)} צפוי</span>}
                    <span class="muted small"> · {pct(c.spent + c.expected, spendTotal)}</span>
                  </span>
                </div>
                <div class="bar split">
                  <span style={{ width: `${(c.spent / maxSpend) * 100}%`, background: categoryColor(c.categoryId, data.categories) }} />
                  <span class="expected" style={{ width: `${(c.expected / maxSpend) * 100}%`, background: categoryColor(c.categoryId, data.categories) }} />
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
          {expectedTotal > 0 && <p class="muted small">ועוד {formatMoney(expectedTotal)} הוראות קבע שיירדו עד סוף החודש (בחלק הבהיר).</p>}
        </div>
      )}

      {open === 'income' && (
        <div class="card breakdown-panel inc-panel">
          {incomeRows.length === 0 && <p class="muted small">אין הכנסות בחודש הזה</p>}
          {incomeRows.map(r => (
            <div key={r.categoryId}>
              <button class="bar-row" onClick={() => setOpenCategory(openCategory === r.categoryId ? null : r.categoryId)}>
                <div class="line">
                  <span>
                    <span class="cat-dot" style={{ background: categoryColor(r.categoryId, data.categories) }} />
                    {name(r.categoryId)}
                  </span>
                  <span class="inc">
                    {formatMoney(r.amount, { sign: true })} <span class="muted small">· {pct(r.amount, stats.income)}</span>
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
            </span>
            <span class={`chevron ${cardsOpen ? 'open' : ''}`}>‹</span>
          </button>
          {cardsOpen && (
            <div class="section-body">
              {cards.map(u => (
                <CardLine key={u.card.id} usage={u} today={today} statements={cardStatements(data, u.card.id)} data={data} onEdit={props.onEdit} />
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { AnimatedMoney } from '../components/AnimatedMoney';
import { Segmented } from '../components/inputs';
import { Donut, IncomeExpenseBars, NetBars, OTHER_COLOR, SERIES, StackBar } from '../components/charts';
import { statsTransactions } from '../data/budget';
import { categoryColor } from '../data/colors';
import {
  biggestExpenses,
  byMethodKind,
  byYear,
  categoryShares,
  categoryVsAverage,
  OTHER,
  rangeKeys,
  totals,
  type Range,
} from '../data/analytics';
import { bestAndWorst, monthsSince, monthStats, periodKey, periodStart } from '../data/dashboard';
import { dayLabel, parseDate, todayStr } from '../data/dates';
import { formatMoney } from '../data/money';
import type { AppData } from '../data/store';
import type { MethodKind, Transaction } from '../data/types';

const KIND_NAMES: Record<MethodKind, string> = { credit: 'אשראי', cash: 'מזומן', bank: 'בנק והוראות קבע', app: 'אפליקציות תשלום', other: 'אחר' };

/** Charts and comparisons: where the money goes, month against month, year against year. */
export function Dashboard(props: { data: AppData; onEdit: (tx: Transaction) => void }) {
  const { data } = props;
  const startDay = data.monthStartDay;
  const today = todayStr();
  const [range, setRange] = useState<Range>(6);
  const [showTable, setShowTable] = useState(false);

  // With savings kept apart (budget questionnaire), money put into savings isn't spending here
  const txs = statsTransactions(data);
  const keys = rangeKeys(range, data.startDate, today, startDay);
  const months = keys.map(k => monthStats(txs, k, startDay));
  const sum = totals(months);
  const currentKey = periodKey(today, startDay);
  const shortLabel = (k: string) => {
    if (startDay !== 1) {
      const { m0, d } = parseDate(periodStart(k, startDay));
      return `${d}.${m0 + 1}`;
    }
    return new Date(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1, 1).toLocaleDateString('he-IL', { month: 'short' });
  };
  const catName = (id: string) => (id === OTHER ? 'אחר' : (data.categories.find(c => c.id === id)?.name ?? 'ללא קטגוריה'));

  const shares = categoryShares(txs, keys, startDay);
  const incomeShares = categoryShares(txs, keys, startDay, 7, 'income');
  const slicesOf = (sh: typeof shares) =>
    sh.slices.map(s => ({
      label: catName(s.categoryId),
      amount: s.amount,
      color: s.categoryId === OTHER ? OTHER_COLOR : categoryColor(s.categoryId, data.categories),
    }));
  const { best, worst } = bestAndWorst(months, today, startDay);
  const allKeys = monthsSince(data.startDate, today, startDay);
  const previous = allKeys.filter(k => k < currentKey).slice(-6);
  const vsAverage = categoryVsAverage(txs, currentKey, previous, startDay).filter(r => r.current || r.average);
  const paid = byMethodKind(txs, data.methods, keys, startDay);
  const biggest = biggestExpenses(txs, keys, startDay);
  const years = byYear(txs.filter(t => t.date >= data.startDate));

  return (
    <>
      <header class="top">
        <h1>דשבורד</h1>
      </header>

      <Segmented
        value={String(range) as '1' | '3' | '6' | '12' | 'all'}
        onChange={v => setRange(v === 'all' ? 'all' : (Number(v) as Range))}
        options={[
          ['1', 'החודש'],
          ['3', '3 ח׳'],
          ['6', '6 ח׳'],
          ['12', 'שנה'],
          ['all', 'הכול'],
        ]}
      />
      {keys.length < (range === 'all' ? 0 : range) && (
        <p class="muted small center">יש נתונים מ-{data.startDate.split('-').slice(1).reverse().map(Number).join('.')} בלבד, אז מוצגים {keys.length === 1 ? 'חודש אחד' : `${keys.length} חודשים`}.</p>
      )}

      <div class="stat-row four">
        <Stat label="הכנסות" value={<AnimatedMoney value={sum.income} />} tone="inc" />
        <Stat label="הוצאות" value={<AnimatedMoney value={-sum.expenses} />} tone="exp" />
        <Stat label={sum.net >= 0 ? 'נשאר' : 'חסר'} value={<AnimatedMoney value={sum.net} sign />} tone={sum.net >= 0 ? 'inc' : 'exp'} />
        <Stat
          label="חיסכון מההכנסה"
          value={sum.savingsRate === undefined ? '—' : `${Math.round(sum.savingsRate * 100)}%`}
          tone={sum.savingsRate !== undefined && sum.savingsRate < 0 ? 'exp' : 'inc'}
        />
      </div>

      <div class="card">
        <h2 class="exp">על מה הולך הכסף?</h2>
        {shares.total === 0 ? <p class="muted small">אין הוצאות בתקופה הזו</p> : <Donut slices={slicesOf(shares)} />}
      </div>

      <div class="card">
        <h2 class="inc">מאיפה מגיע הכסף?</h2>
        {incomeShares.total === 0 ? <p class="muted small">אין הכנסות בתקופה הזו</p> : <Donut slices={slicesOf(incomeShares)} />}
      </div>

      <div class="card">
        <h2>נכנס מול יצא, חודש אחרי חודש</h2>
        <IncomeExpenseBars months={months.map(m => ({ label: shortLabel(m.key), income: m.income, expenses: m.expenses }))} />
        <button class="link small" onClick={() => setShowTable(!showTable)}>
          {showTable ? 'הסתר טבלה' : 'הצג כטבלה'}
        </button>
        {showTable && (
          <table class="table">
            <thead>
              <tr>
                <th>חודש</th>
                <th class="inc">הכנסות</th>
                <th class="exp">הוצאות</th>
                <th>נשאר</th>
              </tr>
            </thead>
            <tbody>
              {[...months].reverse().map(m => (
                <tr key={m.key}>
                  <td>{shortLabel(m.key)}</td>
                  <td class="inc">{formatMoney(m.income)}</td>
                  <td class="exp">{formatMoney(m.expenses)}</td>
                  <td class={m.net < 0 ? 'exp' : 'inc'}>{formatMoney(m.net, { sign: true })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div class="card">
        <h2>איזה חודש היה הכי טוב?</h2>
        {best ? (
          <p class="small">
            הכי רווחי: <b>{shortLabel(best.key)}</b> ({formatMoney(best.net, { sign: true })})
            {worst && (
              <>
                {' '}· הכי פחות: <b>{shortLabel(worst.key)}</b> ({formatMoney(worst.net, { sign: true })})
              </>
            )}
          </p>
        ) : (
          <p class="muted small">ההשוואה תתמלא כשיסתיים החודש הראשון.</p>
        )}
        <NetBars
          months={months.map(m => ({
            label: shortLabel(m.key),
            net: m.net,
            note: m.key === currentKey ? 'עד כה' : m.key === best?.key ? 'הכי רווחי' : m.key === worst?.key ? 'הכי פחות רווחי' : undefined,
          }))}
        />
      </div>

      <div class="card">
        <h2 class="exp">איפה הוצאתי החודש יותר מהרגיל?</h2>
        {previous.length === 0 ? (
          <p class="muted small">צריך לפחות חודש אחד שהסתיים כדי להשוות לממוצע.</p>
        ) : (
          <table class="table">
            <thead>
              <tr>
                <th>קטגוריה</th>
                <th>החודש</th>
                <th>ממוצע</th>
                <th>הפרש</th>
              </tr>
            </thead>
            <tbody>
              {vsAverage.map(r => (
                <tr key={r.categoryId}>
                  <td>
                    <span class="cat-dot" style={{ background: categoryColor(r.categoryId, data.categories) }} />
                    {catName(r.categoryId)}
                  </td>
                  <td>{formatMoney(r.current)}</td>
                  <td>{formatMoney(r.average)}</td>
                  <td class={r.change > 0 ? 'neg-text' : r.change < 0 ? 'pos-text' : ''}>
                    {r.change > 0 ? '▲ ' : r.change < 0 ? '▼ ' : ''}
                    {formatMoney(Math.abs(r.change))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {previous.length > 0 && <p class="muted small">ממוצע של {previous.length === 1 ? 'החודש הקודם' : `${previous.length} החודשים הקודמים`}. ▲ יותר מהרגיל, ▼ פחות.</p>}
      </div>

      {paid.length > 0 && (
        <div class="card">
          <h2>במה אני משלם?</h2>
          <StackBar parts={paid.map((p, i) => ({ label: KIND_NAMES[p.kind], amount: p.amount, color: SERIES(i) }))} />
        </div>
      )}

      {biggest.length > 0 && (
        <div class="card">
          <h2 class="exp">ההוצאות הגדולות ביותר</h2>
          {biggest.map(t => (
            <button key={t.id} class="tx" onClick={() => props.onEdit(t)}>
              <div>
                <div>
                  <span class="cat-dot" style={{ background: categoryColor(t.categoryId, data.categories) }} />
                  {catName(t.categoryId ?? '')}
                </div>
                <div class="muted small">{[dayLabel(t.date, today), t.note].filter(Boolean).join(' · ')}</div>
              </div>
              <div class="amount expense">{formatMoney(-t.amount)}</div>
            </button>
          ))}
        </div>
      )}

      <div class="card">
        <h2>שנה מול שנה</h2>
        <table class="table">
          <thead>
            <tr>
              <th>שנה</th>
              <th class="inc">הכנסות</th>
              <th class="exp">הוצאות</th>
              <th>נשאר</th>
            </tr>
          </thead>
          <tbody>
            {years.map(y => (
              <tr key={y.year}>
                <td>{y.year}</td>
                <td class="inc">{formatMoney(y.income)}</td>
                <td class="exp">{formatMoney(y.expenses)}</td>
                <td class={y.net < 0 ? 'exp' : 'inc'}>{formatMoney(y.net, { sign: true })}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {years.length < 2 && <p class="muted small">ההשוואה בין שנים תתמלא בשנה הבאה.</p>}
      </div>
    </>
  );
}

function Stat(props: { label: string; value: ComponentChildren; tone: 'inc' | 'exp' }) {
  return (
    <div class="stat">
      <div class={`small ${props.tone}`}>{props.label}</div>
      <div class={`stat-value ${props.tone}`}>{props.value}</div>
    </div>
  );
}

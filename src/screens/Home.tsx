import { useMemo, useState } from 'preact/hooks';
import type { OpenGap } from '../data/reconcile';
import { whenRecorded } from '../components/OpenGapCard';
import { AnimatedMoney } from '../components/AnimatedMoney';
import { MonthSummary } from '../components/MonthSummary';
import { summarize } from '../data/balance';
import { periodKey } from '../data/dashboard';
import { liquidByDay } from '../data/dash';
import { dayInMonth, parseDate } from '../data/dates';
import { todayStr } from '../data/dates';
import { checkMark, checkStatus } from '../data/reconcile';
import { formatMoney } from '../data/money';
import type { AppData } from '../data/store';
import type { CalendarEvent, Transaction } from '../data/types';
import { CalendarScreen } from './Calendar';

function daysAgo(iso: string) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return days === 0 ? 'היום' : days === 1 ? 'אתמול' : `לפני ${days} ימים`;
}

export function Home(props: {
  db: IDBDatabase;
  data: AppData;
  onChange: () => void;
  onEdit: (tx: Transaction) => void;
  onOpenData: () => void;
  onOpenCheck: (accountId?: string) => void;
  /** Gaps left open after checks: tapping one brings up its card. */
  openGaps?: OpenGap[];
  onOpenGap?: (accountId: string) => void;
  onRecheckCard?: (cardId: string) => void;
  onOpenGoals: () => void;
  /** A card without a limit: set one (the payment methods settings). */
  onAddLimit?: () => void;
  onEditEvent: (event?: CalendarEvent, date?: string, time?: string) => void;
  /** The calendar's chosen day: kept by the app, so "+" records on it and coming back keeps it. */
  day: string;
  onDayChange: (date: string) => void;
}) {
  const { data } = props;
  const today = todayStr();
  const summary = useMemo(() => summarize(data, today), [data, today]);
  const [showBreakdown, setShowBreakdown] = useState(false);
  // The liquid money day by day: the last 30 days drawn under the number, and against the same day last month
  // (the month's last day when last month was shorter); nothing when the app wasn't used yet then
  const days = useMemo(() => liquidByDay(data, today), [data, today]);
  const monthAgo = dayInMonth(today, -1, parseDate(today).d);
  const then = days.find(d => d.date === monthAgo);
  const sinceMonth = then ? summary.liquid - then.amount : undefined;
  const spark = days.slice(-30);
  const [calendarDay, setCalendarDay] = useState(props.day);
  const checkState = useMemo(() => checkStatus(data, today), [data, today]);

  return (
    <>
      <header class="top">
        <h1>
          {/* Today, above the title: "יום שני, 23 בנובמבר" */}
          <span class="home-date">{new Date(`${today}T12:00:00`).toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
          הכסף שלי
        </h1>
      </header>

      {checkState.due.length > 0 && (
        // Stays until every source that's due has been checked
        <button class="check-due" onClick={() => props.onOpenCheck(checkState.due[0].id)}>
          <span class="check-due-title">
            {checkState.checked === 0 && data.checkMode === 'together' ? 'הגיע הזמן לבדוק מול הבנק' : `נדרשת בדיקה: ${checkState.due.map(a => a.name).join(', ')}`}
          </span>
          <span class="small">
            {data.checkMode === 'together' && checkState.checked > 0
              ? `${checkState.checked} מתוך ${checkState.total} נבדקו · לחץ להמשך`
              : data.balanceChecks[0]
                ? `בדיקה אחרונה: ${daysAgo(data.balanceChecks[0].date + 'T12:00:00')} · לחץ לבדיקה`
                : 'עוד לא נבדק אף פעם · לחץ לבדיקה'}
          </span>
        </button>
      )}

      {props.openGaps?.map(g => (
        <button key={g.account.id} class="open-gap-line" onClick={() => props.onOpenGap?.(g.account.id)}>
          <span>
            פער פתוח ב{g.account.name}: נשארו <strong>{formatMoney(Math.abs(g.left))}</strong>
          </span>
          <span class="bar gap-bar">
            <span style={{ width: `${Math.abs(g.found) ? Math.max(0, Math.min(1, 1 - Math.abs(g.left) / Math.abs(g.found))) * 100 : 0}%` }} />
          </span>
          <span class="small muted">{whenRecorded(g, today)} · לחץ להשלמה</span>
        </button>
      ))}

      <div class="card hero hero-main">
        <div class="muted small">כסף נזיל עכשיו</div>
        <div class="big-number">
          <AnimatedMoney value={summary.liquid} />
        </div>
        {sinceMonth !== undefined && sinceMonth !== 0 && (
          <div class={`small since-month ${sinceMonth > 0 ? 'inc' : 'exp'}`}>
            {formatMoney(sinceMonth, { sign: true })} לעומת {parseDate(monthAgo).d}.{parseDate(monthAgo).m0 + 1}
          </div>
        )}
        {spark.length > 2 && <Spark values={spark.map(d => d.amount)} />}
        <div class="source-tags">
          {summary.byAccount.map(({ account, balance }) => (
            <button key={account.id} class={`source-tag ${showBreakdown ? 'on' : ''}`} onClick={() => setShowBreakdown(!showBreakdown)} aria-expanded={showBreakdown}>
              {account.name} <AnimatedMoney value={balance} />
            </button>
          ))}
        </div>
        {summary.reserved > 0 && (
          <button class="link small reserved-line" onClick={props.onOpenGoals}>
            מתוכם {formatMoney(summary.reserved)} שמורים ליעדים · פנוי{' '}
            <span class={summary.liquid - summary.reserved < 0 ? 'exp' : ''}>{formatMoney(summary.liquid - summary.reserved)}</span> ‹
          </button>
        )}
        {summary.apart > 0 && (
          <button class="link small" onClick={props.onOpenGoals}>
            ועוד {formatMoney(summary.apart)} בצד, ביעדי חיסכון ‹
          </button>
        )}
        {showBreakdown && (
          <div class="upcoming">
            {summary.byAccount.map(({ account, balance }) => {
              // When this source was last checked against the bank (or the wallet), and how it came out
              const last = data.balanceChecks.find(c => c.accountId === account.id);
              const mark = last && checkMark(last.real, last.app, data.checkTolerance);
              return (
                <div key={account.id} class="line account-line">
                  <span>
                    {account.name}
                    <span class={`small block check-when ${mark ?? ''}`}>
                      {last ? `נבדק ${daysAgo(last.date + 'T12:00:00')} ${mark === 'exact' ? '✓' : mark === 'minor' ? '✓✗' : '✗'}` : 'עוד לא נבדק'}
                    </span>
                  </span>
                  <span>{formatMoney(balance)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div class="sec-label">
        <span>יומן</span>
      </div>
      <CalendarScreen compact data={data} onBack={() => {}} onEdit={props.onEditEvent} onEditTx={props.onEdit}
        initialDay={props.day}
        onSelect={d => {
          setCalendarDay(d);
          props.onDayChange(d);
        }}
      />

      {/* The month of the day chosen in the calendar above: moving the calendar moves this too */}
      <MonthSummary data={data} onEdit={props.onEdit} onRecheckCard={props.onRecheckCard} onAddLimit={props.onAddLimit} monthKey={periodKey(calendarDay, data.monthStartDay)} asOf={calendarDay} />
    </>
  );
}

/** The last days of the liquid money as a small line under the number (it draws itself in). */
function Spark(props: { values: number[] }) {
  const v = props.values;
  const hi = Math.max(...v);
  const lo = Math.min(...v);
  const span = hi - lo || 1;
  const pts = v.map((x, i) => `${((i / (v.length - 1)) * 300).toFixed(1)},${(27 - ((x - lo) / span) * 24).toFixed(1)}`);
  return (
    <svg class="hero-spark" viewBox="0 0 300 30" aria-hidden="true">
      {/* the newest day on the left, the way the text reads */}
      <path d={`M${pts.join(' L')}`} pathLength={1} transform="translate(300 0) scale(-1 1)" />
    </svg>
  );
}

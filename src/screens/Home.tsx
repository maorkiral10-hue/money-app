import { useState } from 'preact/hooks';
import { AnimatedMoney } from '../components/AnimatedMoney';
import { MonthSummary } from '../components/MonthSummary';
import { summarize } from '../data/balance';
import { periodKey } from '../data/dashboard';
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
  onOpenGoals: () => void;
  onEditEvent: (event?: CalendarEvent, date?: string, time?: string) => void;
}) {
  const { data } = props;
  const today = todayStr();
  const summary = summarize(data, today);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [calendarDay, setCalendarDay] = useState(today);
  const checkState = checkStatus(data, today);

  return (
    <>
      <header class="top">
        <h1>הכסף שלי</h1>
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

      <div class="card hero">
        <div class="muted small">כסף נזיל עכשיו</div>
        <div class="big-number">
          <AnimatedMoney value={summary.liquid} />
        </div>
        {summary.goals.some(g => g.balance) && (
          <button class="link small" onClick={props.onOpenGoals}>
            ועוד {formatMoney(summary.goals.reduce((a, g) => a + g.balance, 0))} ביעדי חיסכון ‹
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
        <div class="hero-buttons">
          <button class="secondary" onClick={() => setShowBreakdown(!showBreakdown)}>
            {showBreakdown ? 'הסתר פירוט' : 'פירוט'}
          </button>
        </div>
      </div>

      <CalendarScreen compact data={data} onBack={() => {}} onEdit={props.onEditEvent} onEditTx={props.onEdit} onSelect={setCalendarDay} />

      {/* The month of the day chosen in the calendar above: moving the calendar moves this too */}
      <MonthSummary data={data} onEdit={props.onEdit} monthKey={periodKey(calendarDay, data.monthStartDay)} asOf={calendarDay} />


      <div class="quiet-lines">
        <button class="quiet" onClick={() => props.onOpenCheck()}>
          {data.balanceChecks[0]
            ? `בדיקה מול הבנק: ${daysAgo(data.balanceChecks[0].date + 'T12:00:00')}`
            : 'בדיקה מול הבנק'}
        </button>
        <button class="quiet" onClick={props.onOpenData}>
          {data.lastBackupAt ? `גיבוי אחרון: ${daysAgo(data.lastBackupAt)}` : 'עדיין לא בוצע גיבוי'}
        </button>
      </div>
    </>
  );
}

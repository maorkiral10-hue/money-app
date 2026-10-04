import { useState } from 'preact/hooks';
import { Chips, MoneyInput, Segmented } from '../components/inputs';
import { addDays, dayLabel, parseDate, todayStr } from '../data/dates';
import { holidaysOn } from '../data/holidays';
import { setMeta } from '../data/db';
import { formatMoney } from '../data/money';
import type { QuickPreset } from '../data/quick';
import { appBalance, checkMark, checkStatus, correctBalance, defaultEvery, everyFor, keepRegularSchedule, logCheck, type CheckEvery, type CheckMode } from '../data/reconcile';
import type { AppData } from '../data/store';

const EVERY_OPTIONS: [CheckEvery, string][] = [
  ['never', 'בלי'],
  ['week', 'כל שבוע'],
  ['twoWeeks', 'כל שבועיים'],
  ['month', 'כל חודש'],
];

/**
 * Checking a balance against the bank (or the wallet): type what's really there, see the gap, and choose
 * how to close it - add the missing expense or income, set the app's balance, or leave it. No pop-ups:
 * this screen is opened when you want it, from the quiet line on the home screen or from settings.
 */
export function BalanceCheck(props: {
  db: IDBDatabase;
  data: AppData;
  onBack: () => void;
  onChange: () => void;
  onAddMissing: (preset: QuickPreset) => void;
  /** Open on this source (the first one due, from the home screen's bubble). */
  accountId?: string;
}) {
  const { data } = props;
  const today = todayStr();
  const accounts = data.accounts.filter(a => !a.archived && a.name.trim() && a.kind !== 'goal');
  const [accountId, setAccountId] = useState(props.accountId ?? accounts.find(a => a.kind === 'bank')?.id ?? accounts[0]?.id);
  // The sources still due a check, not counting the one on screen
  const nextDue = checkStatus(data, today).due.find(a => a.id !== accountId);
  const pick = (id: string) => {
    setAccountId(id);
    setChecked(false);
    setTyped(false);
    setReal(0);
    setDone('');
    setEarly(null);
  };
  const [real, setReal] = useState(0);
  const [typed, setTyped] = useState(false);
  const [checked, setChecked] = useState(false);
  const [done, setDone] = useState('');
  // Checked before its time: ask whether the next reminder counts from today or stays on schedule
  const [early, setEarly] = useState<'ask' | 'today' | 'regular' | null>(null);
  const account = accounts.find(a => a.id === accountId);
  const app = account ? appBalance(data, account.id, today) : 0;
  const gap = real - app;
  const mark = checkMark(real, app, data.checkTolerance);
  // Today or one of the last three days was Shabbat or a rest day: the bank may not have caught up yet
  const restNote = (() => {
    for (let i = 0; i <= 3; i++) {
      const d = addDays(today, -i);
      const { y, m0, d: day } = parseDate(d);
      const rest = holidaysOn(d).find(h => h.rest);
      const name = rest ? rest.name : new Date(y, m0, day).getDay() === 6 ? 'שבת' : undefined;
      if (name) return `שים לב: ${i === 0 ? 'היום' : dayLabel(d, today)} ${i === 0 ? 'זה' : 'היה'} ${name}, ואז הבנק לא מעדכן תנועות. ייתכן שחלק מהפער עוד יתעדכן.`;
    }
    return undefined;
  })();
  const name = (id: string) => data.accounts.find(a => a.id === id)?.name ?? '';

  const compare = async () => {
    if (!account) return;
    const due = checkStatus(data, today).due.some(a => a.id === account.id);
    const checkedBefore = data.balanceChecks.some(c => c.accountId === account.id);
    setEarly(!due && checkedBefore && everyFor(data, account) !== 'never' ? 'ask' : null);
    setChecked(true);
    setDone('');
    await logCheck(props.db, { date: today, accountId: account.id, real, app, result: gap === 0 ? 'match' : 'gap' });
    props.onChange();
  };

  const correct = async () => {
    const what = gap < 0 ? 'הוצאה' : 'הכנסה';
    if (!account || !confirm(`לרשום ${what} "לא מזוהה" של ${formatMoney(Math.abs(gap))}?\nהיתרה של ${account.name} באפליקציה תהיה ${formatMoney(real)}, והסכום ייספר בחודש.`)) return;
    await correctBalance(props.db, data, account, real, app, today);
    if (early === 'regular') await keepRegularSchedule(props.db, account.id, today);
    setDone(`נרשמה ${what} "לא מזוהה" של ${formatMoney(Math.abs(gap))}. היתרה של ${account.name} עכשיו ${formatMoney(real)}.`);
    props.onChange();
  };

  return (
    <>
      <header class="top">
        <h1>בדיקה מול הבנק</h1>
        <button class="link" onClick={props.onBack}>
          חזרה
        </button>
      </header>
      <p class="muted small">
        הקלד כמה יש באמת, כמו שרואים באפליקציה של הבנק, והאפליקציה תשווה.{' '}
        {data.checkTolerance > 0 ? `פער עד ${formatMoney(data.checkTolerance)} נחשב שינוי מינורי (אפשר לשנות בהעדפות).` : 'כל פער נחשב חריגה (אפשר לקבוע טווח לשינוי מינורי בהעדפות).'}
      </p>

      <div class="card">
        <h2>איפה בודקים?</h2>
        <Chips items={accounts} value={accountId} onChange={pick} />
        <label class="field">
          <span>כמה יש שם עכשיו באמת</span>
          <MoneyInput
            key={accountId}
            value={0}
            onChange={v => {
              setReal(v);
              setTyped(true);
              setChecked(false);
            }}
          />
        </label>
        <button disabled={!typed || !account} onClick={compare}>
          השווה
        </button>
      </div>

      {checked && account && !done && (
        <div class={`card check-result ${mark === 'exact' ? 'inc-panel' : mark === 'minor' ? 'minor-panel' : 'exp-panel'}`}>
          {mark === 'exact' ? (
            <h2 class="inc">✓ מתאים בדיוק</h2>
          ) : (
            <>
              {mark === 'minor' ? (
                <h2 class="minor">✓✗ שינוי מינורי של {formatMoney(Math.abs(gap))}</h2>
              ) : (
                <h2 class="exp">✗ יש פער של {formatMoney(Math.abs(gap))}</h2>
              )}
              {restNote && <p class="small rest-note">{restNote}</p>}
              {mark === 'minor' && <p class="muted small">בתוך הטווח שהגדרת ({formatMoney(data.checkTolerance)}), אז הבדיקה נחשבת תקינה.</p>}
              <div class="line">
                <span>באפליקציה</span>
                <span>{formatMoney(app)}</span>
              </div>
              <div class="line">
                <span>באמת</span>
                <span>{formatMoney(real)}</span>
              </div>
              <p class="muted small">
                {gap < 0
                  ? 'יש פחות ממה שהאפליקציה חושבת: כנראה הוצאה שלא נרשמה.'
                  : 'יש יותר ממה שהאפליקציה חושבת: כנראה הכנסה שלא נרשמה.'}
              </p>
              <button onClick={() => props.onAddMissing({ type: gap < 0 ? 'expense' : 'income', amount: Math.abs(gap) })}>
                {gap < 0 ? `להוסיף הוצאה של ${formatMoney(-gap)}` : `להוסיף הכנסה של ${formatMoney(gap)}`}
              </button>
              <button class="secondary" onClick={correct}>
                לא מצאתי: לרשום את הפער כ"לא מזוהה"
              </button>
              <p class="muted small">
                {gap < 0 ? 'תירשם הוצאה' : 'תירשם הכנסה'} של {formatMoney(Math.abs(gap))} בקטגוריה "לא מזוהה", והיתרה באפליקציה תהיה {formatMoney(real)}.
              </p>
              <button class="link" onClick={props.onBack}>
                להשאיר ככה
              </button>
            </>
          )}
        </div>
      )}
      {done && <div class="card note">{done}</div>}
      {checked && early === 'ask' && account && (
        <div class="card">
          <h2>בדקת לפני הזמן. מתי הבדיקה הבאה?</h2>
          <div class="scope-buttons">
            <button onClick={() => setEarly('today')}>לספור מהיום</button>
            <button
              class="secondary"
              onClick={async () => {
                await keepRegularSchedule(props.db, account.id, today);
                setEarly('regular');
                props.onChange();
              }}
            >
              להישאר בקצב הרגיל
            </button>
          </div>
        </div>
      )}
      {checked && nextDue && (
        <button onClick={() => pick(nextDue.id)}>לבדיקה הבאה: {nextDue.name}</button>
      )}

      <div class="card">
        <h2>תזכורת</h2>
        <p class="muted small">כשמגיע הזמן, מופיעה בראש מסך הבית בועה שנשארת עד שבודקים.</p>
        <Segmented
          value={data.checkMode}
          onChange={async (v: CheckMode) => {
            await setMeta(props.db, 'checkMode', v);
            props.onChange();
          }}
          options={[
            ['together', 'כולם יחד'],
            ['separate', 'לכל אחד בנפרד'],
          ]}
        />
        {data.checkMode === 'together' ? (
          <div class="check-every">
            <Segmented
              value={data.checkEvery}
              onChange={async (v: CheckEvery) => {
                await setMeta(props.db, 'checkEvery', v);
                props.onChange();
              }}
              options={EVERY_OPTIONS}
            />
          </div>
        ) : (
          <div class="check-every">
            {accounts.map(a => (
              <label key={a.id} class="line check-every-row">
                <span>{a.name}</span>
                <select
                  value={data.checkEveryByAccount[a.id] ?? defaultEvery(a)}
                  onChange={async e => {
                    await setMeta(props.db, 'checkEveryByAccount', { ...data.checkEveryByAccount, [a.id]: e.currentTarget.value as CheckEvery });
                    props.onChange();
                  }}
                >
                  {EVERY_OPTIONS.map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        )}
      </div>

      {data.balanceChecks.length > 0 && (
        <div class="card list">
          <h2 class="list-title">בדיקות קודמות</h2>
          {data.balanceChecks.slice(0, 8).map((c, i) => (
            <div key={i} class="tx">
              <div>
                <div>{name(c.accountId)}</div>
                <div class="muted small">
                  {[
                    dayLabel(c.date, today),
                    checkMark(c.real, c.app, data.checkTolerance) === 'exact'
                      ? 'התאים'
                      : checkMark(c.real, c.app, data.checkTolerance) === 'minor'
                        ? `שינוי מינורי של ${formatMoney(Math.abs(c.real - c.app))}`
                        : `פער של ${formatMoney(Math.abs(c.real - c.app))}`,
                    c.result === 'corrected' && 'נרשם כלא מזוהה',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
              {(() => {
                const m = checkMark(c.real, c.app, data.checkTolerance);
                return <div class={m === 'exact' ? 'inc' : m === 'minor' ? 'minor' : 'exp'}>{m === 'exact' ? '✓' : m === 'minor' ? '✓✗' : '✗'}</div>;
              })()}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

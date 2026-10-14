import { useState } from 'preact/hooks';
import { Chips, MoneyInput, Segmented } from '../components/inputs';
import { addDays, dayLabel, parseDate, todayStr } from '../data/dates';
import { holidaysOn } from '../data/holidays';
import { setMeta } from '../data/db';
import { formatMoney } from '../data/money';
import type { QuickPreset } from '../data/quick';
import { CardWeeklyCheck } from '../components/CardWeeklyCheck';
import type { Transaction } from '../data/types';
import { checkableCards, checkSources, appBalance, unknownBySource, sourcePreset, DEFAULT_GRACE_DAYS, openGaps, recheckGap, checkMark, canDeleteCheck, checkStatus, correctBalance, deleteCheck, defaultEvery, everyFor, keepRegularSchedule, logCheck, type CheckEvery, type CheckMode } from '../data/reconcile';
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
  /** Checking a gap left open again: not a check of its own (see BalanceCheck.recheck). */
  recheck?: boolean;
  /** Opens a purchase (from a card's charge, to compare and fix). */
  onEdit?: (tx: Transaction) => void;
}) {
  const { data } = props;
  const today = todayStr();
  const accounts = data.accounts.filter(a => !a.archived && a.name.trim() && a.kind !== 'goal');
  const cards = checkableCards(data.methods);
  const [accountId, setAccountId] = useState(props.accountId ?? accounts.find(a => a.kind === 'bank')?.id ?? accounts[0]?.id);
  // A credit card is checked against its next charge, on its own panel
  const card = cards.find(c => c.id === accountId);
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
  // A gap may stay open no longer than the source is checked
  const graceCap = account && everyFor(data, account) !== 'never' ? { week: 7, twoWeeks: 14, month: 30 }[everyFor(data, account) as 'week'] : data.gapGraceDays;
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
  const name = (id: string) => checkSources(data).find(a => a.id === id)?.name ?? data.methods.find(m => m.id === id)?.name ?? '';

  // Opened to check a gap left open again: the gap it's for, as it was when the screen opened
  const [recheckOf] = useState(() => (props.recheck ? openGaps(data, today).find(g => g.account.id === props.accountId) : undefined));
  const [recheckDone, setRecheckDone] = useState('');

  const compare = async () => {
    if (!account) return;
    if (recheckOf) {
      await recheckGap(props.db, recheckOf, real, today);
      setChecked(true);
      setRecheckDone('');
      props.onChange();
      return;
    }
    const due = checkStatus(data, today).due.some(a => a.id === account.id);
    const checkedBefore = data.balanceChecks.some(c => c.accountId === account.id);
    setEarly(!due && checkedBefore && everyFor(data, account) !== 'never' ? 'ask' : null);
    setChecked(true);
    setDone('');
    await logCheck(props.db, { date: today, accountId: account.id, real, app, result: gap === 0 ? 'match' : 'gap', ...(!due && { early: true }) });
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
        <h1>{recheckOf ? `בדיקה חוזרת · ${recheckOf.account.name}` : props.recheck && card ? `בדיקה חוזרת · ${card.name}` : 'בדיקה מול הבנק'}</h1>
        <button class="link" onClick={props.onBack}>
          חזרה
        </button>
      </header>
      <p class="muted small">
        הקלד כמה יש באמת, כמו שרואים באפליקציה של הבנק (או של חברת האשראי), והאפליקציה תשווה.{' '}
        {data.checkTolerance > 0 ? `פער עד ${formatMoney(data.checkTolerance)} נחשב שינוי מינורי (אפשר לשנות בהעדפות).` : 'כל פער נחשב חריגה (אפשר לקבוע טווח לשינוי מינורי בהעדפות).'}
      </p>

      {!props.recheck && (
        <div class="card">
          <h2>איפה בודקים?</h2>
          <Chips items={accounts} value={accountId} onChange={pick} />
          {cards.length > 0 && (
            <>
              <p class="field-label">כרטיסי אשראי</p>
              <Chips items={cards} value={accountId} onChange={pick} />
            </>
          )}
        </div>
      )}
      {card && (
        <CardWeeklyCheck
          key={card.id}
          db={props.db}
          data={data}
          card={card}
          recheck={props.recheck}
          onBack={props.onBack}
          onChange={props.onChange}
          onAddMissing={props.onAddMissing}
          onEdit={props.onEdit}
        />
      )}
      {!card && recheckOf && (
        <p class="small recheck-note">
          בודקים שוב את הפער הפתוח מ{dayLabel(recheckOf.check.date, today)}. הבדיקה הזו לא נכנסת להיסטוריה ולא משנה את מועד הבדיקה הבאה.
        </p>
      )}
      {!card && (
      <div class="card">
        {recheckOf && <h2>כמה יש עכשיו באמת?</h2>}
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
      )}

      {!card && recheckOf && checked && account && (
        <div class={`card check-result ${Math.abs(gap) <= data.checkTolerance ? 'inc-panel' : 'exp-panel'}`}>
          {Math.abs(gap) <= data.checkTolerance ? (
            <>
              <h2 class="inc">✓ הפער נסגר</h2>
              <p class="muted small">עכשיו {account.name} מתאים למה שרשום.</p>
              <button onClick={props.onBack}>סיום</button>
            </>
          ) : recheckDone ? (
            <>
              <p>{recheckDone}</p>
              <button onClick={props.onBack}>סיום</button>
            </>
          ) : (
            <>
              <h2 class="exp">
                עדיין {gap < 0 ? 'חסרים' : 'יש עודף של'} {formatMoney(Math.abs(gap))}
              </h2>
              <p class="muted small">
                {Math.abs(gap) < Math.abs(recheckOf.found) ? `מתוך ${formatMoney(Math.abs(recheckOf.found))} בהתחלה. ` : ''}הפער נשאר פתוח עד {dayLabel(recheckOf.until, today)}.
              </p>
              <button onClick={() => props.onAddMissing({ ...sourcePreset(data, account, gap), date: today })}>
                {gap < 0 ? `+ להוסיף הוצאה (עד ${formatMoney(-gap)})` : `+ להוסיף הכנסה (עד ${formatMoney(gap)})`}
              </button>
              <button
                class="secondary"
                onClick={async () => {
                  const g = openGaps(data, today).find(x => x.account.id === account.id);
                  if (!g) return;
                  await correctBalance(props.db, data, account, g.check.real, g.check.real - g.left, g.check.date);
                  setRecheckDone(`נרשם "לא מזוהה" של ${formatMoney(Math.abs(g.left))}. היתרה של ${account.name} עכשיו מתאימה.`);
                  props.onChange();
                }}
              >
                לא אמצא: לרשום כ"לא מזוהה"
              </button>
              <button class="link" onClick={props.onBack}>
                להמשיך לחפש
              </button>
            </>
          )}
        </div>
      )}
      {!card && !recheckOf && checked && account && !done && (
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
              <button onClick={() => props.onAddMissing({ ...sourcePreset(data, account, gap), date: today })}>
                {gap < 0 ? `להוסיף הוצאה של ${formatMoney(-gap)}` : `להוסיף הכנסה של ${formatMoney(gap)}`}
              </button>
              <button class="secondary" onClick={correct}>
                לא מצאתי: לרשום את הפער כ"לא מזוהה"
              </button>
              <p class="muted small">
                {gap < 0 ? 'תירשם הוצאה' : 'תירשם הכנסה'} של {formatMoney(Math.abs(gap))} בקטגוריה "לא מזוהה", והיתרה באפליקציה תהיה {formatMoney(real)}.
              </p>
              {mark === 'minor' ? (
                <button class="link" onClick={props.onBack}>
                  להשאיר ככה
                </button>
              ) : (
                <>
                  <button class="link" onClick={props.onBack}>
                    להשאיר פתוח ל־{Math.min(data.gapGraceDays, graceCap)} {Math.min(data.gapGraceDays, graceCap) === 1 ? 'יום' : 'ימים'} ולחפש
                  </button>
                  <p class="muted small">
                    בימים האלה כל מה שתרשום מלפני היום יקטין את הפער, ואפשר לבדוק שוב. מה שיישאר אחר כך יירשם לבד כ"לא מזוהה" (בתאריך של היום).
                  </p>
                </>
              )}
            </>
          )}
        </div>
      )}
      {done && <div class="card note">{done}</div>}
      {!card && !recheckOf && checked && early === 'ask' && account && (
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
      {!recheckOf && checked && nextDue && (
        <button onClick={() => pick(nextDue.id)}>לבדיקה הבאה: {nextDue.name}</button>
      )}

      <div class="card">
        <h2>פער שנשאר פתוח</h2>
        <p class="muted small">כמה ימים פער מחכה שתמצא אותו, לפני שהוא נרשם לבד כ"לא מזוהה" (לא יותר מתדירות הבדיקה). בכרטיסי אשראי הפער מחכה ליום החיוב ולא נרשם לבד.</p>
        <Segmented
          value={String(data.gapGraceDays)}
          onChange={async (v: string) => {
            await setMeta(props.db, 'gapGraceDays', Number(v));
            props.onChange();
          }}
          options={[1, 2, 3, 5, 7].map(n => [String(n), n === DEFAULT_GRACE_DAYS ? `${n} (רגיל)` : String(n)] as [string, string])}
        />
      </div>

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
            {checkSources(data).map(a => (
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

      <UnknownMoney data={data} />

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
                    c.result === 'closed' && 'הפער נמצא ונסגר',
                    canDeleteCheck(c) && 'בדיקה נוספת',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
              {(() => {
                const m = c.result === 'closed' ? 'exact' : checkMark(c.real, c.app, data.checkTolerance);
                return <div class={m === 'exact' ? 'inc' : m === 'minor' ? 'minor' : 'exp'}>{m === 'exact' ? '✓' : m === 'minor' ? '✓✗' : '✗'}</div>;
              })()}
              {canDeleteCheck(c) && (
              <button
                class="link small check-delete"
                aria-label="מחיקת הבדיקה"
                onClick={async () => {
                  const note = c.result === 'corrected' ? '\nהפעולה "לא מזוהה" שנרשמה בה נשארת ברשימה (אפשר למחוק אותה שם).' : '';
                  if (!confirm(`למחוק מההיסטוריה את הבדיקה של ${name(c.accountId)} מ${dayLabel(c.date, today)}?${note}`)) return;
                  await deleteCheck(props.db, i);
                  props.onChange();
                }}
              >
                ✕
              </button>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/**
 * Money that got away unexplained, per source, over all the history: the balance (pluses and minuses
 * offset) and the total either way, the number to bring down. Tapping a source shows each gap.
 */
function UnknownMoney(props: { data: AppData }) {
  const [open, setOpen] = useState<string | null>(null);
  const u = unknownBySource(props.data);
  if (!u.sources.length) return null;
  const today = todayStr();
  const signed = (n: number) => (n === 0 ? formatMoney(0) : formatMoney(n, { sign: true }));
  return (
    <div class="card unknown-money">
      <h2 class="list-title">כסף לא מזוהה</h2>
      <p class="muted small">פערים שנרשמו כ"לא מזוהה" מכל הבדיקות. כל מה שנזכרת בו אחר כך יורד מכאן.</p>
      <div class="unknown-totals">
        <div>
          <div class="muted small">סך הכסף הלא מזוהה</div>
          <div class="unknown-big">{formatMoney(u.total)}</div>
        </div>
        <div>
          <div class="muted small">מאזן (פלוס מול מינוס)</div>
          <div class={`unknown-big ${u.balance < 0 ? 'exp' : u.balance > 0 ? 'inc' : ''}`}>{signed(u.balance)}</div>
        </div>
      </div>
      {u.sources.map(s => (
        <div key={s.account.id} class="unknown-source">
          <button class="unknown-head" onClick={() => setOpen(open === s.account.id ? null : s.account.id)} aria-expanded={open === s.account.id}>
            <div class="line">
              <strong>
                {s.account.name}
                <span class={`chevron small-chevron ${open === s.account.id ? 'open' : ''}`}> ‹</span>
              </strong>
              <span>{formatMoney(s.total)}</span>
            </div>
            <div class="muted small">
              מאזן <span class={s.balance < 0 ? 'exp' : s.balance > 0 ? 'inc' : ''}>{signed(s.balance)}</span>
              {' · '}חוסר {s.less} {s.less === 1 ? 'פעם' : 'פעמים'} · עודף {s.more} {s.more === 1 ? 'פעם' : 'פעמים'}
            </div>
          </button>
          {open === s.account.id && (
            <div class="unknown-gaps">
              {s.gaps.map((g, i) => (
                <div key={i} class="line small">
                  <span>
                    {dayLabel(g.date, today)}
                    {g.left === 0 ? (
                      <span class="muted"> · הוסבר כולו ✓</span>
                    ) : (
                      g.left !== g.found && <span class="muted"> · הוסבר {formatMoney(Math.abs(g.found - g.left))} מתוך {formatMoney(Math.abs(g.found))}</span>
                    )}
                  </span>
                  <span class={g.left < 0 ? 'exp' : g.left > 0 ? 'inc' : 'muted'}>{signed(g.left)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

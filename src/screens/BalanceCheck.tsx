import { useState } from 'preact/hooks';
import { periodKey, periodStart } from '../data/dashboard';
import { summarize } from '../data/balance';
import { Chips, MoneyInput, Segmented } from '../components/inputs';
import { addDays, dayLabel, parseDate, todayStr } from '../data/dates';
import { holidaysOn } from '../data/holidays';
import { setMeta } from '../data/db';
import { formatMoney } from '../data/money';
import type { QuickPreset } from '../data/quick';
import { CardWeeklyCheck } from '../components/CardWeeklyCheck';
import type { Transaction } from '../data/types';
import { compareLines, isVerified, lastGoodCheck, setVerified, checkableCards, checkSources, appBalance, unknownBySource, sourcePreset, DEFAULT_GRACE_DAYS, openGaps, recheckGap, checkMark, canDeleteCheck, checkStatus, correctBalance, deleteCheck, defaultEvery, everyFor, keepRegularSchedule, logCheck, type CheckEvery, type CheckMode } from '../data/reconcile';
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
/** For counting cash: what of it is set aside for goals, in the wallet (counted) and apart (not). */
function cashSetAside(data: AppData, cashId: string) {
  const goals = summarize(data, todayStr()).goals.filter(g => g.balance > 0 && !g.account.archived);
  const inWallet = goals.filter(g => g.account.goalPlace === 'inside' && g.account.goalSource === cashId);
  const apart = goals.filter(g => g.account.goalPlace === 'envelope');
  const part = (list: typeof goals) => list.map(g => `${formatMoney(g.balance)} ${g.account.name}`).join(', ');
  const bits = [inWallet.length && `בתוך הארנק: ${part(inWallet)}`, apart.length && `בנפרד: ${part(apart)}`].filter(Boolean);
  return bits.length ? `מזומן ששמור לחיסכון · ${bits.join(' · ')}` : '';
}

/** Which part of the screen was open last, kept while the app is open. */
let lastTab: 'check' | 'history' = 'check';

/**
 * A check with a gap being looked into, per source: what was typed and the gap it started with. Kept while
 * the app is open, so going off to fix or add a line and coming back finds it as it was.
 */
const looking: Record<string, { real: number; initial: number; date: string }> = {};

/** The sources the weekly check started with today, so coming back mid-way still counts "2 מתוך 4". */
let weekly: { date: string; ids: string[] } | undefined;

export function BalanceCheck(props: {
  db: IDBDatabase;
  data: AppData;
  onBack: () => void;
  onChange: () => void;
  onAddMissing: (preset: QuickPreset, sourceId?: string) => void;
  /** Open on this source (the first one due, from the home screen's bubble). */
  accountId?: string;
  /** Checking a gap left open again: not a check of its own (see BalanceCheck.recheck). */
  recheck?: boolean;
  /** Opens a purchase (from a card's charge, to compare and fix). */
  onEdit?: (tx: Transaction, sourceId?: string) => void;
  /** Done with the checks: back to the home screen. */
  onHome: () => void;
}) {
  const { data } = props;
  const today = todayStr();
  const [tab, setTabState] = useState(props.recheck ? 'check' : lastTab);
  const setTab = (t: 'check' | 'history') => {
    lastTab = t;
    setTabState(t);
  };
  // The weekly check goes through what's due, one after the other: how many there were when it began
  const [dueAtStart] = useState(() => {
    if (weekly?.date !== today || !weekly.ids.length) weekly = { date: today, ids: checkStatus(data, today).due.map(a => a.id) };
    return weekly.ids;
  });
  // A check that came out right (or was made right): the success screen, before going on
  const [success, setSuccess] = useState<{ name: string; found: boolean } | null>(null);
  const [extra, setExtra] = useState(false);
  const accounts = data.accounts.filter(a => !a.archived && a.name.trim() && a.kind !== 'goal');
  const cards = checkableCards(data.methods);
  const [accountId, setAccountId] = useState(props.accountId ?? dueAtStart[0] ?? accounts.find(a => a.kind === 'bank')?.id ?? accounts[0]?.id);
  // A credit card is checked against its next charge, on its own panel
  const card = cards.find(c => c.id === accountId);
  // The sources still due a check, not counting the one on screen
  const nextDue = checkStatus(data, today).due.find(a => a.id !== accountId);
  // Nothing more due (checked ahead of time, say): the next source not checked yet today, in order
  const nextExtra = nextDue ? undefined : checkSources(data).find(a => a.id !== accountId && !data.balanceChecks.some(c => c.accountId === a.id && c.date === today));
  const pick = (id: string) => {
    setAccountId(id);
    setSuccess(null);
    setExtra(false);
    setChecked(false);
    setTyped(false);
    setReal(0);
    setDone('');
    setEarly(null);
  };
  const resumed = !props.recheck && props.accountId ? looking[props.accountId] : undefined;
  const fresh = resumed?.date === today ? resumed : undefined;
  const [real, setReal] = useState(fresh?.real ?? 0);
  const [typed, setTyped] = useState(!!fresh);
  const [checked, setChecked] = useState(!!fresh);
  const [notFoundOpen, setNotFoundOpen] = useState(false);
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
      if (Math.abs(gap) <= data.checkTolerance) setSuccess({ name: account.name, found: true });
      props.onChange();
      return;
    }
    const due = checkStatus(data, today).due.some(a => a.id === account.id);
    const checkedBefore = data.balanceChecks.some(c => c.accountId === account.id);
    setEarly(!due && checkedBefore && everyFor(data, account) !== 'never' ? 'ask' : null);
    setChecked(true);
    setDone('');
    await logCheck(props.db, { date: today, accountId: account.id, real, app, result: gap === 0 ? 'match' : 'gap', ...(!due && { early: true }) });
    if (mark !== 'off') setSuccess({ name: account.name, found: false });
    else looking[account.id] = { real, initial: gap, date: today };
    props.onChange();
  };

  const correct = async () => {
    const what = gap < 0 ? 'הוצאה' : 'הכנסה';
    if (!account || !confirm(`לרשום ${what} "לא מזוהה" של ${formatMoney(Math.abs(gap))}?\nהיתרה של ${account.name} באפליקציה תהיה ${formatMoney(real)}, והסכום ייספר בחודש.`)) return;
    await correctBalance(props.db, data, account, real, app, today);
    if (early === 'regular') await keepRegularSchedule(props.db, account.id, today);
    setDone(`נרשמה ${what} "לא מזוהה" של ${formatMoney(Math.abs(gap))}. היתרה של ${account.name} עכשיו ${formatMoney(real)}.`);
    delete looking[account.id];
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
      {!props.recheck && (
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            ['check', 'בדיקה שבועית'],
            ['history', 'היסטוריה והעדפות'],
          ]}
        />
      )}

      {tab === 'check' && success && (
        <CheckSuccess
          name={success.name}
          found={success.found}
          next={nextDue ?? nextExtra}
          extra={!nextDue}
          onNext={() => {
            const n = nextDue ?? nextExtra;
            if (n) pick(n.id);
          }}
          onHome={props.onHome}
        >
          {early === 'ask' && account && (
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
        </CheckSuccess>
      )}

      {tab === 'check' && !success && (
      <>
      {!props.recheck && (
        <p class="muted small check-step">
          {dueAtStart.includes(accountId ?? '')
            ? `בדיקה ${dueAtStart.indexOf(accountId ?? '') + 1} מתוך ${dueAtStart.length} · ${dueAtStart.map(id => name(id)).join(', ')}`
            : 'בדיקה נוספת'}
        </p>
      )}
      {!props.recheck && extra && (
        <div class="card">
          <h2>איזה אפיק לבדוק?</h2>
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
          onAddMissing={preset => props.onAddMissing(preset, card.id)}
          onEdit={tx => props.onEdit?.(tx, card.id)}
          onSuccess={found => setSuccess({ name: card.name, found })}
          onLeaveOpen={() => (nextDue ? pick(nextDue.id) : props.onHome())}
        />
      )}
      {!card && recheckOf && (
        <p class="small recheck-note">
          הפער הפתוח מ{dayLabel(recheckOf.check.date, today)}: עבור על הפעולות למטה. אם הבנק כבר התעדכן, אפשר להקליד יתרה חדשה. זה לא נכנס להיסטוריה ולא משנה את מועד הבדיקה הבאה.
        </p>
      )}
      {!card && (
      <div class="card">
        {recheckOf && <h2>{account?.name}: יתרה מעודכנת (לא חובה)</h2>}
        {!recheckOf && account && <h2>{account.name}</h2>}
        <label class="field">
          <span>{account?.kind === 'bank' ? 'כמה רואים באפליקציה של הבנק?' : account?.kind === 'cash' ? 'כמה מזומן יש באמת?' : 'כמה יש שם עכשיו באמת?'}</span>
          {account?.kind === 'cash' && cashSetAside(data, account.id) && <span class="small muted block">{cashSetAside(data, account.id)}</span>}
          <MoneyInput
            key={accountId}
            value={real}
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

      {!card && recheckOf && account && !recheckDone && (() => {
        const g = openGaps(data, today).find(x => x.account.id === account.id);
        // Typed again: against today's balance; otherwise the gap as it stands since the check
        const left = checked ? gap : g ? g.left : 0;
        return (
          <GapLook
            db={props.db}
            data={data}
            source={account}
            real={checked ? real : recheckOf.check.real}
            gap={left}
            initial={recheckOf.found}
            graceDays={Math.max(0, Math.round((Date.UTC(...(recheckOf.until.split('-').map(Number) as [number, number, number])) - Date.UTC(...(today.split('-').map(Number) as [number, number, number]))) / 86_400_000))}
            leaveOpenText={`הפער נשאר פתוח עד ${dayLabel(recheckOf.until, today)}. כל פעולה שתרשום מלפני הבדיקה תקטין אותו.`}
            onEdit={tx => props.onEdit?.(tx, account.id)}
            onAdd={() => props.onAddMissing({ ...sourcePreset(data, account, left), date: today }, account.id)}
            onClosed={() => setSuccess({ name: account.name, found: true })}
            open={notFoundOpen}
            onToggleOpen={() => setNotFoundOpen(!notFoundOpen)}
            onLeaveOpen={props.onBack}
            onUnknown={async () => {
              if (!g) return;
              await correctBalance(props.db, data, account, g.check.real, g.check.real - g.left, g.check.date);
              setRecheckDone(`נרשם "לא מזוהה" של ${formatMoney(Math.abs(g.left))}. היתרה של ${account.name} עכשיו מתאימה.`);
              props.onChange();
            }}
          />
        );
      })()}
      {!card && recheckOf && recheckDone && (
        <div class="card note">
          <p>{recheckDone}</p>
          <button onClick={props.onBack}>סיום</button>
        </div>
      )}
      {!card && !recheckOf && checked && account && !done && (mark === 'off' || !!looking[account.id]) && (
        <GapLook
          db={props.db}
          data={data}
          source={account}
          real={real}
          gap={gap}
          initial={looking[account.id]?.initial ?? gap}
          restNote={restNote}
          graceDays={Math.min(data.gapGraceDays, graceCap)}
          onEdit={tx => props.onEdit?.(tx, account.id)}
          onAdd={() => props.onAddMissing({ ...sourcePreset(data, account, gap), date: today }, account.id)}
          onClosed={() => {
            delete looking[account.id];
            setSuccess({ name: account.name, found: true });
          }}
          open={notFoundOpen}
          onToggleOpen={() => setNotFoundOpen(!notFoundOpen)}
          onLeaveOpen={() => {
            delete looking[account.id];
            if (nextDue) pick(nextDue.id);
            else props.onHome();
          }}
          onUnknown={correct}
        />
      )}
      {done && <div class="card note">{done}</div>}
      {!card && !recheckOf && checked && early === 'ask' && account && mark === 'off' && (
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
      {!props.recheck && !extra && (
        <button class="link small" onClick={() => setExtra(true)}>
          בדיקה נוספת של אפיק אחר ‹
        </button>
      )}
      </>
      )}

      {tab === 'history' && (
      <>
      <div class="card">
        <h2>מה נחשב תקין</h2>
        <p class="muted small">פער עד הסכום הזה נחשב "שינוי מינורי" (✓✗) ולא חריגה (✗). 0 = כל פער נחשב חריגה.</p>
        <label class="field">
          <span>שינוי מינורי: עד</span>
          <MoneyInput
            value={data.checkTolerance}
            onChange={async v => {
              await setMeta(props.db, 'checkTolerance', v);
              props.onChange();
            }}
          />
        </label>
      </div>

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
                    c.result === 'closed' && 'תקינה · נמצא תוך כדי בדיקה',
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

/**
 * A check that came out right, or was made right while looking: a big tick drawn in a circle, a few dots
 * flying off, and what's next — the next source due, or back home once the weekly check is through.
 */
function CheckSuccess(props: {
  name: string;
  found: boolean;
  next?: { id: string; name: string };
  /** The next one isn't due (an extra check). */
  extra?: boolean;
  onNext: () => void;
  onHome: () => void;
  children?: preact.ComponentChildren;
}) {
  return (
    <div class="check-success">
      <div class="success-mark" aria-hidden="true">
        <svg viewBox="0 0 120 120">
          <circle class="success-ring" cx="60" cy="60" r="52" />
          <path class="success-tick" d="M37 62 L53 78 L84 45" />
        </svg>
        {[0, 1, 2, 3, 4, 5, 6, 7].map(i => (
          <span key={i} class={`confetti c${i}`} />
        ))}
      </div>
      <h2>הבדיקה הושלמה בהצלחה</h2>
      <p class="muted small">
        {props.name}
        {props.found ? ' · הפער נמצא תוך כדי בדיקה' : ''}
      </p>
      {props.children}
      {props.next ? (
        <button onClick={props.onNext}>
          {props.extra ? `עוד בדיקה: ${props.next.name}` : `הבא: ${props.next.name}`} ‹
        </button>
      ) : (
        <p class="small success-done">{props.extra ? 'כל האפיקים נבדקו היום ✓' : 'סיימת את הבדיקה השבועית ✓'}</p>
      )}
      <button class="secondary" onClick={props.onHome}>
        חזרה לדף הבית
      </button>
    </div>
  );
}

/**
 * A source's gap being looked for: how much of it was found so far, every line since its last check that
 * came out right (to compare one by one with the bank's or app's own list, ticking each — ticks stay for next
 * time), adding what's missing, and once the gap is gone, "הפער נסגר!". If it can't be found, a folded line
 * opens the two ways out: leave it open a few days, or record it as unexplained now.
 */
function GapLook(props: {
  db: IDBDatabase;
  data: AppData;
  source: { id: string; name: string; kind: string };
  real: number;
  gap: number;
  initial: number;
  restNote?: string;
  graceDays: number;
  onEdit: (tx: Transaction) => void;
  onAdd: () => void;
  onClosed: () => void;
  open: boolean;
  onToggleOpen: () => void;
  onLeaveOpen: () => void;
  onUnknown: () => void;
  /** Already left open (a recheck): what leaving it means now. */
  leaveOpenText?: string;
}) {
  const { data, source, gap } = props;
  const today = todayStr();
  // Fixed for the look: closing the gap shouldn't shrink the list under the user's eyes
  // The whole month (the financial one) — or back to the last check that came out right, if that was before it —
  // so something recorded late for an earlier week shows up, unticked among the ticked lines
  const [from] = useState(() => {
    const monthStart = periodStart(periodKey(today, data.monthStartDay), data.monthStartDay);
    const good = lastGoodCheck(data.balanceChecks, source.id) ?? data.startDate;
    const earliest = good < monthStart ? good : monthStart;
    return earliest < data.startDate ? data.startDate : earliest;
  });
  const lines = compareLines(data, source.id, from, today);
  const [ticks, setTicks] = useState(data.verified);
  const closed = Math.abs(gap) <= data.checkTolerance;
  // Found so far: how much of the gap it started with is gone (while it points the same way)
  const sameWay = Math.sign(gap) === Math.sign(props.initial);
  const found = closed ? Math.abs(props.initial) : sameWay ? Math.max(0, Math.abs(props.initial) - Math.abs(gap)) : 0;
  const share = props.initial ? Math.min(1, found / Math.abs(props.initial)) : 1;
  const tick = async (line: (typeof lines)[number]) => {
    const on = !isVerified(ticks, source.id, line);
    const next = { ...ticks };
    if (on) next[`${source.id}|${line.key}`] = line.version;
    else delete next[`${source.id}|${line.key}`];
    setTicks(next);
    await setVerified(props.db, ticks, source.id, line, on);
  };
  const done = lines.filter(l => isVerified(ticks, source.id, l)).length;
  return (
    <>
      <div class={`card check-result ${closed ? 'inc-panel' : 'exp-panel'}`}>
        <div class="line gap-title">
          <strong>{source.name}</strong>
          <strong class={closed ? 'inc' : 'exp'}>{closed ? 'הכל מתאים' : gap < 0 ? `חסרים ${formatMoney(-gap)}` : `עודף של ${formatMoney(gap)}`}</strong>
        </div>
        <div class="bar gap-bar">
          <span style={{ width: `${share * 100}%` }} />
        </div>
        <div class="muted small">
          נמצאו {formatMoney(found)} מתוך {formatMoney(Math.abs(props.initial))}
          {!sameWay && !closed ? ` · הפער התהפך: עכשיו ${gap < 0 ? 'חסרים' : 'עודף'} ${formatMoney(Math.abs(gap))}` : ''}
        </div>
        {closed && (
          <button class="gap-closed-btn" onClick={props.onClosed}>
            הפער נסגר!
          </button>
        )}
        {props.restNote && !closed && <p class="small rest-note">{props.restNote}</p>}
      </div>

      <div class="card compare-list">
        <p class="muted small">
          {source.kind === 'cash' ? 'כל מה שנרשם במזומן' : `השווה מול האפליקציה של ${source.name}`} מאז {from === data.startDate ? 'תחילת המעקב' : from.split('-').reverse().slice(0, 2).map(Number).join('.')} · ✓ = כבר נבדק ({done} מתוך {lines.length})
        </p>
        {lines.length === 0 && <p class="muted small">אין פעולות בתקופה הזו.</p>}
        {lines.map(l => {
          const on = isVerified(ticks, source.id, l);
          return (
            <div key={l.key} class={`compare-line ${on ? 'done' : ''}`}>
              <button class={`tick ${on ? 'on' : ''}`} aria-label={on ? 'בטל סימון' : 'סמן כנבדק'} onClick={() => tick(l)}>
                {on ? '✓' : ''}
              </button>
              <button class="compare-body" onClick={() => l.tx && props.onEdit(l.tx)} disabled={!l.tx}>
                <span>
                  {shortDay(l.date)} · {l.label}
                  {l.note && <span class="muted"> · {l.note}</span>}
                </span>
                <span class={l.amount > 0 ? 'inc' : ''}>{formatMoney(l.amount, { sign: l.amount > 0 })}</span>
              </button>
            </div>
          );
        })}
        <button class="secondary" onClick={props.onAdd}>
          + להוסיף פעולה שחסרה
        </button>
      </div>

      {!closed && (
        <div class="card not-found">
          <button class="not-found-head" onClick={props.onToggleOpen} aria-expanded={props.open}>
            <span>לא מצאת? מה עושים עם {formatMoney(Math.abs(gap))}</span>
            <span class={`chevron ${props.open ? 'open' : ''}`}>‹</span>
          </button>
          {props.open && (
            <div class="not-found-options">
              <button class="nf-option wait" onClick={props.onLeaveOpen}>
                <span class="nf-icon">⏳</span>
                <span>
                  <strong>להשאיר פתוח ולחפש עוד</strong>
                  <span class="small block">
                    {props.leaveOpenText ??
                      `יש לך ${props.graceDays} ${props.graceDays === 1 ? 'יום' : 'ימים'} להיזכר. כל פעולה שתרשום מלפני היום תקטין את הפער. בסוף הזמן מה שנשאר יירשם כלא מזוהה.`}
                  </span>
                </span>
              </button>
              <button class="nf-option unknown" onClick={props.onUnknown}>
                <span class="nf-icon">?</span>
                <span>
                  <strong>לרשום עכשיו כלא מזוהה</strong>
                  <span class="small block">
                    תירשם {gap < 0 ? 'הוצאה' : 'הכנסה'} של {formatMoney(Math.abs(gap))} בקטגוריה "לא מזוהה", והיתרה תתאים. אם תיזכר אחר כך, אפשר עדיין להסביר אותה.
                  </span>
                </span>
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

const shortDay = (d: string) => d.split('-').reverse().slice(0, 2).map(Number).join('.');

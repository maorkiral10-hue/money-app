import { useState } from 'preact/hooks';
import { Chips, MoneyInput, Segmented } from '../components/inputs';
import { SwipeRow } from '../components/SwipeRow';
import { nextChargeDate } from '../data/balance';
import { addDays, dayInMonth, dayLabel, parseDate, todayStr } from '../data/dates';
import { formatMoney } from '../data/money';
import { estimateFor, nextOccurrence } from '../data/recurring';
import { saveRecurring, type AppData } from '../data/store';
import { AmountChangeSheet, DeleteSheet, StopSheet } from '../components/RecurringSheets';
import type { PaymentMethod, Recurring } from '../data/types';

const WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

/** A month from the given day: the natural next date to offer when it doesn't go out today. */
const dayInMonthAfter = (date: string) => dayInMonth(date, 1, parseDate(date).d);

/** The card an expense is paid with, if it is a credit card: then the card's charge day decides when the bank pays. */
const creditCard = (rec: Pick<Recurring, 'type' | 'methodId'>, methods: PaymentMethod[]) => {
  const m = rec.type === 'expense' ? methods.find(x => x.id === rec.methodId) : undefined;
  return m?.kind === 'credit' && m.chargeDay ? m : undefined;
};

export function scheduleText(rec: Recurring, methods: PaymentMethod[]) {
  const card = creditCard(rec, methods);
  const { y, m0, d } = parseDate(rec.firstDate);
  const often =
    rec.frequency === 'daily'
      ? 'כל יום'
      : rec.frequency === 'yearly'
        ? `כל שנה ב-${d}.${m0 + 1}`
        : rec.frequency === 'weekly'
          ? `כל יום ${WEEKDAYS[new Date(y, m0, d).getDay()]}`
          : `כל חודש ב-${d}`;
  return card ? `${often} · בחיוב של ${card.name} (ב-${card.chargeDay} לחודש)` : often;
}

/** When it goes out (or comes in), in words: "כל חודש ב-10", without the card. */
const whenText = (rec: Recurring) => {
  const { y, m0, d } = parseDate(rec.firstDate);
  if (rec.frequency === 'daily') return 'כל יום';
  if (rec.frequency === 'yearly') return `כל שנה ב-${d}.${m0 + 1}`;
  if (rec.frequency === 'weekly') return `כל יום ${WEEKDAYS[new Date(y, m0, d).getDay()]}`;
  return `כל חודש ב-${d} לחודש`;
};

/**
 * Fixed income and standing orders, side by side like the month on the home screen: income on the right,
 * spending on the left, each opening its own list under it (both can be open, to see one against the other).
 * A line is just the name and the amount; tapping it shows how it's paid, when, and the next time.
 */
export function RecurringList(props: { db: IDBDatabase; data: AppData; onBack: () => void; onEdit: (rec?: Recurring) => void; onChange: () => void }) {
  const today = todayStr();
  const { data } = props;
  const [deleting, setDeleting] = useState<Recurring | null>(null);
  const [openSide, setOpenSide] = useState<{ income: boolean; expense: boolean }>({ income: false, expense: false });
  const [openId, setOpenId] = useState<string | null>(null);
  const [showEnded, setShowEnded] = useState(false);
  const isActive = (r: Recurring) => !r.endDate || r.endDate >= today;
  // In the order they come round from today on
  const byNext = (a: Recurring, b: Recurring) => (nextOccurrence(a, today) ?? '9999').localeCompare(nextOccurrence(b, today) ?? '9999');
  const side = (type: Recurring['type']) => data.recurring.filter(r => r.type === type && isActive(r)).sort(byNext);
  const ended = data.recurring.filter(r => !isActive(r));
  const name = (id?: string) => [...data.methods, ...data.accounts].find(x => x.id === id)?.name ?? '';

  const item = (rec: Recurring) => {
    const amount = estimateFor(rec, data.transactions);
    const open = openId === rec.id;
    const occ = nextOccurrence(rec, today);
    const card = creditCard(rec, data.methods);
    return (
      <div key={rec.id} class={`rec-item ${open ? 'open' : ''}`}>
        <button class="rec-head" onClick={() => setOpenId(open ? null : rec.id)} aria-expanded={open}>
          <span class="rec-name">{rec.name}</span>
          <span class={`amount ${rec.type}`}>
            {rec.variable ? '~' : ''}
            {formatMoney(rec.type === 'expense' ? -amount : amount, { sign: rec.type === 'income' })}
          </span>
        </button>
        {open && (
          <div class="rec-detail">
            <div>
              <span class="muted">{rec.type === 'expense' ? 'אמצעי תשלום:' : 'נכנס ל:'}</span> {name(rec.type === 'expense' ? rec.methodId : rec.accountId)}
            </div>
            <div>
              <span class="muted">מתי:</span> {whenText(rec)}
            </div>
            {card && (
              <div>
                <span class="muted">יורד מהבנק:</span> בחיוב של {card.name} ב-{card.chargeDay} לחודש
              </div>
            )}
            <div>
              <span class="muted">הפעם הבאה:</span>{' '}
              {rec.endDate ? (rec.endDate >= today ? `נפסקת מ־${dayLabel(addDays(rec.endDate, 1), today)}` : 'הסתיימה') : occ ? dayLabel(occ, today) : '—'}
            </div>
            {rec.variable && <div class="muted small">סכום משתנה: נשאלים ביום עצמו כמה בפועל</div>}
            <button class="secondary small-btn" onClick={() => props.onEdit(rec)}>
              עריכה ‹
            </button>
          </div>
        )}
      </div>
    );
  };

  const column = (type: Recurring['type']) => {
    const list = side(type);
    const income = type === 'income';
    const open = openSide[type];
    return (
      <div class="rec-col">
        <button
          class={`stat tappable ${open ? `on ${income ? 'inc-bg' : 'exp-bg'}` : ''}`}
          onClick={() => setOpenSide({ ...openSide, [type]: !open })}
          aria-expanded={open}
        >
          <div class={`small ${income ? 'inc' : 'exp'}`}>{income ? 'הכנסות קבועות' : 'הוצאות קבועות'}</div>
          <div class="stat-value">{list.length}</div>
          <div class="tap-hint">{open ? 'סגור ‹' : 'לחץ לפירוט ‹'}</div>
        </button>
        {open && (
          <div class={`card rec-list ${income ? 'inc-panel' : 'exp-panel'}`}>
            {list.length ? list.map(item) : <p class="muted small">{income ? 'אין עדיין הכנסות קבועות' : 'אין עדיין הוראות קבע'}</p>}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <header class="top">
        <h1>הכנסות והוצאות קבועות</h1>
        <button class="link" onClick={props.onBack}>
          חזרה
        </button>
      </header>
      <p class="muted small">
        משכורת, שכר דירה, מנויים וכל הוראת קבע. סכום קבוע נרשם לבד כשמגיע התאריך. בסכום משתנה (כמו חשמל) נשאלים ביום עצמו כמה ירד בפועל, ורק אז זה נרשם. לחיצה על שורה מראה את הפרטים, ומשם אפשר לערוך, להפסיק או למחוק.
      </p>
      <button onClick={() => props.onEdit()}>+ הוראת קבע או הכנסה קבועה</button>

      <div class="rec-columns">
        {column('income')}
        {column('expense')}
      </div>

      {ended.length > 0 && (
        <div class="card rec-ended">
          <button class="rec-head" onClick={() => setShowEnded(!showEnded)} aria-expanded={showEnded}>
            <span>הסתיימו ({ended.length})</span>
            <span class={`chevron ${showEnded ? 'open' : ''}`}>‹</span>
          </button>
          {showEnded && ended.map(item)}
        </div>
      )}
      {deleting && (
        <DeleteSheet
          db={props.db}
          data={props.data}
          rec={deleting}
          onCancel={() => setDeleting(null)}
          onDone={() => {
            setDeleting(null);
            props.onChange();
          }}
        />
      )}
    </>
  );
}

/** How far back a date can be picked: within one round of the schedule (the time it last happened). */
const BACK_DAYS: Record<Recurring['frequency'], number> = { daily: 0, weekly: 6, monthly: 30, yearly: 364 };

export function RecurringForm(props: { db: IDBDatabase; data: AppData; rec?: Recurring; onDone: () => void }) {
  const { data, rec } = props;
  const today = todayStr();
  const [type, setType] = useState<Recurring['type']>(rec?.type ?? 'expense');
  const [name, setName] = useState(rec?.name ?? '');
  const [variable, setVariable] = useState(rec?.variable ?? false);
  const [amount, setAmount] = useState(rec?.amount ?? 0);
  const [frequency, setFrequency] = useState<Recurring['frequency']>(rec?.frequency ?? 'monthly');
  const originalNext = rec ? nextOccurrence(rec, today) : undefined;
  const [date, setDate] = useState(originalNext ?? today);
  const [categoryId, setCategoryId] = useState(rec?.categoryId);
  const [methodId, setMethodId] = useState(rec?.methodId);
  const [accountId, setAccountId] = useState(rec?.accountId);
  // The date picked has come already (it went out today, or earlier this round): is it recorded already?
  const [alreadyRecorded, setAlreadyRecorded] = useState<boolean | undefined>();
  const [saving, setSaving] = useState(false);
  const [sheet, setSheet] = useState<'stop' | 'delete' | 'amount' | null>(null);

  const categories = data.categories.filter(c => c.kind === type && c.name.trim() && (!c.archived || c.id === rec?.categoryId));
  const methods = data.methods.filter(m => m.name.trim() && (!m.archived || m.id === rec?.methodId));
  const accounts = data.accounts.filter(a => a.name.trim() && a.kind !== 'goal' && (!a.archived || a.id === rec?.accountId));
  const card = creditCard({ type, methodId }, data.methods);
  const when = frequency === 'daily' ? today : date;
  const scheduleChanged = !rec || rec.frequency !== frequency || when !== originalNext;
  // Asked only when the date has come and the schedule is new or changed
  const askRecorded = scheduleChanged && when <= today;
  const valid =
    name.trim() &&
    (variable || amount > 0) &&
    categoryId &&
    (type === 'expense' ? methodId : accountId) &&
    when &&
    (!askRecorded || alreadyRecorded !== undefined);

  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    // A changed schedule starts again from its date; what was already recorded stays as it is
    await saveRecurring(props.db, {
      id: rec?.id ?? crypto.randomUUID(),
      createdAt: rec?.createdAt ?? new Date().toISOString(),
      name: name.trim(),
      type,
      variable,
      // A changing amount is suggested from the last time (the amount here only until there is one)
      estimate: variable ? 'last' : 'set',
      amount,
      frequency,
      categoryId,
      ...(type === 'expense' ? { methodId, accountId: undefined } : { accountId, methodId: undefined }),
      firstDate: scheduleChanged ? when : rec!.firstDate,
      handledThrough: scheduleChanged ? (askRecorded && alreadyRecorded ? when : addDays(when, -1)) : rec!.handledThrough,
      endDate: rec?.endDate,
    });
    props.onDone();
  };
  // A different fixed amount: said first that it's from the next time on
  const trySave = () => (rec && !variable && !rec.variable && amount !== rec.amount ? setSheet('amount') : save());

  const resume = async () => {
    if (!rec) return;
    await saveRecurring(props.db, { ...rec, endDate: undefined, firstDate: when, handledThrough: addDays(when, -1) });
    props.onDone();
  };

  const isExpense = type === 'expense';
  const what = isExpense ? 'הוראת קבע' : 'הכנסה קבועה';

  return (
    <div class="sheet">
      <header class="top">
        <button class="link" onClick={props.onDone}>
          ביטול
        </button>
        <h1>{rec ? `עריכת ${what}` : `${what} חדשה`}</h1>
        <span style={{ width: '40px' }} />
      </header>

      <Segmented
        value={type}
        onChange={t => {
          setType(t);
          setCategoryId(undefined);
        }}
        options={[
          ['expense', 'הוראת קבע (הוצאה)'],
          ['income', 'הכנסה קבועה'],
        ]}
      />

      <section>
        <h2>שם</h2>
        <input type="text" value={name} placeholder={isExpense ? 'למשל: שכר דירה, נטפליקס, חשמל' : 'למשל: משכורת'} onInput={e => setName(e.currentTarget.value)} />
      </section>

      <section>
        <h2>סכום</h2>
        <Segmented
          value={variable ? 'variable' : 'fixed'}
          onChange={v => setVariable(v === 'variable')}
          options={[
            ['fixed', 'קבוע'],
            ['variable', 'משתנה (כמו חשמל)'],
          ]}
        />
        <label class="field">
          <span>{variable ? 'בערך כמה? (לא חובה)' : 'הסכום'}</span>
          <MoneyInput value={amount} onChange={setAmount} />
        </label>
        <p class="muted small">
          {variable
            ? `בכל פעם, ביום עצמו, תופיע שאלה כמה ${isExpense ? 'ירד' : 'נכנס'} בפועל, ורק אחרי שתאשר זה נרשם. הסכום של הפעם הקודמת ממולא שם מראש, ואפשר לשנות.`
            : 'נרשם לבד בכל פעם שמגיע התאריך.'}
        </p>
      </section>

      <section>
        <h2>{isExpense ? 'על מה' : 'מה נכנס'}</h2>
        <Chips items={categories} value={categoryId} onChange={setCategoryId} />
      </section>

      <section>
        <h2>{isExpense ? 'איך משלמים' : 'לאן נכנס'}</h2>
        {isExpense ? <Chips items={methods} value={methodId} onChange={setMethodId} /> : <Chips items={accounts} value={accountId} onChange={setAccountId} />}
      </section>

      <section>
        <h2>מתי</h2>
        <Segmented
          value={frequency}
          onChange={f => {
            setFrequency(f);
            setAlreadyRecorded(undefined);
          }}
          options={[
            ['monthly', 'כל חודש'],
            ['weekly', 'כל שבוע'],
            ['yearly', 'כל שנה'],
            ['daily', 'כל יום'],
          ]}
        />
        {frequency !== 'daily' && (
          <label class="field">
            <span>{isExpense ? 'באיזה תאריך זה יורד' : 'באיזה תאריך זה נכנס'} (הפעם הקרובה, או האחרונה שהייתה)</span>
            <input
              type="date"
              value={date}
              min={addDays(today, -BACK_DAYS[frequency])}
              onChange={e => {
                if (!e.currentTarget.value) return;
                setDate(e.currentTarget.value);
                setAlreadyRecorded(undefined);
              }}
            />
          </label>
        )}
        {when && <p class="muted small">{scheduleText({ type, frequency, firstDate: when, methodId } as Recurring, data.methods)}</p>}
        {card && when && (
          <p class="muted small">
            על הכרטיס: {when <= today ? 'הפעם הזו' : 'הפעם הקרובה'} ({dayLabel(when, today)}) תופיע בחיוב של {card.name} ({dayLabel(nextChargeDate(when, card.chargeDay!), today)}).
          </p>
        )}
        {askRecorded && (
          <div class="card gap-ask">
            <p>
              {when === today ? (isExpense ? 'זה יורד היום' : 'זה נכנס היום') : `זה כבר ${isExpense ? 'ירד' : 'נכנס'} (${dayLabel(when, today)})`}. זה כבר רשום אצלך?
            </p>
            <div class="scope-buttons">
              <button class={alreadyRecorded === true ? '' : 'secondary'} onClick={() => setAlreadyRecorded(true)}>
                כן, כבר רשמתי
              </button>
              <button class={alreadyRecorded === false ? '' : 'secondary'} onClick={() => setAlreadyRecorded(false)}>
                {variable ? 'לא, לשאול אותי כמה' : 'לא, לרשום עכשיו'}
              </button>
            </div>
            <p class="muted small">
              {alreadyRecorded === true
                ? 'לא יירשם שוב. ממשיכים מהפעם הבאה.'
                : alreadyRecorded === false
                  ? `יירשם עם התאריך ${dayLabel(when, today)}, וממשיכים כרגיל.`
                  : 'כדי שלא יירשם פעמיים.'}
            </p>
          </div>
        )}
      </section>

      <button disabled={!valid || saving} onClick={trySave}>
        שמור
      </button>
      {rec && !rec.endDate && (
        <div class="rec-actions">
          <button class="secondary" onClick={() => setSheet('stop')}>
            להפסיק (נגמרה באמת)
          </button>
          <button class="secondary danger-text" onClick={() => setSheet('delete')}>
            למחוק (נוספה בטעות)
          </button>
        </div>
      )}
      {rec?.endDate && (
        <>
          <button class="secondary" onClick={resume}>
            להפעיל מחדש מהתאריך שנבחר
          </button>
          <button class="secondary danger-text" onClick={() => setSheet('delete')}>
            למחוק
          </button>
        </>
      )}
      {sheet === 'stop' && rec && <StopSheet db={props.db} data={data} rec={rec} onDone={props.onDone} onCancel={() => setSheet(null)} />}
      {sheet === 'delete' && rec && <DeleteSheet db={props.db} data={data} rec={rec} onDone={props.onDone} onCancel={() => setSheet(null)} />}
      {sheet === 'amount' && rec && (
        <AmountChangeSheet
          rec={rec}
          amount={amount}
          onConfirm={() => {
            setSheet(null);
            save();
          }}
          onCancel={() => setSheet(null)}
        />
      )}
    </div>
  );
}

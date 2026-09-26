import { useState } from 'preact/hooks';
import { Chips, MoneyInput, Segmented } from '../components/inputs';
import { SwipeRow } from '../components/SwipeRow';
import { nextChargeDate } from '../data/balance';
import { addDays, dayLabel, parseDate, todayStr } from '../data/dates';
import { formatMoney } from '../data/money';
import { estimateFor, nextOccurrence } from '../data/recurring';
import { saveRecurring, type AppData } from '../data/store';
import type { PaymentMethod, Recurring } from '../data/types';

const WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

/** The card an expense is paid with, if it is a credit card: then the card's charge day decides when the bank pays. */
const creditCard = (rec: Pick<Recurring, 'type' | 'methodId'>, methods: PaymentMethod[]) => {
  const m = rec.type === 'expense' ? methods.find(x => x.id === rec.methodId) : undefined;
  return m?.kind === 'credit' && m.chargeDay ? m : undefined;
};

export function scheduleText(rec: Recurring, methods: PaymentMethod[]) {
  const card = creditCard(rec, methods);
  if (card) {
    const often = { daily: 'כל יום', weekly: 'כל שבוע', monthly: 'כל חודש', yearly: 'כל שנה' }[rec.frequency];
    return `${often}, בחיוב של ${card.name} ב-${card.chargeDay}`;
  }
  const { y, m0, d } = parseDate(rec.firstDate);
  if (rec.frequency === 'daily') return 'כל יום';
  if (rec.frequency === 'yearly') return `כל שנה ב-${d}.${m0 + 1}`;
  if (rec.frequency === 'weekly') return `כל יום ${WEEKDAYS[new Date(y, m0, d).getDay()]}`;
  return `כל חודש ב-${d}`;
}

export function RecurringList(props: { data: AppData; onBack: () => void; onEdit: (rec?: Recurring) => void; onDelete: (rec: Recurring) => void }) {
  const today = todayStr();
  const active = props.data.recurring.filter(r => !r.endDate || r.endDate >= today);
  const ended = props.data.recurring.filter(r => r.endDate && r.endDate < today);

  const Row = ({ rec }: { rec: Recurring }) => {
    const occ = nextOccurrence(rec, today);
    const card = creditCard(rec, props.data.methods);
    const next = occ && card ? nextChargeDate(occ, card.chargeDay!) : occ;
    const amount = estimateFor(rec, props.data.transactions);
    return (
      <SwipeRow onDelete={() => props.onDelete(rec)}>
        <button class="tx" onClick={() => props.onEdit(rec)}>
          <div>
            <div>{rec.name}</div>
            <div class="muted small">
              {[scheduleText(rec, props.data.methods), next && !rec.endDate ? `הבא: ${dayLabel(next, today)}` : rec.endDate ? 'הסתיימה' : '', rec.variable ? 'סכום משתנה' : '']
                .filter(Boolean)
                .join(' · ')}
            </div>
          </div>
          <div class={`amount ${rec.type}`}>
            {rec.variable ? '~' : ''}
            {formatMoney(rec.type === 'expense' ? -amount : amount, { sign: rec.type === 'income' })}
          </div>
        </button>
      </SwipeRow>
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
        משכורת, שכר דירה, הוראות קבע ומנויים. סכום קבוע נרשם לבד כשמגיע התאריך. סכום משתנה מופיע בצפי לפי הערכה, ובתאריך האפליקציה שואלת כמה היה בפועל. כדי למחוק, החלק שורה שמאלה.
      </p>
      {active.length > 0 && (
        <div class="card list">
          {active.map(r => (
            <Row key={r.id} rec={r} />
          ))}
        </div>
      )}
      <button onClick={() => props.onEdit()}>+ הוסף קבועה</button>
      {ended.length > 0 && (
        <>
          <div class="day-label">הסתיימו</div>
          <div class="card list">
            {ended.map(r => (
              <Row key={r.id} rec={r} />
            ))}
          </div>
        </>
      )}
    </>
  );
}

export function RecurringForm(props: { db: IDBDatabase; data: AppData; rec?: Recurring; onDone: () => void }) {
  const { data, rec } = props;
  const today = todayStr();
  const [type, setType] = useState<Recurring['type']>(rec?.type ?? 'income');
  const [name, setName] = useState(rec?.name ?? '');
  const [variable, setVariable] = useState(rec?.variable ?? false);
  const [estimate, setEstimate] = useState<Recurring['estimate']>(rec?.estimate ?? 'set');
  const [amount, setAmount] = useState(rec?.amount ?? 0);
  const [frequency, setFrequency] = useState<Recurring['frequency']>(rec?.frequency ?? 'monthly');
  const [nextDate, setNextDate] = useState((rec && nextOccurrence(rec, today)) ?? today);
  const [categoryId, setCategoryId] = useState(rec?.categoryId);
  const [methodId, setMethodId] = useState(rec?.methodId);
  const [accountId, setAccountId] = useState(rec?.accountId);
  const [skipNearestCharge, setSkipNearestCharge] = useState(false);
  const [saving, setSaving] = useState(false);

  const categories = data.categories.filter(c => c.kind === type && c.name.trim() && (!c.archived || c.id === rec?.categoryId));
  const methods = data.methods.filter(m => m.name.trim() && (!m.archived || m.id === rec?.methodId));
  const accounts = data.accounts.filter(a => a.name.trim() && (!a.archived || a.id === rec?.accountId));
  const valid = name.trim() && amount > 0 && categoryId && (type === 'expense' ? methodId : accountId) && nextDate;

  // Paid by credit card: no date to ask, the bank pays it on the card's charge day
  const card = creditCard({ type, methodId }, data.methods);
  const wasCard = rec ? creditCard(rec, data.methods) : undefined;
  const cardScheduleChanged = !rec || !wasCard || rec.frequency !== frequency;
  // Starting today puts the first one in the nearest charge; starting on the charge day puts it in the one after
  const cardStart = card ? (skipNearestCharge ? nextChargeDate(today, card.chargeDay!) : today) : today;
  const firstCharge = card ? nextChargeDate(cardScheduleChanged ? cardStart : (nextOccurrence(rec!, today) ?? today), card.chargeDay!) : undefined;

  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    // A changed schedule starts again from its new first date; what was already recorded stays as it is
    const start = card ? cardStart : nextDate;
    const scheduleChanged = card
      ? cardScheduleChanged
      : !rec || !!wasCard || rec.frequency !== frequency || nextOccurrence(rec, today) !== nextDate;
    await saveRecurring(props.db, {
      id: rec?.id ?? crypto.randomUUID(),
      createdAt: rec?.createdAt ?? new Date().toISOString(),
      name: name.trim(),
      type,
      variable,
      estimate,
      amount,
      frequency,
      categoryId,
      ...(type === 'expense' ? { methodId, accountId: undefined } : { accountId, methodId: undefined }),
      firstDate: scheduleChanged ? start : rec!.firstDate,
      handledThrough: scheduleChanged ? addDays(start, -1) : rec!.handledThrough,
      endDate: rec?.endDate,
    });
    props.onDone();
  };

  const end = async () => {
    if (!rec || !confirm(`להפסיק את "${rec.name}"? מה שכבר נרשם יישאר, ולא יירשם עוד.`)) return;
    await saveRecurring(props.db, { ...rec, endDate: today });
    props.onDone();
  };

  const resume = async () => {
    if (!rec) return;
    await saveRecurring(props.db, { ...rec, endDate: undefined, firstDate: nextDate, handledThrough: addDays(nextDate, -1) });
    props.onDone();
  };

  return (
    <div class="sheet">
      <header class="top">
        <button class="link" onClick={props.onDone}>
          ביטול
        </button>
        <h1>{rec ? 'עריכת קבועה' : 'קבועה חדשה'}</h1>
        <span style={{ width: '40px' }} />
      </header>

      <Segmented
        value={type}
        onChange={t => {
          setType(t);
          setCategoryId(undefined);
        }}
        options={[
          ['income', 'הכנסה'],
          ['expense', 'הוצאה'],
        ]}
      />

      <section>
        <h2>שם</h2>
        <input type="text" value={name} placeholder={type === 'income' ? 'למשל: משכורת' : 'למשל: שכר דירה, נטפליקס'} onInput={e => setName(e.currentTarget.value)} />
      </section>

      <section>
        <h2>סכום</h2>
        <Segmented
          value={variable ? 'variable' : 'fixed'}
          onChange={v => setVariable(v === 'variable')}
          options={[
            ['fixed', 'קבוע'],
            ['variable', 'משתנה'],
          ]}
        />
        {variable && (
          <>
            <p class="muted small">איך להעריך אותו בצפי?</p>
            <Segmented
              value={estimate}
              onChange={setEstimate}
              options={[
                ['set', 'סכום שאני קובע'],
                ['average', 'ממוצע הפעמים הקודמות'],
              ]}
            />
          </>
        )}
        <label class="field">
          <span>{!variable ? 'הסכום' : estimate === 'set' ? 'ההערכה' : 'הערכה להתחלה, עד שיהיו פעמים קודמות'}</span>
          <MoneyInput value={amount} onChange={setAmount} />
        </label>
        {!variable && <p class="muted small">יירשם לבד בכל פעם שמגיע התאריך.</p>}
        {variable && <p class="muted small">בתאריך תופיע במסך הראשי שאלה כמה {type === 'income' ? 'נכנס' : 'ירד'} בפועל.</p>}
      </section>

      <section>
        <h2>{type === 'expense' ? 'איך משלמים' : 'לאן נכנס'}</h2>
        {type === 'expense' ? (
          <Chips items={methods} value={methodId} onChange={setMethodId} />
        ) : (
          <Chips items={accounts} value={accountId} onChange={setAccountId} />
        )}
      </section>

      {(type === 'income' || methodId) && (
        <section>
          <h2>כל כמה זמן</h2>
          <Segmented
            value={frequency}
            onChange={setFrequency}
            options={[
              ['monthly', 'כל חודש'],
              ['weekly', 'כל שבוע'],
              ['daily', 'כל יום'],
              ['yearly', 'כל שנה'],
            ]}
          />
          {card ? (
            <>
              <p class="muted small">
                יורד מהבנק בחיוב של {card.name} ב-{card.chargeDay} לחודש. החיוב הראשון שייכלל: {dayLabel(firstCharge!, today)}.
              </p>
              {cardScheduleChanged && (
                <button type="button" class="link small" onClick={() => setSkipNearestCharge(!skipNearestCharge)}>
                  {skipNearestCharge ? 'בעצם עוד לא, לכלול כבר בחיוב הקרוב' : 'כבר כלול בחיוב הקרוב? להתחיל מהחיוב שאחריו'}
                </button>
              )}
            </>
          ) : (
            <>
              <label class="field">
                <span>מתי בפעם הבאה</span>
                <input type="date" value={nextDate} onChange={e => e.currentTarget.value && setNextDate(e.currentTarget.value)} />
              </label>
              {nextDate && <p class="muted small">{scheduleText({ type, frequency, firstDate: nextDate } as Recurring, [])}</p>}
            </>
          )}
        </section>
      )}

      <section>
        <h2>{type === 'expense' ? 'על מה' : 'מה נכנס'}</h2>
        <Chips items={categories} value={categoryId} onChange={setCategoryId} />
      </section>

      <button disabled={!valid || saving} onClick={save}>
        שמור
      </button>
      {rec && !rec.endDate && (
        <button class="danger" onClick={end}>
          הפסק (הוראה שהסתיימה)
        </button>
      )}
      {rec?.endDate && (
        <button class="secondary" onClick={resume}>
          הפעל מחדש מהתאריך שנבחר
        </button>
      )}
    </div>
  );
}

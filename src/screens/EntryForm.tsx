import { useState, useMemo, useEffect } from 'preact/hooks';
import { ongoingEvents, timeRoundOf } from '../data/calendar';
import { Chips } from '../components/inputs';
import { cardUsage } from '../data/balance';
import { deleteRecord, putRecords, setMeta } from '../data/db';
import { addDays, dayLabel, todayStr } from '../data/dates';
import { formatMoney, moneyInputText, parseMoney } from '../data/money';
import { summarize } from '../data/balance';
import { resolvePreset, type QuickPreset } from '../data/quick';
import type { AppData } from '../data/store';
import type { Transaction, TxType } from '../data/types';

type Step = 'type' | 'amount' | 'event' | 'category' | 'method' | 'account' | 'from' | 'to' | 'when' | 'review';

// One question per screen, each confirmed with "המשך"; the last screen shows everything before saving.
const STEPS: Record<TxType, Step[]> = {
  expense: ['type', 'amount', 'category', 'method', 'when', 'review'],
  income: ['type', 'amount', 'category', 'account', 'when', 'review'],
  transfer: ['type', 'amount', 'from', 'to', 'when', 'review'],
};

const TYPE_NAMES: Record<TxType, string> = { expense: 'הוצאה', income: 'הכנסה', transfer: 'העברה' };
const INSTALLMENTS = Array.from({ length: 36 }, (_, i) => i + 1);

export function EntryForm(props: {
  /** Recorded for this event (its question at the end, or "add more"): tied to its pot from the start. */
  eventLink?: { eventId: string; eventDate: string };
  /** Opens a new calendar event on this day instead ("אירוע" on the first screen). */
  onNewEvent?: (date: string) => void;
  db: IDBDatabase;
  data: AppData;
  tx?: Transaction;
  /** Quick entry: answers the iPhone Shortcut already asked for; those steps are skipped. */
  preset?: QuickPreset;
  /** Shown because the app opened straight on a new entry: offer the way to the home screen instead of "cancel". */
  launch?: boolean;
  /** Reads what the iPhone Shortcut copied; resolves with a message to show when there was nothing usable. */
  onPaste?: () => Promise<string | void>;
  onClose: () => void;
  onSaved: (saved?: Transaction) => void | Promise<void>;
}) {
  const { data, tx } = props;
  const today = todayStr();
  // Hidden items stay available only for the transaction that already uses them
  const accounts = data.accounts.filter(a => a.name.trim() && (!a.archived || a.id === tx?.accountId || a.id === tx?.toAccountId));
  // Savings goals only take part in transfers: money moved into one leaves the liquid total
  const liquidAccounts = accounts.filter(a => a.kind !== 'goal');
  const goalAccounts = accounts.filter(a => a.kind === 'goal');
  const transferChips = (value: string | undefined, onChange: (id: string) => void, except?: string) => {
    const goals = goalAccounts.filter(a => a.id !== except);
    return (
      <>
        <Chips items={liquidAccounts.filter(a => a.id !== except)} value={value} onChange={onChange} />
        {goals.length > 0 && (
          <>
            <p class="field-label">יעדי חיסכון</p>
            <Chips items={goals} value={value} onChange={onChange} />
          </>
        )}
      </>
    );
  };
  const methods = data.methods.filter(m => m.name.trim() && (!m.archived || m.id === tx?.methodId));
  const defaultMethod = methods.find(m => m.id === data.lastMethodId && !m.archived);

  const preset = props.preset;
  const initialType = tx?.type ?? preset?.type ?? 'expense';
  const resolved = preset ? resolvePreset(preset, data) : undefined;
  const presetCategory = resolved?.category;
  const presetMethod = resolved?.method;
  const presetAccount = resolved?.account;

  const [type, setType] = useState<TxType>(initialType);
  const [amountText, setAmountText] = useState(tx ? moneyInputText(tx.amount) : preset?.amount ? moneyInputText(preset.amount) : '');
  const [categoryId, setCategoryId] = useState(tx?.categoryId ?? presetCategory?.id);
  // How it was paid: a payment method, or a savings goal the money comes straight out of
  const [methodId, setMethodId] = useState(tx?.methodId ?? (tx?.type === 'expense' ? tx.accountId : undefined) ?? presetMethod?.id ?? defaultMethod?.id);
  const [accountId, setAccountId] = useState(tx?.accountId ?? presetAccount?.id);
  const [toAccountId, setToAccountId] = useState(tx?.toAccountId);
  const [date, setDate] = useState(tx?.date ?? preset?.date ?? today);
  const future = date > today;
  // A transaction already dated ahead (from before this rule) can still be edited as it is
  const dateOk = !future || (!!tx && tx.date === date);
  const [installments, setInstallments] = useState(tx?.installments ?? 1);
  const [note, setNote] = useState(tx?.note ?? preset?.note ?? '');
  const [step, setStep] = useState<Step>(() => {
    if (tx) return 'review';
    if (!preset?.type) return 'type';
    // Start at the first question the Shortcut didn't answer
    const answered: Partial<Record<Step, boolean>> = {
      amount: !!preset?.amount,
      category: !!presetCategory,
      method: !!presetMethod,
      account: !!presetAccount,
    };
    return STEPS[initialType].find(s => s !== 'type' && !answered[s]) ?? 'review';
  });
  const [fromSummary, setFromSummary] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pasteMessage, setPasteMessage] = useState('');

  const amount = parseMoney(amountText) ?? 0;
  const baseSteps = STEPS[type];
  const categories = data.categories.filter(c => c.kind === type && c.name.trim() && (!c.archived || c.id === tx?.categoryId));
  const method = methods.find(m => m.id === methodId);
  const paidFromGoal = goalAccounts.some(g => g.id === methodId);
  // Events going on that day with an expected amount of this kind: what's recorded can go into one's pot
  const linkKey = (id: string, round: string) => `${id}|${round}`;
  // The event this is tied to already (opened for it, or an edited transaction that's part of one)
  const forced = props.eventLink ?? (tx?.eventId ? { eventId: tx.eventId, eventDate: tx.eventDate ?? tx.date } : undefined);
  const candidates = useMemo(() => {
    if (type === 'transfer') return [];
    const list = ongoingEvents(data.events, date, type).map(e => ({
      key: linkKey(e.id, timeRoundOf(e)),
      id: e.id,
      round: timeRoundOf(e),
      title: e.title,
      categoryId: e.categoryId,
      startTime: e.startTime,
      endTime: e.endTime,
    }));
    if (forced && !list.some(c => c.key === linkKey(forced.eventId, forced.eventDate))) {
      const ev = data.events.find(e => e.id === forced.eventId);
      if (ev) list.unshift({ key: linkKey(ev.id, forced.eventDate), id: ev.id, round: forced.eventDate, title: ev.title, categoryId: ev.categoryId, startTime: ev.startTime, endTime: ev.endTime });
    }
    // Recording for today: the event going on now first, then all-day ones, then the nearest in time
    if (date === today) {
      const now = new Date().getHours() * 60 + new Date().getMinutes();
      const mins = (t?: string) => (t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : 0);
      const rank = (x: (typeof list)[number]) => {
        if (!x.startTime) return 1;
        const start = mins(x.startTime);
        const end = x.endTime ? mins(x.endTime) : start + 60;
        return now >= start && now < end ? 0 : 2 + Math.min(Math.abs(now - start), Math.abs(now - end));
      };
      list.sort((a, b) => rank(a) - rank(b));
    }
    return list;
  }, [type, date, data.events, forced?.eventId, forced?.eventDate]);
  // undefined: the best fit (or the one this was opened for); null: none
  const [linkChoice, setLinkChoice] = useState<string | null | undefined>(forced ? linkKey(forced.eventId, forced.eventDate) : tx ? null : undefined);
  const linked = linkChoice === null ? undefined : candidates.find(c => c.key === linkChoice) ?? (linkChoice === undefined ? candidates[0] : undefined);
  // Chosen, then the date moved to a day without it
  const lostLink = typeof linkChoice === 'string' && !candidates.some(c => c.key === linkChoice);
  // With events that day, a question of its own right after the amount
  const steps: Step[] = candidates.length && !baseSteps.includes('event') ? [...baseSteps.slice(0, 2), 'event', ...baseSteps.slice(2)] : baseSteps;
  // What's tied to an event starts in the event's category, until a category is picked by hand
  const [categoryByHand, setCategoryByHand] = useState(!!tx || !!presetCategory);
  const [autoCategory, setAutoCategory] = useState<string | undefined>();
  useEffect(() => {
    if (categoryByHand) return;
    const next = linked?.categoryId;
    if (!categoryId || categoryId === autoCategory) setCategoryId(next);
    setAutoCategory(next);
  }, [linked?.key, categoryByHand]);
  const pickCategory = (id: string) => {
    setCategoryId(id);
    setCategoryByHand(true);
  };
  const isCredit = type === 'expense' && method?.kind === 'credit';
  // What the card's limit will have left once this purchase is saved (a purchase dated later doesn't use it yet)
  const usage = isCredit && method?.creditLimit ? cardUsage(data, today).find(u => u.card.id === method.id) : undefined;
  const alreadyCounted = tx && tx.methodId === methodId && tx.type === 'expense' && tx.date <= today ? tx.amount : 0;
  const limitLeft = usage?.available !== undefined && date <= today ? usage.available + alreadyCounted - amount : undefined;
  const name = (id?: string) => [...accounts, ...methods, ...categories].find(x => x.id === id)?.name ?? '';

  const valid =
    dateOk &&
    amount > 0 &&
    (type === 'expense' ? !!categoryId && !!methodId : type === 'income' ? !!categoryId && !!accountId : !!accountId && !!toAccountId && accountId !== toAccountId);

  // Choosing only marks the answer; "המשך" moves on in order, or straight back to the summary
  // when the step was opened by tapping one of the summary's rows
  // The day the "part of an event?" question was answered for (an edited transaction: its own day)
  const [askedOn, setAskedOn] = useState(tx || forced ? date : undefined);
  useEffect(() => {
    if (step === 'event') setAskedOn(date);
  }, [step]);
  const next = () => {
    // Moved to another day that has events: ask about them too, never link on its own
    if (step === 'when' && candidates.length && askedOn !== date) {
      setLinkChoice(undefined);
      setFromSummary(true);
      setStep('event');
      return;
    }
    const target = fromSummary ? 'review' : steps[steps.indexOf(step) + 1];
    setFromSummary(false);
    setStep(target);
  };
  // Always one step back in order; from the first step (or from the summary when editing) it closes
  const back = () => {
    const i = steps.indexOf(step);
    setFromSummary(false);
    if (i <= 0 || (tx && step === 'review')) props.onClose();
    else setStep(steps[i - 1]);
  };
  const change = (s: Step) => {
    setFromSummary(true);
    setStep(s);
  };

  const chooseType = (t: TxType) => {
    if (t === type) return;
    setType(t);
    setCategoryId(undefined);
    setCategoryByHand(false);
    // A different type asks different questions: go through them in order
    setFromSummary(false);
  };

  const canContinue: Partial<Record<Step, boolean>> = {
    type: !future || !!tx,
    amount: amount > 0,
    category: !!categoryId,
    method: !!methodId,
    account: !!accountId,
    from: !!accountId,
    to: !!toAccountId && toAccountId !== accountId,
    when: dateOk,
    event: true,
  };

  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    const now = new Date().toISOString();
    const record: Transaction = {
      id: tx?.id ?? crypto.randomUUID(),
      type,
      amount,
      date,
      note: note.trim() || undefined,
      createdAt: tx?.createdAt ?? now,
      updatedAt: now,
      // Editing a transaction a standing order recorded keeps it tied to that order, so it isn't counted twice
      ...(tx?.recurringId && type === tx.type && { recurringId: tx.recurringId, occurrence: tx.occurrence }),
      ...(type === 'expense' &&
        (paidFromGoal
          ? { categoryId, accountId: methodId }
          : { categoryId, methodId, installments: isCredit && installments > 1 ? installments : undefined })),
      ...(type === 'income' && { categoryId, accountId }),
      ...(type === 'transfer' && { accountId, toAccountId }),
      // Added to an event's pot (an edited transaction keeps the event it was part of)
      ...(linked ? { eventId: linked.id, eventDate: linked.round } : {}),
    };
    // Never leave the screen stuck on "saving": if anything fails, say what, and let it be tried again
    try {
      await putRecords(props.db, 'transactions', [record]);
      if (type === 'expense' && methodId && !paidFromGoal) await setMeta(props.db, 'lastMethodId', methodId);
      await props.onSaved(record);
    } catch (e) {
      setSaving(false);
      alert(`השמירה לא הצליחה: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const remove = async () => {
    if (!tx || !confirm('למחוק את התנועה?')) return;
    await deleteRecord(props.db, 'transactions', tx.id);
    props.onSaved();
  };

  const titles: Record<Step, string> = {
    type: 'מה רושמים?',
    amount: `כמה? (${TYPE_NAMES[type]})`,
    category: type === 'expense' ? 'על מה?' : 'מה נכנס?',
    method: 'איך שילמת?',
    account: 'לאן נכנס הכסף?',
    from: 'מאיפה הכסף יצא?',
    to: 'לאן הוא עבר?',
    when: 'מתי?',
    event: 'שייך לאירוע?',
    review: tx ? 'עריכה' : 'לסיום',
  };

  return (
    <div class="sheet wizard">
      <header class="top">
        <button class="link" onClick={back}>
          {step === 'type' || (tx && step === 'review') ? (props.launch ? 'למסך הראשי' : 'ביטול') : '→ חזרה'}
        </button>
        {props.launch && step === 'type' && <span class="muted small">{formatMoney(summarize(data, today).liquid)} נזיל</span>}
        {step !== 'type' && !(tx && step === 'review') && (
          <button class="link" onClick={props.onClose}>
            ביטול
          </button>
        )}
      </header>
      <div class="dots">
        {steps.map(s => (
          <span key={s} class={s === step ? 'on' : ''} />
        ))}
      </div>
      <h1 class="step-title">{titles[step]}</h1>

      {step === 'type' && future && !tx && (
        <p class="muted small future-note">{dayLabel(date, today)} עוד לא הגיע: אפשר לרשום אירוע עם צפי, ומה שיצא או נכנס בפועל נרשם כשהוא קורה.</p>
      )}
      {step === 'type' && (
        <div class="tiles">
          {!tx && props.onNewEvent && (
            <button class="tile event" onClick={() => props.onNewEvent!(date)}>
              אירוע
              <span class="small">עם צפי, שעות וחזרה · ללוח הזמנים</span>
            </button>
          )}
          {(['expense', 'income', 'transfer'] as const).filter(() => !future || !!tx).map(t => (
            <button key={t} class={`tile ${t} ${type === t ? 'on' : ''}`} onClick={() => chooseType(t)}>
              {TYPE_NAMES[t]}
              {t === 'transfer' && <span class="small">{goalAccounts.length ? 'בין בנק, מזומן, ביט ויעדים' : 'בין בנק, מזומן וביט'}</span>}
            </button>
          ))}
        </div>
      )}

      {step === 'amount' && (
        <div class={type}>
          <Keypad text={amountText} onChange={setAmountText} />
        </div>
      )}

      {step === 'event' && (
        <div class="event-step">
          <p class="muted small center">ביום הזה יש אירוע עם צפי. מה שתרשום לו ייצבר בקופה שלו.</p>
          <div class="tiles">
            {candidates.map(c => (
              <button key={c.key} class={`tile event-tile ${linked?.key === c.key ? 'on' : ''}`} onClick={() => setLinkChoice(c.key)}>
                {c.title}
                <span class="small">{c.startTime ? `${c.startTime}${c.endTime ? ` עד ${c.endTime === '24:00' ? 'סוף היום' : c.endTime}` : ''}` : 'כל היום'}</span>
              </button>
            ))}
            <button class={`tile ${!linked ? 'on' : ''}`} onClick={() => setLinkChoice(null)}>
              לא שייך לאירוע
            </button>
          </div>
        </div>
      )}

      {step === 'category' && <Chips items={categories} value={categoryId} onChange={pickCategory} />}

      {step === 'method' && (
        <>
          <Chips items={methods} value={methodId} onChange={setMethodId} />
          {goalAccounts.length > 0 && (
            <>
              <p class="field-label">מתוך יעד חיסכון</p>
              <Chips items={goalAccounts} value={methodId} onChange={setMethodId} />
            </>
          )}
        </>
      )}

      {step === 'account' && <Chips items={liquidAccounts} value={accountId} onChange={setAccountId} />}

      {step === 'from' && (
        <>
          {transferChips(accountId, setAccountId)}
          <p class="muted small">למשל משיכת מזומן מהכספומט, העברה מביט לבנק, או הפקדה ליעד חיסכון. זה לא הוצאה, הכסף רק עובר ממקום למקום.</p>
        </>
      )}

      {step === 'to' && transferChips(toAccountId, setToAccountId, accountId)}

      {step === 'when' && (
        <div class="when-step">
          <div class="when-box">
            <div class="when-label">{dayLabel(date, today)}</div>
            <div class="muted small">{date.split('-').reverse().map(Number).join('.')}</div>
          </div>
          <div class="chips when-chips">
            {[0, 1, 2].map(back => {
              const d = addDays(today, -back);
              return (
                <button key={d} type="button" class={`chip ${date === d ? 'on' : ''}`} onClick={() => setDate(d)}>
                  {dayLabel(d, today)}
                </button>
              );
            })}
            <input type="date" class="chip" max={today} value={date} onChange={e => e.currentTarget.value && setDate(e.currentTarget.value)} />
          </div>
          {!dateOk && <p class="small warn">אי אפשר לרשום תנועה בתאריך עתידי. לתאריך עתידי רושמים אירוע.</p>}
          {date < data.startDate && <p class="muted small">התאריך לפני תחילת המעקב, ולכן התנועה לא תשנה את היתרה (היא כבר כלולה ביתרת הפתיחה).</p>}
        </div>
      )}

      {step !== 'review' && !(step === 'type' && future && !tx) && (
        <button class="continue" disabled={!canContinue[step]} onClick={next}>
          המשך
        </button>
      )}

      {step === 'type' && !tx && props.onPaste && (
        <>
          <button
            class="secondary"
            onClick={async () => {
              setPasteMessage('');
              const problem = await props.onPaste!();
              if (problem) setPasteMessage(problem);
            }}
          >
            הוסף מהקיצור
          </button>
          {pasteMessage && <p class="small warn">{pasteMessage}</p>}
        </>
      )}

      {step === 'review' && (
        <>
          <div class="card list">
            <ReviewRow label="סוג" value={TYPE_NAMES[type]} onClick={() => change('type')} />
            <ReviewRow label="סכום" value={formatMoney(amount)} onClick={() => change('amount')} />
            {type !== 'transfer' && <ReviewRow label={type === 'expense' ? 'על מה' : 'מה נכנס'} value={name(categoryId)} onClick={() => change('category')} />}
            {type === 'expense' && <ReviewRow label="איך שילמת" value={name(methodId)} onClick={() => change('method')} />}
            {type === 'income' && <ReviewRow label="לאן נכנס" value={name(accountId)} onClick={() => change('account')} />}
            {type === 'transfer' && <ReviewRow label="מאיפה" value={name(accountId)} onClick={() => change('from')} />}
            {type === 'transfer' && <ReviewRow label="לאן" value={name(toAccountId)} onClick={() => change('to')} />}
            <ReviewRow label="מתי" value={dayLabel(date, today)} onClick={() => change('when')} />
            {candidates.length > 0 && <ReviewRow label="אירוע" value={linked ? linked.title : 'לא שייך'} onClick={() => change('event')} />}
          </div>
          {lostLink && <p class="small warn">ביום שנבחר אין את האירוע, אז השיוך הוסר.</p>}


          {isCredit && (
            <label class="field inline">
              <span>תשלומים</span>
              <select value={installments} onChange={e => setInstallments(Number(e.currentTarget.value))}>
                {INSTALLMENTS.map(n => (
                  <option key={n} value={n}>
                    {n === 1 ? 'תשלום אחד' : n}
                  </option>
                ))}
              </select>
              {installments > 1 && <span class="muted small">בערך {formatMoney(Math.floor(amount / installments))} לחודש</span>}
            </label>
          )}
          {limitLeft !== undefined && (
            <p class={`small ${limitLeft < 0 ? 'warn' : 'muted'}`}>
              {limitLeft < 0 ? `חורג מהמסגרת של ${method!.name} ב-${formatMoney(-limitLeft)}` : `יישאר פנוי במסגרת של ${method!.name}: ${formatMoney(limitLeft)}`}
            </p>
          )}


          <input type="text" class="note-input" placeholder="הערה (לא חובה)" value={note} onInput={e => setNote(e.currentTarget.value)} />

          <button disabled={!valid || saving} onClick={save}>
            שמור
          </button>
          {tx && (
            <button class="danger" onClick={remove}>
              מחק תנועה
            </button>
          )}
        </>
      )}
    </div>
  );
}

function ReviewRow(props: { label: string; value: string; onClick: () => void }) {
  return (
    <button class="tx" onClick={props.onClick}>
      <span class="muted">{props.label}</span>
      <span>
        {props.value} <span class="muted">‹</span>
      </span>
    </button>
  );
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'];

/** On-screen number pad: no waiting for the phone keyboard, and only valid amounts can be typed. */
function Keypad(props: { text: string; onChange: (update: (text: string) => string) => void }) {
  // Works from the latest text, so quick taps in a row are never lost
  const press = (k: string) =>
    props.onChange(t => {
      if (k === '⌫') return t.slice(0, -1);
      if (k === '.') return t.includes('.') ? t : (t || '0') + '.';
      if (/\.\d\d$/.test(t) || t.replace('.', '').length >= 9) return t;
      return t === '0' ? k : t + k;
    });
  const [whole, cents] = props.text.split('.');
  const display = props.text ? `${Number(whole || 0).toLocaleString('he-IL')}${cents !== undefined ? '.' + cents : ''}` : '0';

  return (
    <>
      <div class={`amount-display ${props.text ? '' : 'empty'}`}>
        <span class="currency">₪</span>
        {display}
      </div>
      <div class="keypad">
        {KEYS.map(k => (
          <button key={k} type="button" class="key" onClick={() => press(k)}>
            {k}
          </button>
        ))}
      </div>
    </>
  );
}

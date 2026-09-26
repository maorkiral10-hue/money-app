import { useState } from 'preact/hooks';
import { Chips } from '../components/inputs';
import { cardUsage } from '../data/balance';
import { deleteRecord, putRecords, setMeta } from '../data/db';
import { addDays, dayLabel, todayStr } from '../data/dates';
import { formatMoney, moneyInputText, parseMoney } from '../data/money';
import type { AppData } from '../data/store';
import type { Transaction, TxType } from '../data/types';

type Step = 'type' | 'amount' | 'category' | 'method' | 'account' | 'from' | 'to' | 'review';

export interface QuickPreset {
  amount?: number;
  /** Category and payment method (or account, for income) by name, as typed in the Shortcut. */
  category?: string;
  method?: string;
}

// One question per screen, each confirmed with "המשך"; the last screen shows everything before saving.
const STEPS: Record<TxType, Step[]> = {
  expense: ['type', 'amount', 'category', 'method', 'review'],
  income: ['type', 'amount', 'category', 'account', 'review'],
  transfer: ['type', 'amount', 'from', 'to', 'review'],
};

const TYPE_NAMES: Record<TxType, string> = { expense: 'הוצאה', income: 'הכנסה', transfer: 'העברה' };
const INSTALLMENTS = Array.from({ length: 36 }, (_, i) => i + 1);

export function EntryForm(props: {
  db: IDBDatabase;
  data: AppData;
  tx?: Transaction;
  /** Quick entry: skip the first question and start at the amount. */
  startType?: TxType;
  /** Quick entry: answers the iPhone Shortcut already asked for; those steps are skipped. */
  preset?: QuickPreset;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { data, tx } = props;
  const today = todayStr();
  // Hidden items stay available only for the transaction that already uses them
  const accounts = data.accounts.filter(a => a.name.trim() && (!a.archived || a.id === tx?.accountId || a.id === tx?.toAccountId));
  const methods = data.methods.filter(m => m.name.trim() && (!m.archived || m.id === tx?.methodId));
  const defaultMethod = methods.find(m => m.id === data.lastMethodId && !m.archived);

  const initialType = tx?.type ?? props.startType ?? 'expense';
  const preset = props.preset;
  const byName = <T extends { name: string; archived?: boolean }>(items: T[], name?: string) =>
    name ? items.find(i => !i.archived && i.name.trim() === name) : undefined;
  const presetCategory = byName(data.categories.filter(c => c.kind === initialType), preset?.category);
  const presetMethod = byName(methods, preset?.method);
  const presetAccount = byName(accounts, preset?.method);

  const [type, setType] = useState<TxType>(initialType);
  const [amountText, setAmountText] = useState(tx ? moneyInputText(tx.amount) : preset?.amount ? moneyInputText(preset.amount) : '');
  const [categoryId, setCategoryId] = useState(tx?.categoryId ?? presetCategory?.id);
  const [methodId, setMethodId] = useState(tx?.methodId ?? presetMethod?.id ?? defaultMethod?.id);
  const [accountId, setAccountId] = useState(tx?.accountId ?? presetAccount?.id);
  const [toAccountId, setToAccountId] = useState(tx?.toAccountId);
  const [date, setDate] = useState(tx?.date ?? today);
  const [installments, setInstallments] = useState(tx?.installments ?? 1);
  const [note, setNote] = useState(tx?.note ?? '');
  const [step, setStep] = useState<Step>(() => {
    if (tx) return 'review';
    if (!props.startType) return 'type';
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

  const amount = parseMoney(amountText) ?? 0;
  const steps = STEPS[type];
  const categories = data.categories.filter(c => c.kind === type && c.name.trim() && (!c.archived || c.id === tx?.categoryId));
  const method = methods.find(m => m.id === methodId);
  const isCredit = type === 'expense' && method?.kind === 'credit';
  // What the card's limit will have left once this purchase is saved (a purchase dated later doesn't use it yet)
  const usage = isCredit && method?.creditLimit ? cardUsage(data, today).find(u => u.card.id === method.id) : undefined;
  const alreadyCounted = tx && tx.methodId === methodId && tx.type === 'expense' && tx.date <= today ? tx.amount : 0;
  const limitLeft = usage?.available !== undefined && date <= today ? usage.available + alreadyCounted - amount : undefined;
  const name = (id?: string) => [...accounts, ...methods, ...categories].find(x => x.id === id)?.name ?? '';

  const valid =
    amount > 0 &&
    (type === 'expense' ? !!categoryId && !!methodId : type === 'income' ? !!categoryId && !!accountId : !!accountId && !!toAccountId && accountId !== toAccountId);

  // Choosing only marks the answer; "המשך" moves on in order, or straight back to the summary
  // when the step was opened by tapping one of the summary's rows
  const next = () => {
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
    // A different type asks different questions: go through them in order
    setFromSummary(false);
  };

  const canContinue: Partial<Record<Step, boolean>> = {
    type: true,
    amount: amount > 0,
    category: !!categoryId,
    method: !!methodId,
    account: !!accountId,
    from: !!accountId,
    to: !!toAccountId && toAccountId !== accountId,
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
      ...(type === 'expense' && { categoryId, methodId, installments: isCredit && installments > 1 ? installments : undefined }),
      ...(type === 'income' && { categoryId, accountId }),
      ...(type === 'transfer' && { accountId, toAccountId }),
    };
    await putRecords(props.db, 'transactions', [record]);
    if (type === 'expense' && methodId) await setMeta(props.db, 'lastMethodId', methodId);
    props.onSaved();
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
    review: tx ? 'עריכה' : 'לסיום',
  };

  return (
    <div class="sheet wizard">
      <header class="top">
        <button class="link" onClick={back}>
          {step === 'type' || (tx && step === 'review') ? 'ביטול' : '→ חזרה'}
        </button>
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

      {step === 'type' && (
        <div class="tiles">
          {(['expense', 'income', 'transfer'] as const).map(t => (
            <button key={t} class={`tile ${type === t ? 'on' : ''}`} onClick={() => chooseType(t)}>
              {TYPE_NAMES[t]}
              {t === 'transfer' && <span class="small">בין בנק, מזומן וביט</span>}
            </button>
          ))}
        </div>
      )}

      {step === 'amount' && <Keypad text={amountText} onChange={setAmountText} />}

      {step === 'category' && <Chips items={categories} value={categoryId} onChange={setCategoryId} />}

      {step === 'method' && <Chips items={methods} value={methodId} onChange={setMethodId} />}

      {step === 'account' && <Chips items={accounts} value={accountId} onChange={setAccountId} />}

      {step === 'from' && (
        <>
          <Chips items={accounts} value={accountId} onChange={setAccountId} />
          <p class="muted small">למשל משיכת מזומן מהכספומט, או העברה מביט לבנק. זה לא הוצאה, הכסף רק עובר ממקום למקום.</p>
        </>
      )}

      {step === 'to' && <Chips items={accounts.filter(a => a.id !== accountId)} value={toAccountId} onChange={setToAccountId} />}

      {step !== 'review' && (
        <button class="continue" disabled={!canContinue[step]} onClick={next}>
          המשך
        </button>
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
          </div>

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

          <section>
            <div class="chips">
              <button type="button" class={`chip ${date === today ? 'on' : ''}`} onClick={() => setDate(today)}>
                היום
              </button>
              <button type="button" class={`chip ${date === addDays(today, -1) ? 'on' : ''}`} onClick={() => setDate(addDays(today, -1))}>
                אתמול
              </button>
              <input type="date" class="chip" value={date} onChange={e => e.currentTarget.value && setDate(e.currentTarget.value)} />
            </div>
            {date !== today && date !== addDays(today, -1) && <p class="muted small">{dayLabel(date, today)}</p>}
            {date > today && <p class="muted small">תאריך עתידי: התנועה תופיע בצפי, ותיכנס ליתרה רק כשיגיע התאריך.</p>}
            {date < data.startDate && <p class="muted small">התאריך לפני תחילת המעקב, ולכן התנועה לא תשנה את היתרה (היא כבר כלולה ביתרת הפתיחה).</p>}
          </section>

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

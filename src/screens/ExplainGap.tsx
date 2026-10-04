import { useState } from 'preact/hooks';
import { Chips, MoneyInput } from '../components/inputs';
import { dayLabel, todayStr } from '../data/dates';
import { formatMoney } from '../data/money';
import { explainGap } from '../data/reconcile';
import type { AppData } from '../data/store';
import type { Transaction } from '../data/types';

/**
 * An unexplained gap from a balance check, opened from its line: "remembered what it was?" — an amount
 * (all of it or part), what it was for and when, and that part becomes an ordinary expense (or income)
 * while the gap shrinks by it. The balance doesn't move; only the explanation does.
 */
export function ExplainGap(props: {
  db: IDBDatabase;
  data: AppData;
  gap: Transaction;
  onClose: () => void;
  onSaved: (saved: Transaction) => void;
  /** Opens the gap's line as an ordinary transaction (to change or delete it). */
  onPlain: () => void;
}) {
  const { gap, data } = props;
  const today = todayStr();
  const income = gap.type === 'income';
  const [amount, setAmount] = useState(gap.amount);
  const [categoryId, setCategoryId] = useState<string>();
  const [date, setDate] = useState(gap.date);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const categories = data.categories.filter(c => c.kind === gap.type && c.name.trim() && !c.archived && c.id !== gap.categoryId);
  const place = data.accounts.find(a => a.id === (gap.methodId ? data.methods.find(m => m.id === gap.methodId)?.accountId : gap.accountId))?.name;
  const ok = amount > 0 && amount <= gap.amount && !!categoryId && !!date && date <= gap.date;

  const save = async () => {
    if (!ok || busy) return;
    setBusy(true);
    const now = new Date().toISOString();
    const t: Transaction = {
      id: crypto.randomUUID(),
      type: gap.type,
      amount,
      date,
      categoryId,
      ...(gap.methodId ? { methodId: gap.methodId } : { accountId: gap.accountId }),
      note: note.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await explainGap(props.db, gap, t.amount, { put: t });
      props.onSaved(t);
    } catch (e) {
      setBusy(false);
      alert(`השמירה לא הצליחה: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <>
      <header class="top">
        <h1>פער לא מזוהה</h1>
        <button class="link" onClick={props.onClose}>
          חזרה
        </button>
      </header>
      <div class="card">
        <h2>
          {formatMoney(gap.amount)} {income ? 'יותר' : 'פחות'} ממה שהיה רשום
        </h2>
        <p class="muted small">
          מהבדיקה מול {place} ({dayLabel(gap.date, today)}). נזכרת מה זה היה? רשום את זה כאן (את כל הסכום או חלק ממנו), והוא יעבור מ"לא מזוהה" למה שזה באמת. היתרה לא משתנה.
        </p>
      </div>
      <p class="field-label">כמה מזה</p>
      <MoneyInput value={amount} onChange={setAmount} />
      {amount > gap.amount && <p class="small warn">עד {formatMoney(gap.amount)}, גובה הפער</p>}
      <p class="field-label">{income ? 'מה נכנס?' : 'על מה?'}</p>
      <Chips items={categories} value={categoryId} onChange={setCategoryId} />
      <label class="field">
        <span>מתי זה היה (עד יום הבדיקה)</span>
        <input type="date" value={date} max={gap.date} onInput={e => setDate(e.currentTarget.value)} />
      </label>
      <input type="text" class="note-input" placeholder="הערה (לא חובה), למשל: רופא שיניים" value={note} onInput={e => setNote(e.currentTarget.value)} />
      <p class="muted small">
        {ok && (gap.amount - amount > 0 ? `יישאר לא מזוהה: ${formatMoney(gap.amount - amount)}` : 'הפער ייסגר לגמרי.')}
      </p>
      <button disabled={!ok || busy} onClick={save}>
        לשמור
      </button>
      <button class="link small" onClick={props.onPlain}>
        עריכה רגילה של השורה (לשנות או למחוק)
      </button>
    </>
  );
}

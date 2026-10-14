import { useState } from 'preact/hooks';
import { addDays, dayLabel, todayStr } from '../data/dates';
import { run } from '../data/db';
import { formatMoney } from '../data/money';
import { nextOccurrence } from '../data/recurring';
import { saveRecurring, type AppData } from '../data/store';
import type { Recurring } from '../data/types';

const kindName = (rec: Recurring) => (rec.type === 'expense' ? 'הוראת הקבע' : 'ההכנסה הקבועה');

/** A pop-up asking to confirm something that changes a standing order, saying exactly what will happen. */
function Sheet(props: { title: string; children: preact.ComponentChildren }) {
  return (
    <div class="event-popup" role="dialog" aria-modal="true">
      <div class="event-popup-backdrop" />
      <div class="card pending event-popup-card rec-sheet">
        <h2>{props.title}</h2>
        {props.children}
      </div>
    </div>
  );
}

/**
 * Stopping a standing order that really ended (a subscription cancelled): what was recorded stays in its
 * months, nothing is recorded from the chosen time on. It can be started again later.
 */
export function StopSheet(props: { db: IDBDatabase; data: AppData; rec: Recurring; onDone: () => void; onCancel: () => void }) {
  const { rec } = props;
  const today = todayStr();
  const next = nextOccurrence(rec, today);
  const [from, setFrom] = useState(next ?? today);
  const last = props.data.transactions
    .filter(t => t.recurringId === rec.id)
    .sort((a, b) => (b.occurrence ?? b.date).localeCompare(a.occurrence ?? a.date))[0];
  return (
    <Sheet title={`להפסיק את "${rec.name}"?`}>
      {last && (
        <p class="small">
          הפעם האחרונה שנרשמה: {dayLabel(last.occurrence ?? last.date, today)} ({formatMoney(last.amount)}).
        </p>
      )}
      <label class="field">
        <span>מתי להפסיק</span>
        <input type="date" value={from} min={today} onInput={e => e.currentTarget.value && setFrom(e.currentTarget.value)} />
      </label>
      <p class="small">
        {from === next ? `מהפעם הבאה (${dayLabel(from, today)})` : `מ־${dayLabel(from, today)}`} {kindName(rec)} לא תירשם יותר. מה שכבר נרשם נשאר בחודשים שלו. אפשר להפעיל אותה מחדש בכל זמן.
      </p>
      <div class="hero-buttons">
        <button
          onClick={async () => {
            await saveRecurring(props.db, { ...rec, endDate: addDays(from, -1) });
            props.onDone();
          }}
        >
          כן, להפסיק
        </button>
        <button class="secondary" onClick={props.onCancel}>
          ביטול
        </button>
      </div>
    </Sheet>
  );
}

/**
 * Deleting a standing order that shouldn't have been there (added by mistake): it goes, and the transactions
 * it already recorded either stay as ordinary ones or go with it — the user's choice.
 */
export function DeleteSheet(props: { db: IDBDatabase; data: AppData; rec: Recurring; onDone: () => void; onCancel: () => void }) {
  const { rec } = props;
  const recorded = props.data.transactions.filter(t => t.recurringId === rec.id);
  const total = recorded.reduce((a, t) => a + t.amount, 0);
  const remove = async (withTransactions: boolean) => {
    await run(props.db, ['recurring', 'transactions'], 'readwrite', tx => {
      tx.objectStore('recurring').delete(rec.id);
      if (withTransactions) recorded.forEach(t => tx.objectStore('transactions').delete(t.id));
    });
    props.onDone();
  };
  return (
    <Sheet title={`למחוק את "${rec.name}"?`}>
      <p class="muted small">מחיקה היא להוראה שנוספה בטעות. אם היא הייתה אמיתית ונגמרה, עדיף "להפסיק": כך היא נשארת ב"הסתיימו".</p>
      {recorded.length > 0 ? (
        <>
          <p class="small">
            היא כבר נרשמה {recorded.length === 1 ? 'פעם אחת' : `${recorded.length} פעמים`} ({formatMoney(total)}).
          </p>
          <div class="gap-actions">
            <button onClick={() => remove(false)}>
              למחוק רק את ההוראה ({recorded.length === 1 ? 'הפעולה תישאר' : `${recorded.length} הפעולות יישארו`})
            </button>
            <button class="secondary danger-text" onClick={() => remove(true)}>
              למחוק גם {recorded.length === 1 ? 'את הפעולה (נרשמה בטעות)' : `את ${recorded.length} הפעולות (נרשמו בטעות)`}
            </button>
          </div>
        </>
      ) : (
        <div class="gap-actions">
          <button onClick={() => remove(false)}>כן, למחוק</button>
        </div>
      )}
      <button class="link small event-popup-later" onClick={props.onCancel}>
        ביטול
      </button>
    </Sheet>
  );
}

/** A changed amount (a subscription that went up): from the next time on, never what was already recorded. */
export function AmountChangeSheet(props: { rec: Recurring; amount: number; onConfirm: () => void; onCancel: () => void }) {
  const today = todayStr();
  const next = nextOccurrence(props.rec, today);
  return (
    <Sheet title={`לשנות את הסכום ל־${formatMoney(props.amount)}?`}>
      <p class="small">
        השינוי יחול {next ? `מהפעם הבאה (${dayLabel(next, today)})` : 'מהפעם הבאה'}. מה שכבר נרשם ({formatMoney(props.rec.amount)}) לא משתנה.
      </p>
      <div class="hero-buttons">
        <button onClick={props.onConfirm}>כן, לשמור</button>
        <button class="secondary" onClick={props.onCancel}>
          ביטול
        </button>
      </div>
    </Sheet>
  );
}

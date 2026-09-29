import { useState } from 'preact/hooks';
import { dayLabel, todayStr } from '../data/dates';
import { estimateFor } from '../data/recurring';
import { resolveOccurrence, saveRecurring, type AppData } from '../data/store';
import type { Recurring } from '../data/types';
import { MoneyInput } from './inputs';

/**
 * A pop-up on the day a standing order with a changing amount (electricity, water) comes round: how much
 * really went out (or came in)? It isn't guessed or recorded until answered, and it keeps coming back —
 * only "remind me in half an hour" puts it off a while. "Didn't happen this month" offers to end the order.
 * It never shows over the entry form, so recording something else is never in the way.
 */
export function VariableDueCard(props: {
  db: IDBDatabase;
  data: AppData;
  rec: Recurring;
  occurrence: string;
  more: number;
  onSnooze: () => void;
  onDone: () => void;
}) {
  const { rec } = props;
  const income = rec.type === 'income';
  // The estimate, if one was set, is only a starting point for the answer
  const [amount, setAmount] = useState(estimateFor(rec, props.data.transactions));
  const [busy, setBusy] = useState(false);
  const [askEnd, setAskEnd] = useState(false);

  const record = async () => {
    setBusy(true);
    await resolveOccurrence(props.db, rec, props.occurrence, amount);
    props.onDone();
  };
  const notThisMonth = async () => {
    setBusy(true);
    await resolveOccurrence(props.db, rec, props.occurrence, null);
    setBusy(false);
    setAskEnd(true);
  };
  const end = async (yes: boolean) => {
    if (yes) await saveRecurring(props.db, { ...rec, handledThrough: props.occurrence, endDate: props.occurrence });
    props.onDone();
  };

  return (
    <div class="event-popup" role="dialog" aria-modal="true">
      <div class="event-popup-backdrop" />
      <div class="card pending event-popup-card">
        <div class="muted small">
          {income ? 'הכנסה קבועה' : 'הוראת קבע'} בסכום משתנה · {dayLabel(props.occurrence, todayStr())}
          {props.more > 0 && ` · ועוד ${props.more} ממתינות`}
        </div>
        {askEnd ? (
          <>
            <h2>לבטל את "{rec.name}"?</h2>
            <p class="muted small">אם תבטל, היא לא תופיע יותר. אם לא, היא תחזור בחודש הבא כרגיל.</p>
            <div class="hero-buttons">
              <button onClick={() => end(true)}>כן, לבטל</button>
              <button class="secondary" onClick={() => end(false)}>
                לא, להשאיר
              </button>
            </div>
          </>
        ) : (
          <>
            <h2>
              {rec.name}: כמה {income ? 'נכנס' : 'ירד'} בפועל?
            </h2>
            <MoneyInput value={amount} onChange={setAmount} />
            <div class="hero-buttons">
              <button disabled={busy || amount <= 0} onClick={record}>
                אישור
              </button>
              <button class="secondary" disabled={busy} onClick={notThisMonth}>
                {income ? 'לא נכנס החודש' : 'לא ירד החודש'}
              </button>
            </div>
            <button class="link small event-popup-later" onClick={props.onSnooze}>
              תזכיר לי בעוד חצי שעה
            </button>
          </>
        )}
      </div>
    </div>
  );
}

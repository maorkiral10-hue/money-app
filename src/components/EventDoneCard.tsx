import { useState } from 'preact/hooks';
import { withAnswer } from '../data/calendar';
import { dayLabel, todayStr } from '../data/dates';
import { putRecords } from '../data/db';
import type { CalendarEvent } from '../data/types';
import { formatMoney } from '../data/money';
import { MoneyInput } from './inputs';

/**
 * A pop-up once a calendar event with an expected amount is over: "The wedding is over: how much did it
 * cost in the end?" (or bring in). Recording it goes through the usual entry form (category and how it
 * was paid still to choose). "Later" puts it off until the app is next opened.
 */
export function EventDoneCard(props: {
  db: IDBDatabase;
  /** This time round (for a repeating event, one of its days). */
  event: CalendarEvent;
  /** The event as saved, which holds the answers. */
  series: CalendarEvent;
  more: number;
  onRecord: (event: CalendarEvent, amount: number) => void;
  /** What was recorded into the event while it went on (0: nothing). */
  pot: number;
  /** Record another expense (or income) into the pot. */
  onAddMore: (event: CalendarEvent) => void;
  onLater: () => void;
  onDone: () => void;
}) {
  const e = props.event;
  const [amount, setAmount] = useState(e.amount);
  const [busy, setBusy] = useState(false);
  const income = e.type === 'income';

  const nothing = async () => {
    setBusy(true);
    await putRecords(props.db, 'events', [withAnswer(props.series, e.date, { at: new Date().toISOString() })]);
    props.onDone();
  };

  return (
    <div class="event-popup" role="dialog" aria-modal="true">
      <div class="event-popup-backdrop" onClick={props.onLater} />
      <div class="card pending event-popup-card">
        <div class="muted small">
          לוח זמנים · {dayLabel(e.date, todayStr())}
          {props.more > 0 && ` · ועוד ${props.more} ממתינים`}
        </div>
        {props.pot > 0 ? (
          <>
            <h2>
              {e.title} נגמר: {income ? 'נכנס' : 'יצא'} בסך הכל {formatMoney(props.pot)}
            </h2>
            {e.amount > 0 && <p class="muted small">הצפי היה {formatMoney(e.amount)}</p>}
            <div class="hero-buttons">
              {/* Closing it keeps what's in the pot as what it came to */}
              <button disabled={busy} onClick={nothing}>
                זה הכל
              </button>
              <button class="secondary" disabled={busy} onClick={() => props.onAddMore(e)}>
                להוסיף עוד {income ? 'הכנסה' : 'הוצאה'}
              </button>
            </div>
          </>
        ) : (
          <>
            <h2>
              {e.title} נגמר: כמה {income ? 'נכנס' : 'הוצאת'} בסוף?
            </h2>
            <MoneyInput value={amount} onChange={setAmount} />
            <div class="hero-buttons">
              <button disabled={busy || amount <= 0} onClick={() => props.onRecord(e, amount)}>
                לרשום
              </button>
              <button class="secondary" disabled={busy} onClick={nothing}>
                {income ? 'לא נכנס כלום' : 'לא הוצאתי כלום'}
              </button>
            </div>
          </>
        )}
        <button class="link small event-popup-later" onClick={props.onLater}>
          אחר כך
        </button>
      </div>
    </div>
  );
}

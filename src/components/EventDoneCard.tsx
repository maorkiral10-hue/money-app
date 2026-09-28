import { useState } from 'preact/hooks';
import { dayLabel, todayStr } from '../data/dates';
import { putRecords } from '../data/db';
import type { CalendarEvent } from '../data/types';
import { MoneyInput } from './inputs';

/**
 * A pop-up once a calendar event with an expected amount is over: "The wedding is over: how much did it
 * cost in the end?" (or bring in). Recording it goes through the usual entry form (category and how it
 * was paid still to choose). "Later" puts it off until the app is next opened.
 */
export function EventDoneCard(props: {
  db: IDBDatabase;
  event: CalendarEvent;
  more: number;
  onRecord: (event: CalendarEvent, amount: number) => void;
  onLater: () => void;
  onDone: () => void;
}) {
  const e = props.event;
  const [amount, setAmount] = useState(e.amount);
  const [busy, setBusy] = useState(false);
  const income = e.type === 'income';

  const nothing = async () => {
    setBusy(true);
    const settled: CalendarEvent = { ...e, settled: { at: new Date().toISOString() } };
    await putRecords(props.db, 'events', [settled]);
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
        <button class="link small event-popup-later" onClick={props.onLater}>
          אחר כך
        </button>
      </div>
    </div>
  );
}

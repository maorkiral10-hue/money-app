import { useState } from 'preact/hooks';
import { addDays, dayLabel, parseDate, todayStr } from '../data/dates';
import { estimateFor } from '../data/recurring';
import { recordEarly, type AppData } from '../data/store';
import type { Recurring } from '../data/types';
import { MoneyInput } from './inputs';

const shortDate = (s: string) => {
  const { m0, d } = parseDate(s);
  return `${d}.${m0 + 1}`;
};

/**
 * A standing order or fixed income that came before its day (a salary in a day early): record it now with
 * the real amount and day. That time round is then done — nothing is recorded again on the day, and no
 * "how much?" question comes up then.
 */
export function EarlyRecordCard(props: { db: IDBDatabase; data: AppData; rec: Recurring; occurrence: string; onClose: () => void; onDone: () => void }) {
  const { rec } = props;
  const today = todayStr();
  const income = rec.type === 'income';
  const [amount, setAmount] = useState(estimateFor(rec, props.data.transactions));
  const [date, setDate] = useState(today);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    await recordEarly(props.db, rec, props.occurrence, amount, date);
    props.onDone();
  };

  return (
    <div class="event-popup" role="dialog" aria-modal="true">
      <div class="event-popup-backdrop" onClick={props.onClose} />
      <div class="card pending event-popup-card">
        <div class="muted small">
          {income ? 'הכנסה קבועה' : 'הוראת קבע'} · אמורה {income ? 'להיכנס' : 'לרדת'} ב־{shortDate(props.occurrence)}
        </div>
        <h2>
          {rec.name}: {income ? 'נכנסה' : 'ירדה'} כבר?
        </h2>
        <MoneyInput value={amount} onChange={setAmount} />
        <div class="chips early-days">
          {[0, 1, 2].map(back => {
            const d = addDays(today, -back);
            return (
              <button key={d} type="button" class={`chip ${date === d ? 'on' : ''}`} onClick={() => setDate(d)}>
                {dayLabel(d, today)}
              </button>
            );
          })}
        </div>
        <p class="muted small">ביום עצמו היא לא תירשם שוב ולא תקפוץ שאלה עליה.</p>
        <div class="hero-buttons">
          <button disabled={busy || amount <= 0} onClick={save}>
            לרשום עכשיו
          </button>
          <button class="secondary" disabled={busy} onClick={props.onClose}>
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
}

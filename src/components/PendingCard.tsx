import { useState } from 'preact/hooks';
import { dayLabel, todayStr } from '../data/dates';
import { estimateFor } from '../data/recurring';
import { resolveOccurrence, type AppData } from '../data/store';
import type { Recurring } from '../data/types';
import { MoneyInput } from './inputs';

/** "Your salary was due on the 10th: how much came in?" for a variable recurring item. */
export function PendingCard(props: { db: IDBDatabase; data: AppData; rec: Recurring; occurrence: string; more: number; onDone: () => void }) {
  const { rec } = props;
  const [amount, setAmount] = useState(estimateFor(rec, props.data.transactions));
  const [busy, setBusy] = useState(false);

  const resolve = async (value: number | null) => {
    setBusy(true);
    await resolveOccurrence(props.db, rec, props.occurrence, value);
    props.onDone();
  };

  return (
    <div class="card pending">
      <div class="muted small">
        {dayLabel(props.occurrence, todayStr())}
        {props.more > 0 && ` · ועוד ${props.more} ממתינים`}
      </div>
      <h2>
        {rec.name}: כמה {rec.type === 'income' ? 'נכנס' : 'ירד'} בפועל?
      </h2>
      <MoneyInput value={amount} onChange={setAmount} />
      <div class="hero-buttons">
        <button disabled={busy || amount <= 0} onClick={() => resolve(amount)}>
          אישור
        </button>
        <button class="secondary" disabled={busy} onClick={() => resolve(null)}>
          לא {rec.type === 'income' ? 'נכנס' : 'ירד'} הפעם
        </button>
      </div>
    </div>
  );
}

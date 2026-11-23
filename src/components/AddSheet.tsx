import { useEffect, useState } from 'preact/hooks';
import { dayLabel } from '../data/dates';
import type { TxType } from '../data/types';

/**
 * What the "+" opens: a sheet rising from the bottom, "what are you recording?". A choice goes on to the
 * form with that type already chosen; a day that hasn't come yet can only get an event.
 */
export function AddSheet(props: {
  open: boolean;
  /** The day it's for (the one chosen on the home screen), and today. */
  date: string;
  today: string;
  onClose: () => void;
  onPick: (type: TxType) => void;
  onEvent: () => void;
}) {
  // Kept on screen while it slides away
  const [shown, setShown] = useState(props.open);
  useEffect(() => {
    if (props.open) setShown(true);
    else {
      const t = setTimeout(() => setShown(false), 380);
      return () => clearTimeout(t);
    }
  }, [props.open]);
  if (!shown) return null;
  const future = props.date > props.today;
  return (
    <div class={`add-sheet ${props.open ? 'open' : ''}`}>
      <div class="add-sheet-backdrop" onClick={props.onClose} />
      <div class="add-sheet-panel" role="dialog" aria-label="מה רושמים?">
        <span class="add-sheet-grip" />
        <h2>מה רושמים?</h2>
        {props.date !== props.today && <p class="muted small">ל{dayLabel(props.date, props.today)}</p>}
        {future && <p class="muted small">היום הזה עוד לא הגיע: אפשר לרשום אירוע עם צפי.</p>}
        <div class="add-sheet-grid">
          {!future && (
            <>
              <button class="add-choice expense" onClick={() => props.onPick('expense')}>
                הוצאה
              </button>
              <button class="add-choice income" onClick={() => props.onPick('income')}>
                הכנסה
              </button>
              <button class="add-choice" onClick={() => props.onPick('transfer')}>
                העברה
              </button>
            </>
          )}
          <button class="add-choice" onClick={props.onEvent}>
            אירוע
          </button>
        </div>
      </div>
    </div>
  );
}

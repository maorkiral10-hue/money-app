import { useEffect, useRef, useState } from 'preact/hooks';
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
  // On screen while it slides in and away; "up" turns on a frame after it's drawn closed, so it rises
  const [shown, setShown] = useState(props.open);
  const [up, setUp] = useState(false);
  const [pull, setPull] = useState(0);
  const start = useRef<number | null>(null);
  useEffect(() => {
    if (props.open) {
      setShown(true);
      setPull(0);
      const f = requestAnimationFrame(() => requestAnimationFrame(() => setUp(true)));
      const t = setTimeout(() => setUp(true), 60);
      return () => {
        cancelAnimationFrame(f);
        clearTimeout(t);
      };
    }
    setUp(false);
    const t = setTimeout(() => setShown(false), 420);
    return () => clearTimeout(t);
  }, [props.open]);
  if (!shown) return null;
  const future = props.date > props.today;
  return (
    <div class={`add-sheet ${up ? 'open' : ''}`}>
      <div class="add-sheet-backdrop" onClick={props.onClose} />
      <div
        class={`add-sheet-panel ${start.current !== null ? 'dragging' : ''}`}
        role="dialog"
        aria-label="מה רושמים?"
        style={pull && up ? { transform: `translateY(${pull}px)` } : undefined}
        // Pulled down far enough, it closes; otherwise it springs back
        onTouchStart={e => (start.current = e.touches[0].clientY)}
        onTouchMove={e => {
          if (start.current === null) return;
          setPull(Math.max(0, e.touches[0].clientY - start.current));
        }}
        onTouchEnd={() => {
          start.current = null;
          if (pull > 90) props.onClose();
          else setPull(0);
        }}
      >
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

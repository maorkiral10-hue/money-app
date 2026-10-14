import { dayLabel, todayStr } from '../data/dates';
import { formatMoney } from '../data/money';
import type { OpenCardGap } from '../data/cardCheck';

/** Once, two days before the charge: a card's gap from the weekly check is still open. */
export function CardGapReminder(props: { gap: OpenCardGap; onRecheck: () => void; onDone: () => void }) {
  const { gap } = props;
  const today = todayStr();
  return (
    <div class="event-popup" role="dialog" aria-modal="true">
      <div class="event-popup-backdrop" />
      <div class="card pending event-popup-card open-gap">
        <div class="muted small">כרטיס אשראי · חיוב {dayLabel(gap.chargeDate, today)}</div>
        <h2>
          ב{gap.card.name} נשאר פער פתוח של {formatMoney(Math.abs(gap.left))}
        </h2>
        <p class="muted small">
          מהבדיקה מ{dayLabel(gap.check.date, today)}. ביום החיוב תסגור אותו בבדיקה הסופית. אם בינתיים הקנייה כבר הגיעה לחברת האשראי, בדיקה חוזרת תראה.
        </p>
        <div class="gap-actions">
          <button onClick={props.onRecheck}>לבדוק שוב עכשיו</button>
          <button class="secondary" onClick={props.onDone}>
            הבנתי
          </button>
        </div>
      </div>
    </div>
  );
}

import { dayLabel, todayStr } from '../data/dates';
import { formatMoney } from '../data/money';
import type { OpenGap } from '../data/reconcile';

/** Days from today to a date, for "עוד יומיים". */
const daysTo = (d: string, today: string) => Math.round((Date.UTC(...(d.split('-').map(Number) as [number, number, number])) - Date.UTC(...(today.split('-').map(Number) as [number, number, number]))) / 86_400_000);

export const whenRecorded = (g: OpenGap, today: string) => {
  const n = daysTo(g.until, today);
  return n <= 0 ? 'יירשם כלא מזוהה הלילה' : n === 1 ? 'יירשם כלא מזוהה מחר' : n === 2 ? 'יירשם כלא מזוהה בעוד יומיים' : `יירשם כלא מזוהה בעוד ${n} ימים`;
};

/**
 * A gap left open after a check: how much of it is still missing, a bar of how much was found, and what
 * to do — record something remembered (the source and the amount already filled in), check again, or
 * record what's left as unexplained now. Just after something made it smaller, it says so.
 */
export function OpenGapCard(props: {
  gap: OpenGap;
  /** It just got smaller: from how much. */
  droppedFrom?: number;
  more: number;
  onAdd: () => void;
  onRecheck: () => void;
  onRecordNow: () => void;
  onLater: () => void;
}) {
  const { gap } = props;
  const today = todayStr();
  const found = Math.abs(gap.found);
  const left = Math.abs(gap.left);
  // Moved the wrong way (something recorded twice?): nothing found yet
  const share = found ? Math.max(0, Math.min(1, 1 - left / found)) : 0;
  const less = gap.left < 0;
  return (
    <div class="event-popup" role="dialog" aria-modal="true">
      <div class="event-popup-backdrop" />
      <div class="card pending event-popup-card open-gap">
        <div class="muted small">
          פער פתוח · בדיקה מול {gap.account.name} ({dayLabel(gap.check.date, today)})
          {props.more > 0 && ` · ועוד ${props.more}`}
        </div>
        {props.droppedFrom !== undefined ? (
          <h2 class="inc">
            הפער ירד! {formatMoney(props.droppedFrom)} ← {formatMoney(left)}
          </h2>
        ) : (
          <h2>
            {less ? 'חסרים' : 'יש עודף של'} {formatMoney(left)} ב{gap.account.name}
          </h2>
        )}
        <div class="bar gap-bar">
          <span style={{ width: `${share * 100}%` }} />
        </div>
        <p class="muted small">
          {share > 0 ? `מצאת ${Math.round(share * 100)}% מהפער · ` : ''}
          {whenRecorded(gap, today)}
        </p>
        <p class="small">{less ? 'נזכר בהוצאה מלפני הבדיקה?' : 'נזכר בהכנסה מלפני הבדיקה?'}</p>
        <div class="gap-actions">
          <button onClick={props.onAdd}>{less ? '+ לרשום הוצאה' : '+ לרשום הכנסה'}</button>
          <button class="secondary" onClick={props.onRecheck}>
            לבדוק שוב עכשיו
          </button>
          <button class="secondary" onClick={props.onRecordNow}>
            לא אמצא: לרשום {formatMoney(left)} כלא מזוהה
          </button>
        </div>
        <button class="link small event-popup-later" onClick={props.onLater}>
          אחר כך
        </button>
      </div>
    </div>
  );
}

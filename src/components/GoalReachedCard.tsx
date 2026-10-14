import { useState } from 'preact/hooks';
import { formatMoney } from '../data/money';
import type { Account } from '../data/types';
import { Chips } from './inputs';

/**
 * A goal with a target got more than it needed (by hand, or a deposit made on its own): what to do with the
 * extra — keep it in the goal (the target grows with it), put it back into the liquid money, or move it to
 * another goal.
 */
export function GoalReachedCard(props: {
  goal: Account;
  surplus: number;
  others: Account[];
  onKeep: () => void;
  onBack: () => void;
  onMove: (to: Account) => void;
  onLater: () => void;
}) {
  const [moving, setMoving] = useState(false);
  const [to, setTo] = useState<string>();
  const inside = props.goal.goalPlace === 'inside';
  return (
    <div class="event-popup" role="dialog" aria-modal="true">
      <div class="event-popup-backdrop" />
      <div class="card pending event-popup-card open-gap">
        <h2>🎉 הגעת ליעד "{props.goal.name}"!</h2>
        <p>
          יש ביעד {formatMoney(props.surplus)} מעבר ל־{formatMoney(props.goal.goalTarget ?? 0)}. מה לעשות איתם?
        </p>
        {moving ? (
          <>
            <Chips items={props.others} value={to} onChange={setTo} />
            <div class="hero-buttons">
              <button disabled={!to} onClick={() => props.onMove(props.others.find(o => o.id === to)!)}>
                להעביר
              </button>
              <button class="secondary" onClick={() => setMoving(false)}>
                חזרה
              </button>
            </div>
          </>
        ) : (
          <div class="gap-actions">
            <button onClick={props.onKeep}>להשאיר ביעד (היעד יגדל ל־{formatMoney((props.goal.goalTarget ?? 0) + props.surplus)})</button>
            <button class="secondary" onClick={props.onBack}>
              {inside ? 'לשחרר אותם (חוזרים להיות פנויים)' : 'להחזיר לכסף הנזיל'}
            </button>
            {props.others.length > 0 && (
              <button class="secondary" onClick={() => setMoving(true)}>
                להעביר ליעד אחר
              </button>
            )}
          </div>
        )}
        <button class="link small event-popup-later" onClick={props.onLater}>
          אחר כך
        </button>
      </div>
    </div>
  );
}

import { formatMoney } from '../data/money';
import type { Account, Transaction } from '../data/types';

/**
 * Just recorded something on account of a goal, paid with other money: take the money for it out of what's
 * in the goal ("מהכסף שבצד" — it goes back to where the goal's money really is), or leave the goal as it is
 * ("מהכסף היומיומי").
 */
export function GoalPayCard(props: { goal: Account; inGoal: number; paid: Transaction; method?: string; onFromGoal: () => void; onFromDaily: () => void }) {
  const { goal, paid } = props;
  const take = Math.min(paid.amount, props.inGoal);
  return (
    <div class="event-popup" role="dialog" aria-modal="true">
      <div class="event-popup-backdrop" />
      <div class="card pending event-popup-card open-gap">
        <h2>
          רשמת {formatMoney(paid.amount)}{props.method ? ` (${props.method})` : ''} על חשבון "{goal.name}"
        </h2>
        <p>ביעד יש {formatMoney(props.inGoal)}. מאיפה לקחת את הכסף?</p>
        <div class="gap-actions">
          <button disabled={take <= 0} onClick={props.onFromGoal}>
            מהכסף שבצד{take > 0 ? `: ביעד יישארו ${formatMoney(props.inGoal - take)}` : ''}
          </button>
          <button class="secondary" onClick={props.onFromDaily}>
            מהכסף היומיומי: ביעד יישארו {formatMoney(props.inGoal)}
          </button>
        </div>
        <p class="muted small">בשני המקרים זה נספר ב"שולם על היעד".</p>
      </div>
    </div>
  );
}

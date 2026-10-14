import { useState } from 'preact/hooks';
import { dayLabel, todayStr } from '../data/dates';
import { formatMoney } from '../data/money';
import type { Account } from '../data/types';
import { Chips } from './inputs';

/**
 * The day of a goal's monthly deposit, when nothing makes it happen on its own: put the money in (or set it
 * aside, for a goal inside a source), skip this month, or later.
 */
export function GoalDepositCard(props: {
  goal: Account;
  date: string;
  sources: Account[];
  more: number;
  onDone: (fromId?: string) => void;
  onSkip: () => void;
  onLater: () => void;
}) {
  const { goal } = props;
  const inside = goal.goalPlace === 'inside';
  const [from, setFrom] = useState(goal.goalPlace === 'envelope' ? props.sources.find(a => a.kind === 'cash')?.id : props.sources.find(a => a.kind === 'bank')?.id ?? props.sources[0]?.id);
  return (
    <div class="event-popup" role="dialog" aria-modal="true">
      <div class="event-popup-backdrop" />
      <div class="card pending event-popup-card open-gap">
        <div class="muted small">
          הפקדה קבועה · {dayLabel(props.date, todayStr())}
          {props.more > 0 && ` · ועוד ${props.more}`}
        </div>
        <h2>
          {inside ? 'הגיע הזמן לשמור' : 'הגיע הזמן להפקיד'} {formatMoney(goal.goalEveryAmount ?? 0)} ל{goal.name}
        </h2>
        {!inside && (
          <>
            <p class="field-label">מאיפה</p>
            <Chips items={props.sources} value={from} onChange={setFrom} />
          </>
        )}
        <div class="gap-actions">
          <button onClick={() => props.onDone(inside ? goal.goalSource : from)}>{inside ? 'שמרתי' : 'הפקדתי'}</button>
          <button class="secondary" onClick={props.onSkip}>
            לא החודש
          </button>
        </div>
        <button class="link small event-popup-later" onClick={props.onLater}>
          אחר כך
        </button>
      </div>
    </div>
  );
}

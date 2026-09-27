import { useState } from 'preact/hooks';
import type { CardUsage, Statement } from '../data/balance';
import { dayLabel } from '../data/dates';
import { formatMoney } from '../data/money';
import type { AppData } from '../data/store';
import type { Transaction } from '../data/types';
import { StatementItems } from './StatementItems';

/**
 * One credit card: what's free on its limit, how much is used, and its next charge. When given the card's
 * statements, tapping it opens what the next charge is made of (and a line for the charges after it).
 */
export function CardLine(props: {
  usage: CardUsage;
  today: string;
  statements?: Statement[];
  data?: AppData;
  onEdit?: (tx: Transaction) => void;
}) {
  const { usage, today } = props;
  const [open, setOpen] = useState(false);
  const limit = usage.card.creditLimit;
  const share = limit ? Math.min(1, usage.used / limit) : 0;
  const next = props.statements?.find(s => s.date > today);
  const later = props.statements?.filter(s => next && s.date > next.date) ?? [];
  const canOpen = !!(props.statements && props.data && props.onEdit);

  const head = (
    <>
      <div class="line">
        <span>
          {usage.card.name}
          {canOpen && <span class={`chevron small-chevron ${open ? 'open' : ''}`}> ‹</span>}
        </span>
        <span>{limit ? `פנוי ${formatMoney(usage.available!)}` : `נוצל ${formatMoney(usage.used)}`}</span>
      </div>
      {limit ? (
        <>
          <div class={`bar ${share >= 0.9 ? 'high' : ''}`}>
            <span style={{ width: `${share * 100}%` }} />
          </div>
          <div class="muted small">
            נוצל {formatMoney(usage.used)} מתוך {formatMoney(limit)}
            {usage.nextCharge && ` · חיוב ${dayLabel(usage.nextCharge.date, today)}: ${formatMoney(usage.nextCharge.amount)}`}
          </div>
        </>
      ) : (
        <div class="muted small">
          {usage.nextCharge ? `חיוב ${dayLabel(usage.nextCharge.date, today)}: ${formatMoney(usage.nextCharge.amount)} · ` : ''}
          לא הוגדרה מסגרת
        </div>
      )}
      <div class="muted small last-entry">
        {usage.lastEntry ? `רכישה אחרונה שנרשמה: ${dayLabel(usage.lastEntry, today)}` : 'עוד לא נרשמו רכישות בכרטיס'}
      </div>
    </>
  );

  return (
    <div class="card-line">
      {canOpen ? (
        <button class="card-line-head" onClick={() => setOpen(!open)} aria-expanded={open}>
          {head}
        </button>
      ) : (
        head
      )}
      {open && props.data && props.onEdit && (
        <div class="card-detail">
          <div class="muted small">{next ? `בחיוב של ${dayLabel(next.date, today)}` : 'אין חיוב קרוב'}</div>
          {next && <StatementItems data={props.data} items={next.items} today={today} onEdit={props.onEdit} />}
          {later.length > 0 && (
            <div class="muted small later">
              ועוד {formatMoney(later.reduce((a, s) => a + s.amount, 0))} בחיובים שאחריו (תשלומים)
            </div>
          )}
        </div>
      )}
    </div>
  );
}

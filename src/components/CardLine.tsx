import type { CardUsage } from '../data/balance';
import { dayLabel } from '../data/dates';
import { formatMoney } from '../data/money';

/** One credit card: what's free on its limit, how much is used, and its next charge. */
export function CardLine({ usage, today }: { usage: CardUsage; today: string }) {
  const limit = usage.card.creditLimit;
  const share = limit ? Math.min(1, usage.used / limit) : 0;
  return (
    <div class="card-line">
      <div class="line">
        <span>{usage.card.name}</span>
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
        <div class="muted small">לא הוגדרה מסגרת. אפשר להוסיף בהגדרות ← אמצעי תשלום וכרטיסי אשראי</div>
      )}
    </div>
  );
}

import type { StatementItem } from '../data/balance';
import { categoryColor } from '../data/colors';
import { dayLabel } from '../data/dates';
import { formatMoney } from '../data/money';
import type { AppData } from '../data/store';
import type { Transaction } from '../data/types';

/** What a card charge is made of: each purchase or installment, and what was on the card at the start. */
export function StatementItems(props: { data: AppData; items: StatementItem[]; today: string; onEdit: (tx: Transaction) => void }) {
  const { data } = props;
  const catName = (id?: string) => data.categories.find(c => c.id === id)?.name ?? '';
  return (
    <div class="statement">
      {props.items.length === 0 && <p class="muted small">אין עדיין קניות לחיוב הזה.</p>}
      {props.items.map((item, i) =>
        item.tx ? (
          <button key={`${item.tx.id}-${i}`} class="tx" onClick={() => props.onEdit(item.tx!)}>
            <div>
              <div>
                <span class="cat-dot" style={{ background: categoryColor(item.tx.categoryId, data.categories) }} />
                {item.tx.recurringId ? item.tx.note : catName(item.tx.categoryId)}
              </div>
              <div class="muted small">
                {[
                  dayLabel(item.tx.date, props.today),
                  item.tx.recurringId && 'הוראת קבע',
                  item.installment && `תשלום ${item.installment.n} מתוך ${item.installment.of}`,
                  !item.tx.recurringId && item.tx.note,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </div>
            <div class="amount expense">{formatMoney(-item.amount)}</div>
          </button>
        ) : (
          <div key={`opening-${i}`} class="tx">
            <div>
              <div>צבור מלפני תחילת המעקב</div>
              <div class="muted small">הסכום שהיה על הכרטיס ביום ההתחלה</div>
            </div>
            <div class="amount expense">{formatMoney(-item.amount)}</div>
          </div>
        ),
      )}
    </div>
  );
}

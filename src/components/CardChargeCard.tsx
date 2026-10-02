import { useState } from 'preact/hooks';
import type { Statement } from '../data/balance';
import { chargeWindow, saveCardCheck } from '../data/cardCheck';
import { addDays, dayLabel, todayStr } from '../data/dates';
import { putRecords } from '../data/db';
import { formatMoney } from '../data/money';
import type { AppData } from '../data/store';
import type { PaymentMethod, Transaction } from '../data/types';
import { Chips, MoneyInput } from './inputs';
import { StatementItems } from './StatementItems';

const short = (d: string) => d.split('-').reverse().slice(0, 2).map(Number).join('.');

/**
 * On a credit card's charge day: was that what the card company charged? If not, the gap stays on screen
 * while it's closed — by looking over the charge's purchases (fixing or adding), or by recording the gap
 * itself as an expense (or as a refund, when less was charged) — and it updates with every change.
 */
export function CardChargeCard(props: {
  db: IDBDatabase;
  data: AppData;
  card: PaymentMethod;
  charge: Statement;
  /** Already said, the last time round. */
  actual?: number;
  more: number;
  onLater: () => void;
  onDone: () => void;
  onEdit: (tx: Transaction) => void;
  onAdd: (type: 'expense' | 'income', date: string) => void;
}) {
  const { card, charge, data } = props;
  const today = todayStr();
  const [actual, setActual] = useState(props.actual ?? charge.amount);
  const [asking, setAsking] = useState(props.actual === undefined);
  const [differs, setDiffers] = useState(false);
  const [showItems, setShowItems] = useState(false);
  const [recordGap, setRecordGap] = useState(false);
  const [categoryId, setCategoryId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const win = chargeWindow(card, charge);
  // The gap: more charged than recorded (something missing), or less (a refund, or recorded twice)
  const gap = actual - charge.amount;
  const lastDay = win.to < today ? win.to : today;

  const finish = async (amount: number) => {
    setBusy(true);
    await saveCardCheck(props.db, { methodId: card.id, date: charge.date, actual: amount, done: true, at: new Date().toISOString() });
    props.onDone();
  };
  const keep = async () => {
    if (actual === charge.amount) return finish(actual);
    setBusy(true);
    await saveCardCheck(props.db, { methodId: card.id, date: charge.date, actual, done: false, at: new Date().toISOString() });
    setBusy(false);
    setAsking(false);
    props.onDone();
  };
  // The gap itself, as one line on that charge (dated the day before it, so it lands in it)
  const saveGap = async () => {
    if (!categoryId) return;
    setBusy(true);
    const now = new Date().toISOString();
    const tx: Transaction = {
      id: crypto.randomUUID(),
      type: gap > 0 ? 'expense' : 'income',
      amount: Math.abs(gap),
      date: lastDay,
      categoryId,
      methodId: card.id,
      note: `הפרש בחיוב ${card.name}`,
      createdAt: now,
      updatedAt: now,
    };
    await putRecords(props.db, 'transactions', [tx]);
    await saveCardCheck(props.db, { methodId: card.id, date: charge.date, actual, done: true, at: now });
    props.onDone();
  };
  const gapCategories = data.categories.filter(c => c.kind === (gap > 0 ? 'expense' : 'income') && c.name.trim() && !c.archived);

  return (
    <div class="event-popup" role="dialog" aria-modal="true">
      <div class="event-popup-backdrop" />
      <div class="card pending event-popup-card card-charge">
        <div class="muted small">
          חיוב כרטיס אשראי · {dayLabel(charge.date, today)}
          {props.more > 0 && ` · ועוד ${props.more} ממתינים`}
        </div>
        {asking ? (
          <>
            <h2>
              {card.name} חויב {dayLabel(charge.date, today)}
            </h2>
            <p>
              לפי מה שרשמת: <strong>{formatMoney(charge.amount)}</strong>. זה הסכום שחויב בפועל?
            </p>
            {differs ? (
              <>
                <p class="field-label">כמה חויב בפועל?</p>
                <MoneyInput value={actual} onChange={setActual} autoFocus />
                <div class="hero-buttons">
                  <button disabled={busy || actual <= 0} onClick={keep}>
                    המשך
                  </button>
                </div>
              </>
            ) : (
              <div class="hero-buttons">
                <button disabled={busy} onClick={() => finish(charge.amount)}>
                  כן, נכון
                </button>
                <button class="secondary" disabled={busy} onClick={() => setDiffers(true)}>
                  לא, חויב סכום אחר
                </button>
              </div>
            )}
          </>
        ) : gap === 0 ? (
          <>
            <h2>✓ עכשיו זה מתאים</h2>
            <p class="muted small">
              {card.name} חויב {formatMoney(actual)}, בדיוק כמו מה שרשום.
            </p>
            <div class="hero-buttons">
              <button disabled={busy} onClick={() => finish(actual)}>
                סיום
              </button>
            </div>
          </>
        ) : (
          <>
            <h2>
              {card.name}: פער של {formatMoney(Math.abs(gap))}
            </h2>
            <div class="card-gap">
              <div class="line">
                <span>חויב בפועל</span>
                <span>{formatMoney(actual)}</span>
              </div>
              <div class="line">
                <span>לפי מה שרשמת</span>
                <span>{formatMoney(charge.amount)}</span>
              </div>
            </div>
            <p class="muted small">
              {gap > 0
                ? 'חויב יותר ממה שרשמת: כנראה חסרות קניות, או שסכום נרשם נמוך מדי.'
                : 'חויב פחות ממה שרשמת: אולי היה זיכוי, קנייה נרשמה פעמיים, או שסכום נרשם גבוה מדי.'}{' '}
              לחיוב הזה נכנסות קניות מ־{short(win.from)} עד {short(win.to)}.
            </p>
            {recordGap ? (
              <>
                <p class="field-label">{gap > 0 ? 'לרשום הוצאה של' : 'לרשום זיכוי של'} {formatMoney(Math.abs(gap))} על מה?</p>
                <Chips items={gapCategories} value={categoryId} onChange={setCategoryId} />
                <div class="hero-buttons">
                  <button disabled={busy || !categoryId} onClick={saveGap}>
                    לרשום
                  </button>
                  <button class="secondary" onClick={() => setRecordGap(false)}>
                    חזרה
                  </button>
                </div>
              </>
            ) : (
              <>
                <div class="gap-actions">
                  <button class="secondary" onClick={() => setShowItems(!showItems)}>
                    {showItems ? 'להסתיר את הקניות' : `לבדוק את הקניות בחיוב (${charge.items.length})`}
                  </button>
                  {showItems && <StatementItems data={data} items={charge.items} today={today} onEdit={props.onEdit} />}
                  <button class="secondary" onClick={() => props.onAdd(gap > 0 ? 'expense' : 'income', lastDay)}>
                    {gap > 0 ? '+ להוסיף קנייה שחסרה' : '+ להוסיף זיכוי שחסר'}
                  </button>
                  <button class="secondary" onClick={() => setRecordGap(true)}>
                    לרשום את ההפרש {gap > 0 ? 'כהוצאה' : 'כזיכוי'}
                  </button>
                </div>
                <div class="row-links">
                  <button class="link small" onClick={() => setAsking(true)}>
                    לתקן את הסכום שחויב
                  </button>
                </div>
              </>
            )}
          </>
        )}
        <button class="link small event-popup-later" onClick={props.onLater}>
          אחר כך
        </button>
      </div>
    </div>
  );
}

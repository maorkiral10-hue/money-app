import { useState } from 'preact/hooks';
import { cardStatements, edgeCharges } from '../data/balance';
import { cardSide, openCardGaps, unconfirmedOnCard, upcomingCharge } from '../data/cardCheck';
import { dayLabel, todayStr } from '../data/dates';
import { formatMoney } from '../data/money';
import type { QuickPreset } from '../data/quick';
import { checkMark, checkStatus, everyFor, keepRegularSchedule, logCheck, recheckGap } from '../data/reconcile';
import { openOccurrences } from '../data/recurring';
import type { AppData } from '../data/store';
import type { PaymentMethod, Transaction } from '../data/types';
import { MoneyInput } from './inputs';
import { StatementItems } from './StatementItems';

const short = (d: string) => d.split('-').reverse().slice(0, 2).map(Number).join('.');

/**
 * A credit card in the weekly check: what the card company shows as its next charge, against what's recorded
 * here for that charge up to today. A gap isn't recorded as unexplained — on a card everything is on the
 * card's page, so it can always be found: it stays open until the charge day, with the charge's purchases to
 * compare line by line, and what's still missing of an earlier check told apart from what's new.
 */
export function CardWeeklyCheck(props: {
  db: IDBDatabase;
  data: AppData;
  card: PaymentMethod;
  /** Checking its open gap again: not a check of its own. */
  recheck?: boolean;
  onBack: () => void;
  onChange: () => void;
  onAddMissing: (preset: QuickPreset) => void;
  onEdit?: (tx: Transaction) => void;
}) {
  const { data, card } = props;
  const today = todayStr();
  const chargeDate = upcomingCharge(card, today);
  const app = cardSide(data, card, chargeDate, today);
  const [real, setReal] = useState(0);
  const [typed, setTyped] = useState(false);
  const [checked, setChecked] = useState(false);
  const [early, setEarly] = useState<'ask' | 'today' | 'regular' | null>(null);
  const [showItems, setShowItems] = useState(false);
  const [recheckOf] = useState(() => (props.recheck ? openCardGaps(data, today).find(g => g.card.id === card.id) : undefined));
  // The open gap as it stands now (after this check, or the one left before)
  const open = openCardGaps(data, today).find(g => g.card.id === card.id);
  const gap = real - app;
  const mark = checkMark(real, app, data.checkTolerance);
  // Changing standing orders on the card not confirmed yet: their amount is missing here
  const variableDue = data.recurring
    .filter(r => r.variable)
    .flatMap(rec => openOccurrences(rec, today, data.startDate).map(occurrence => ({ rec, occurrence })));
  const unconfirmed = unconfirmedOnCard(data, card, variableDue);
  const statement = cardStatements(data, card.id).find(s => s.date === (recheckOf?.chargeDate ?? chargeDate));
  const items = statement?.items.filter(i => !i.tx || i.tx.date <= today) ?? [];
  const edgeIds = new Set(items.filter(i => i.tx && !i.tx.chargeDate && edgeCharges(i.tx.date, card.chargeDay!)).map(i => i.tx!.id));

  const compare = async () => {
    if (recheckOf) {
      await recheckGap(props.db, { account: { id: card.id, name: card.name, kind: 'other', openingBalance: 0, order: 0 }, check: recheckOf.check, found: recheckOf.found, left: recheckOf.left, until: recheckOf.chargeDate }, real, today);
      setChecked(true);
      props.onChange();
      return;
    }
    const due = checkStatus(data, today).due.some(a => a.id === card.id);
    const checkedBefore = data.balanceChecks.some(c => c.accountId === card.id);
    setEarly(!due && checkedBefore && everyFor(data, { id: card.id, name: card.name, kind: 'card' }) !== 'never' ? 'ask' : null);
    setChecked(true);
    await logCheck(props.db, { date: today, accountId: card.id, real, app, result: mark === 'exact' ? 'match' : 'gap', chargeDate, ...(!due && { early: true }) });
    props.onChange();
  };

  // What to show once compared: for a recheck, the gap as it now stands
  const shown = recheckOf ? (open ? open.left : 0) : gap;
  const closedNow = checked && (recheckOf ? !open || Math.abs(open.left) <= data.checkTolerance : mark !== 'off');

  return (
    <>
      {recheckOf && (
        <p class="small recheck-note">
          בודקים שוב את הפער הפתוח מ{dayLabel(recheckOf.check.date, today)}. הבדיקה הזו לא נכנסת להיסטוריה ולא משנה את מועד הבדיקה הבאה.
        </p>
      )}
      <div class="card">
        <h2>{card.name}</h2>
        {unconfirmed.length > 0 && (
          <p class="small rest-note">
            יש על הכרטיס הוראת קבע בסכום משתנה שעוד לא אישרת ({unconfirmed.join(', ')}). הסכום שלה עוד לא נכנס כאן, אז כדאי לאשר אותה קודם (בחלונית במסך הבית).
          </p>
        )}
        <label class="field">
          <span>כמה כתוב "לחיוב הקרוב" באפליקציה של חברת האשראי</span>
          <MoneyInput
            key={card.id}
            value={0}
            onChange={v => {
              setReal(v);
              setTyped(true);
              setChecked(false);
            }}
          />
        </label>
        <p class="muted small">
          החיוב הקרוב: {dayLabel(recheckOf?.chargeDate ?? chargeDate, today)}. משווים את מה שכבר נקנה עד היום (לא את המסגרת הפנויה).
        </p>
        <button disabled={!typed} onClick={compare}>
          השווה
        </button>
      </div>

      {checked && (
        <div class={`card check-result ${closedNow ? (mark === 'minor' && !recheckOf ? 'minor-panel' : 'inc-panel') : 'exp-panel'}`}>
          {closedNow ? (
            <>
              <h2 class={mark === 'minor' && !recheckOf ? 'minor' : 'inc'}>
                {recheckOf ? '✓ הפער נסגר' : mark === 'exact' ? '✓ מתאים בדיוק' : `✓✗ שינוי מינורי של ${formatMoney(Math.abs(gap))}`}
              </h2>
              {recheckOf && <button onClick={props.onBack}>סיום</button>}
            </>
          ) : (
            <>
              <h2 class="exp">
                {recheckOf ? 'עדיין פער של' : '✗ יש פער של'} {formatMoney(Math.abs(shown))}
              </h2>
              {!recheckOf && (
                <>
                  <div class="line">
                    <span>אצל חברת האשראי</span>
                    <span>{formatMoney(real)}</span>
                  </div>
                  <div class="line">
                    <span>אצלך</span>
                    <span>{formatMoney(app)}</span>
                  </div>
                </>
              )}
              {open?.before && (
                <div class="gap-split small">
                  {open.before.left === 0 ? (
                    <div>· הפער מהבדיקה ב{dayLabel(open.before.date, today)} נמצא כולו ✓, הכל חדש מאז</div>
                  ) : Math.abs(open.left) >= Math.abs(open.before.left) ? (
                    <>
                      <div>· {formatMoney(Math.abs(open.before.left))} מהבדיקה ב{dayLabel(open.before.date, today)} (עוד לא נמצאו)</div>
                      {Math.abs(open.left) > Math.abs(open.before.left) && <div>· {formatMoney(Math.abs(open.left) - Math.abs(open.before.left))} חדשים מאז</div>}
                    </>
                  ) : (
                    <div>
                      · הפער ירד מאז הבדיקה ב{dayLabel(open.before.date, today)}: היה {formatMoney(Math.abs(open.before.left))}, עכשיו {formatMoney(Math.abs(open.left))}
                    </div>
                  )}
                </div>
              )}
              <p class="muted small">
                {shown > 0
                  ? 'אצל חברת האשראי יש יותר: כנראה קנייה שלא נרשמה, או סכום שנרשם נמוך מדי.'
                  : 'אצלך רשום יותר: אולי קנייה שעוד לא הגיעה לחברת האשראי (זה לוקח יום עד שלושה), זיכוי שלא נרשם, או משהו שנרשם פעמיים.'}{' '}
                בדף הכרטיס אפשר להשוות שורה מול שורה:
              </p>
              <button class="secondary" onClick={() => setShowItems(!showItems)}>
                {showItems ? 'להסתיר את הקניות' : `הקניות בחיוב של ${short(recheckOf?.chargeDate ?? chargeDate)} (${items.length})`}
              </button>
              {showItems && (
                <StatementItems data={data} items={items} today={today} onEdit={tx => props.onEdit?.(tx)} edgeIds={edgeIds} />
              )}
              <button
                onClick={() =>
                  props.onAddMissing({ type: shown > 0 ? 'expense' : 'income', amount: Math.abs(shown), method: card.name, date: today, editAmount: true })
                }
              >
                {shown > 0 ? '+ להוסיף קנייה שחסרה' : '+ להוסיף זיכוי שחסר'}
              </button>
              <button class="link" onClick={props.onBack}>
                {recheckOf ? 'להמשיך לחפש' : 'להשאיר פתוח עד יום החיוב'}
              </button>
              <p class="muted small">
                באשראי שום דבר לא נרשם לבד. אם לא תמצא, ביום החיוב ({dayLabel(recheckOf?.chargeDate ?? chargeDate, today)}) תסגור את זה בבדיקה הסופית של החיוב.
              </p>
            </>
          )}
        </div>
      )}
      {!recheckOf && checked && early === 'ask' && (
        <div class="card">
          <h2>בדקת לפני הזמן. מתי הבדיקה הבאה?</h2>
          <div class="scope-buttons">
            <button onClick={() => setEarly('today')}>לספור מהיום</button>
            <button
              class="secondary"
              onClick={async () => {
                await keepRegularSchedule(props.db, card.id, today);
                setEarly('regular');
                props.onChange();
              }}
            >
              להישאר בקצב הרגיל
            </button>
          </div>
        </div>
      )}
    </>
  );
}

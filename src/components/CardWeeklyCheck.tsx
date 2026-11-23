import { useState } from 'preact/hooks';
import { Icon } from './Icon';
import { cardStatements, edgeCharges } from '../data/balance';
import { cardSide, openCardGaps, unconfirmedOnCard, upcomingCharge } from '../data/cardCheck';
import { dayLabel, todayStr } from '../data/dates';
import { formatMoney } from '../data/money';
import type { QuickPreset } from '../data/quick';
import { checkMark, checkStatus, everyFor, isVerified, keepRegularSchedule, logCheck, recheckGap, setVerified } from '../data/reconcile';
import { openOccurrences } from '../data/recurring';
import type { AppData } from '../data/store';
import type { PaymentMethod, Transaction } from '../data/types';
import { MoneyInput } from './inputs';
import { StatementItems } from './StatementItems';

/** A card's gap being looked into, kept while the app is open (going to fix a purchase and back finds it). */
const looking: Record<string, { real: number; initial: number; date: string }> = {};

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
  /** It came out right (or was made right while looking, `found`). */
  onSuccess?: (found: boolean) => void;
  /** Not found now: left open until the charge day (on to the next check). */
  onLeaveOpen?: () => void;
}) {
  const { data, card } = props;
  const today = todayStr();
  const chargeDate = upcomingCharge(card, today);
  const app = cardSide(data, card, chargeDate, today);
  const resumed = !props.recheck && looking[card.id]?.date === today ? looking[card.id] : undefined;
  const [real, setReal] = useState(resumed?.real ?? 0);
  const [typed, setTyped] = useState(!!resumed);
  // A recheck opens on its gap as it stands, with the purchases to compare; typing again is optional
  const [checked, setChecked] = useState(!!resumed || !!props.recheck);
  const [notFoundOpen, setNotFoundOpen] = useState(false);
  const [ticks, setTicks] = useState(data.verified);
  const [early, setEarly] = useState<'ask' | 'today' | 'regular' | null>(null);
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
    if (mark !== 'off' && due) props.onSuccess?.(false);
    if (mark === 'off') looking[card.id] = { real, initial: gap, date: today };
    props.onChange();
  };

  // What to show once compared: for a recheck, the gap as it now stands
  const shown = recheckOf ? (open ? open.left : 0) : gap;
  const closedNow = checked && (recheckOf ? !open || Math.abs(open.left) <= data.checkTolerance : Math.abs(gap) <= data.checkTolerance);

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
            value={real}
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
                {recheckOf || looking[card.id] ? 'הכל מתאים' : mark === 'exact' ? '✓ מתאים בדיוק' : `✓✗ שינוי מינורי של ${formatMoney(Math.abs(gap))}`}
              </h2>
              {(recheckOf || looking[card.id]) && (
                <button
                  class="gap-closed-btn"
                  onClick={() => {
                    delete looking[card.id];
                    props.onSuccess?.(true);
                  }}
                >
                  הפער נסגר!
                </button>
              )}
            </>
          ) : (
            <>
              <div class="line gap-title">
                <strong>{card.name}</strong>
                <strong class="exp">{shown > 0 ? `חסרות קניות של ${formatMoney(shown)}` : `רשום אצלך ${formatMoney(-shown)} יותר`}</strong>
              </div>
              {(() => {
                const initial = looking[card.id]?.initial ?? recheckOf?.found ?? shown;
                const sameWay = Math.sign(shown) === Math.sign(initial);
                const found = sameWay ? Math.max(0, Math.abs(initial) - Math.abs(shown)) : 0;
                return (
                  <>
                    <div class="bar gap-bar">
                      <span style={{ width: `${initial ? Math.min(1, found / Math.abs(initial)) * 100 : 0}%` }} />
                    </div>
                    <div class="muted small">
                      נמצאו {formatMoney(found)} מתוך {formatMoney(Math.abs(initial))}
                    </div>
                  </>
                );
              })()}
              {!recheckOf && (
                <div class="muted small">
                  אצל חברת האשראי {formatMoney(real)} · אצלך {formatMoney(app)}
                </div>
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
                  ? 'כנראה קנייה שלא נרשמה.'
                  : 'אולי קנייה שעוד לא הגיעה לחברת האשראי, או משהו שנרשם פעמיים.'}
              </p>
            </>
          )}
        </div>
      )}

      {checked && !closedNow && (
        <>
          <div class="card compare-list">
            <p class="muted small">
              השווה מול הפירוט באפליקציה של חברת האשראי · החיוב של {short(recheckOf?.chargeDate ?? chargeDate)} · ✓ = כבר נבדק (
              {items.filter(i => i.tx && isVerified(ticks, card.id, { key: i.tx.id, version: i.tx.updatedAt })).length} מתוך {items.filter(i => i.tx).length})
            </p>
            {items.map((i, n) => {
              if (!i.tx) return null;
              const line = { key: i.tx.id, version: i.tx.updatedAt };
              const on = isVerified(ticks, card.id, line);
              const label = i.tx.recurringId ? i.tx.note : data.categories.find(c => c.id === i.tx!.categoryId)?.name;
              const notes = [
                i.tx.type === 'income' && 'זיכוי',
                i.tx.recurringId && 'הוראת קבע',
                i.installment && `תשלום ${i.installment.n} מתוך ${i.installment.of}`,
                edgeIds.has(i.tx.id) && 'אולי בחיוב הבא',
                !i.tx.recurringId && i.tx.note,
              ].filter(Boolean);
              return (
                <div key={`${i.tx.id}-${n}`} class={`compare-line ${on ? 'done' : ''}`}>
                  <button
                    class={`tick ${on ? 'on' : ''}`}
                    aria-label={on ? 'בטל סימון' : 'סמן כנבדק'}
                    onClick={async () => {
                      const next = { ...ticks };
                      if (on) delete next[`${card.id}|${line.key}`];
                      else next[`${card.id}|${line.key}`] = line.version;
                      setTicks(next);
                      await setVerified(props.db, ticks, card.id, { ...line, date: '', amount: 0, label: '' }, !on);
                    }}
                  >
                    {on ? '✓' : ''}
                  </button>
                  <button class="compare-body" onClick={() => props.onEdit?.(i.tx!)}>
                    <span>
                      {short(i.tx.date)} · {label}
                      {notes.length > 0 && <span class="muted"> · {notes.join(' · ')}</span>}
                    </span>
                    <span class={i.amount < 0 ? 'inc' : ''}>{formatMoney(-i.amount, { sign: i.amount < 0 })}</span>
                  </button>
                </div>
              );
            })}
            <button class="secondary" onClick={() => props.onAddMissing({ type: shown > 0 ? 'expense' : 'income', amount: Math.abs(shown), method: card.name, date: today, editAmount: true })}>
              {shown > 0 ? '+ להוסיף קנייה שחסרה' : '+ להוסיף זיכוי שחסר'}
            </button>
          </div>
          <div class="card not-found">
            <button class="not-found-head" onClick={() => setNotFoundOpen(!notFoundOpen)} aria-expanded={notFoundOpen}>
              <span>לא מצאת? מה עושים עם {formatMoney(Math.abs(shown))}</span>
              <span class={`chevron ${notFoundOpen ? 'open' : ''}`}>‹</span>
            </button>
            {notFoundOpen && (
              <div class="not-found-options">
                <button
                  class="nf-option wait"
                  onClick={() => {
                    delete looking[card.id];
                    (props.onLeaveOpen ?? props.onBack)();
                  }}
                >
                  <span class="nf-icon">
                    <Icon name="calendar" size={20} />
                  </span>
                  <span>
                    <strong>להשאיר פתוח עד יום החיוב</strong>
                    <span class="small block">
                      באשראי הכל רשום אצל חברת האשראי, אז אין "לא מזוהה". ביום החיוב ({dayLabel(recheckOf?.chargeDate ?? chargeDate, today)}) תסגור את זה בבדיקה הסופית.
                    </span>
                  </span>
                </button>
              </div>
            )}
          </div>
        </>
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

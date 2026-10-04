import { useState } from 'preact/hooks';
import { MoneyInput } from '../components/inputs';
import { dayLabel, todayStr } from '../data/dates';
import { depositsSince, earned, estimated, FUND_KINDS, latest, saveFunds, sinceStart, totalEstimated, totalSaved, type Fund, type FundKind } from '../data/funds';
import { formatMoney } from '../data/money';
import type { AppData } from '../data/store';

const pctText = (p?: number) => (p === undefined ? '' : ` (${p >= 0 ? '+' : '−'}${Math.abs(p * 100).toFixed(1)}%)`);
const kindName = (k: FundKind) => FUND_KINDS.find(([id]) => id === k)?.[1] ?? '';

/**
 * Long-term savings, from the side menu: pension, hishtalmut, gemel. For the picture only — none of it is
 * liquid money or part of the month. Balances are typed in from each fund's report; between two updates
 * the app shows what of the growth the fund earned, the deposits taken off.
 */
export function FundsScreen(props: { db: IDBDatabase; data: AppData; onBack: () => void; onChange: () => void }) {
  const { data } = props;
  const today = todayStr();
  const funds = data.funds;
  const [adding, setAdding] = useState(false);
  const [updating, setUpdating] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const lastUpdate = funds.map(f => latest(f)?.date).filter(Boolean).sort().pop();

  const save = async (next: Fund[]) => {
    await saveFunds(props.db, next);
    props.onChange();
  };

  return (
    <>
      <header class="top">
        <h1>חיסכון לטווח ארוך</h1>
        <button class="link" onClick={props.onBack}>
          חזרה
        </button>
      </header>
      <p class="muted small">
        לשיקוף בלבד: הכסף הזה לא נספר בכסף הנזיל ולא בחודש. מעדכנים יתרה מהדוח או מהאתר של הקרן, מתי שנוח, והאפליקציה מחשבת כמה מהגידול היה תשואה (אחרי שמורידים את ההפקדות).
      </p>

      {funds.length > 0 && (
        <div class="card fund-total">
          <div class="muted small">סך הכל{totalEstimated(funds, data.transactions, today) !== totalSaved(funds) ? ' (משוער)' : ''}</div>
          <div class="big-number sav">{formatMoney(totalEstimated(funds, data.transactions, today))}</div>
          {lastUpdate && <div class="muted small">עדכון אחרון מהדוחות: {dayLabel(lastUpdate, today)}</div>}
        </div>
      )}

      {funds.map(f => {
        const last = latest(f);
        const since = depositsSince(f, data.transactions, today);
        const total = sinceStart(f);
        const open = openId === f.id;
        return (
          <div key={f.id} class="card fund">
            <button class="fund-head" onClick={() => setOpenId(open ? null : f.id)} aria-expanded={open}>
              <div class="line">
                <span>
                  <strong>{f.name}</strong>
                  {kindName(f.kind) !== f.name && <span class="muted small"> · {kindName(f.kind)}</span>}
                </span>
                <span>
                  <span class="sav">{last ? formatMoney(last.balance + since) : '—'}</span>
                  <span class={`chevron small-chevron ${open ? 'open' : ''}`}> ‹</span>
                </span>
              </div>
              <div class="muted small">
                {since > 0 ? `משוער: ${formatMoney(last!.balance)} מהדוח (${dayLabel(last!.date, today)}) + ${formatMoney(since)} שהופקדו מאז` : last && `מהדוח, ${dayLabel(last.date, today)}`}
              </div>
              {total && (
                <div class="small">
                  תשואה מאז {dayLabel(total.from, today)}: <span class={total.amount >= 0 ? 'inc' : 'exp'}>{formatMoney(total.amount, { sign: true })}{pctText(total.pct)}</span>
                </div>
              )}
            </button>
            {open && (
              <div class="fund-stats">
                <div class="line">
                  <span>יתרה בדוח האחרון ({dayLabel(last.date, today)})</span>
                  <span>{formatMoney(last.balance)}</span>
                </div>
                {since > 0 && (
                  <div class="line">
                    <span>הופקד מאז (הוראת קבע)</span>
                    <span>{formatMoney(since)}</span>
                  </div>
                )}
                {total ? (
                  <>
                    <div class="line">
                      <span>יתרה כשהתחלת לעקוב ({dayLabel(total.from, today)})</span>
                      <span>{formatMoney(f.updates[0].balance)}</span>
                    </div>
                    <div class="line">
                      <span>הפקדות מאז</span>
                      <span>{formatMoney(total.deposits)}</span>
                    </div>
                    <div class="line">
                      <span>
                        <strong>תשואה מאז</strong>
                      </span>
                      <strong class={total.amount >= 0 ? 'inc' : 'exp'}>
                        {formatMoney(total.amount, { sign: true })}
                        {pctText(total.pct)}
                      </strong>
                    </div>
                  </>
                ) : (
                  <p class="muted small">אחרי העדכון הבא מהדוח יופיעו כאן ההפקדות והתשואה (כמה הקופה הרוויחה בעצמה).</p>
                )}
              </div>
            )}
            {updating === f.id ? (
              <UpdateForm
                fund={f}
                data={data}
                onCancel={() => setUpdating(null)}
                onSave={async u => {
                  setUpdating(null);
                  await save(funds.map(x => (x.id === f.id ? { ...x, updates: [...x.updates, u] } : x)));
                }}
              />
            ) : (
              <button class="secondary small-btn" onClick={() => setUpdating(f.id)}>
                עדכון יתרה
              </button>
            )}
            {open && (
              <div class="fund-history">
                <p class="field-label">כל העדכונים</p>
                {[...f.updates].reverse().map((u, ri) => {
                  const i = f.updates.length - 1 - ri;
                  const g = earned(f, i);
                  return (
                    <div key={i} class="line small">
                      <span>
                        {u.date.split('-').reverse().map(Number).join('.')}
                        {i > 0 && <span class="muted"> · הופקד {formatMoney(u.deposits)}</span>}
                        {g && <span class="muted"> · תשואה {formatMoney(g.amount, { sign: true })}{pctText(g.pct)}</span>}
                      </span>
                      <span>{formatMoney(u.balance)}</span>
                    </div>
                  );
                })}
                <button
                  class="link small danger-link"
                  onClick={async () => {
                    if (!confirm(`למחוק את "${f.name}" ואת כל העדכונים שלה?`)) return;
                    await save(funds.filter(x => x.id !== f.id));
                  }}
                >
                  מחיקת הקופה
                </button>
              </div>
            )}
          </div>
        );
      })}

      {adding ? (
        <AddFund
          data={data}
          onCancel={() => setAdding(false)}
          onSave={async f => {
            setAdding(false);
            await save([...funds, f]);
          }}
        />
      ) : (
        <button class="secondary" onClick={() => setAdding(true)}>
          + קופה
        </button>
      )}
    </>
  );
}

/** A new balance from the fund's report, and what was deposited since the last one. */
function UpdateForm(props: { fund: Fund; data: AppData; onCancel: () => void; onSave: (u: { date: string; balance: number; deposits: number }) => void }) {
  const { fund } = props;
  const today = todayStr();
  const last = latest(fund);
  const [date, setDate] = useState(today);
  const [balance, setBalance] = useState(0);
  // With a standing order tied to it, what it put in is known: nothing to ask. From the salary, it's in the report
  const fromOrder = depositsSince(fund, props.data.transactions, date);
  const [other, setOther] = useState(0);
  const [showOther, setShowOther] = useState(false);
  const deposits = fund.recurringId ? fromOrder + other : other;
  const ok = balance > 0 && !!date && date <= today && (!last || date >= last.date);
  const gain = last ? balance - last.balance - deposits : undefined;
  return (
    <div class="fund-form">
      <p class="field-label">כמה יש בקופה עכשיו (לפי הדוח)</p>
      <MoneyInput value={balance} onChange={setBalance} autoFocus />
      <label class="field">
        <span>נכון לתאריך</span>
        <input type="date" value={date} min={last?.date} max={today} onInput={e => setDate(e.currentTarget.value)} />
      </label>
      {last && (
        <>
          {fund.recurringId ? (
            <>
              <p class="small">
                הופקד מאז {dayLabel(last.date, today)} בהוראת הקבע: <strong>{formatMoney(fromOrder)}</strong>
              </p>
              {showOther ? (
                <>
                  <p class="field-label">הפקדות נוספות (למשל מהמשכורת)</p>
                  <MoneyInput value={other} onChange={setOther} />
                </>
              ) : (
                <button class="link small" onClick={() => setShowOther(true)}>
                  + הייתה עוד הפקדה (למשל מהמשכורת)
                </button>
              )}
            </>
          ) : (
            <>
              <p class="field-label">כמה הופקד מאז {dayLabel(last.date, today)}</p>
              <MoneyInput value={other} onChange={setOther} />
              <p class="muted small">יורד מהמשכורת, אז זה משתנה: מופיע בדוח של הקרן (הפקדות עובד ומעסיק).</p>
            </>
          )}
          {balance > 0 && gain !== undefined && (
            <p class="small">
              תשואה מאז העדכון הקודם: <strong>{formatMoney(gain, { sign: true })}</strong>
              {pctText(last.balance > 0 ? gain / last.balance : undefined)}
            </p>
          )}
        </>
      )}
      <div class="hero-buttons">
        <button disabled={!ok} onClick={() => props.onSave({ date, balance, deposits: last ? deposits : 0 })}>
          לשמור
        </button>
        <button class="secondary" onClick={props.onCancel}>
          ביטול
        </button>
      </div>
    </div>
  );
}

/** A fund to follow: its name and kind, a standing order that deposits into it (if any), and its balance today. */
function AddFund(props: { data: AppData; onCancel: () => void; onSave: (f: Fund) => void }) {
  const today = todayStr();
  const [kind, setKind] = useState<FundKind>('pension');
  const [name, setName] = useState('');
  const [balance, setBalance] = useState(0);
  const [date, setDate] = useState(today);
  const [recurringId, setRecurringId] = useState('');
  const orders = props.data.recurring.filter(r => r.type === 'expense' && !r.endDate);
  const ok = !!name.trim() && balance > 0 && !!date && date <= today;
  return (
    <div class="card fund-form">
      <h2>קופה חדשה</h2>
      <div class="chips">
        {FUND_KINDS.map(([id, label]) => (
          <button
            key={id}
            class={`chip ${kind === id ? 'on' : ''}`}
            onClick={() => {
              setKind(id);
              if (!name.trim() || FUND_KINDS.some(([, l]) => l === name)) setName(id === 'other' ? '' : label);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <label class="field">
        <span>שם (למשל שם הקרן)</span>
        <input type="text" value={name} placeholder="קרן פנסיה" onInput={e => setName(e.currentTarget.value)} />
      </label>
      <p class="field-label">כמה יש בה עכשיו (לפי הדוח)</p>
      <MoneyInput value={balance} onChange={setBalance} />
      <label class="field">
        <span>נכון לתאריך</span>
        <input type="date" value={date} max={today} onInput={e => setDate(e.currentTarget.value)} />
      </label>
      {orders.length > 0 && (
        <label class="field">
          <span>הוראת קבע שמפקידה אליה (לא חובה)</span>
          <select value={recurringId} onChange={e => setRecurringId(e.currentTarget.value)}>
            <option value="">אין, יורד מהמשכורת</option>
            {orders.map(r => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div class="hero-buttons">
        <button
          disabled={!ok}
          onClick={() =>
            props.onSave({
              id: crypto.randomUUID(),
              name: name.trim(),
              kind,
              recurringId: recurringId || undefined,
              updates: [{ date, balance, deposits: 0 }],
              createdAt: new Date().toISOString(),
            })
          }
        >
          לשמור
        </button>
        <button class="secondary" onClick={props.onCancel}>
          ביטול
        </button>
      </div>
    </div>
  );
}

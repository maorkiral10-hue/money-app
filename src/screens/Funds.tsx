import { useState } from 'preact/hooks';
import { Chips, MoneyInput } from '../components/inputs';
import { dayLabel, todayStr } from '../data/dates';
import { putRecords } from '../data/db';
import { depositsSince, FUND_KINDS, fundsHistory, latest, saveFunds, totalEstimated, totalSaved, type Fund, type FundKind } from '../data/funds';
import { formatMoney } from '../data/money';
import { savingsCategoryIds } from '../data/budget';
import type { AppData } from '../data/store';
import type { Transaction } from '../data/types';

const kindName = (k: FundKind) => FUND_KINDS.find(([id]) => id === k)?.[1] ?? '';
const fullDate = (d: string) => d.split('-').reverse().map(Number).join('.');

/**
 * Long-term savings, from the side menu: pension, hishtalmut, gemel. For the picture only — none of it is
 * liquid money or part of the month. Balances are typed in from each fund's report; in between, what its
 * standing order and any extra deposits put in is added as an estimate. The history shows where everything
 * stood on each day an update was made.
 */
export function FundsScreen(props: { db: IDBDatabase; data: AppData; onBack: () => void; onChange: () => void; /** Inside the "הקופות שלי" tab: no header of its own. */ embedded?: boolean }) {
  const { data } = props;
  const today = todayStr();
  const funds = data.funds;
  const [adding, setAdding] = useState(false);
  const [updating, setUpdating] = useState<string | null>(null);
  const [depositing, setDepositing] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const lastUpdate = funds.map(f => latest(f)?.date).filter(Boolean).sort().pop();
  const total = totalEstimated(funds, data.transactions, today);

  const save = async (next: Fund[]) => {
    await saveFunds(props.db, next);
    props.onChange();
  };

  return (
    <>
      {!props.embedded && (
        <header class="top">
          <h1>חיסכון לטווח ארוך</h1>
          <button class="link" onClick={props.onBack}>
            חזרה
          </button>
        </header>
      )}
      <p class="muted small">
        לשיקוף בלבד: הכסף הזה לא נספר בכסף הנזיל ולא בחודש. מעדכנים יתרה מהדוח או מהאתר של הקרן, מתי שנוח. בין עדכון לעדכון מתווסף לבד מה שהפקדת בהוראת קבע או בהפקדה נוספת.
      </p>

      {funds.length > 0 && (
        <div class="card fund-total">
          <div class="muted small">סך הכל{total !== totalSaved(funds) ? ' (משוער)' : ''}</div>
          <div class="big-number sav">{formatMoney(total)}</div>
          {lastUpdate && <div class="muted small">עדכון אחרון מהדוחות: {dayLabel(lastUpdate, today)}</div>}
          <button class="link small" onClick={() => setShowHistory(!showHistory)} aria-expanded={showHistory}>
            {showHistory ? 'להסתיר את היסטוריית העדכונים' : 'היסטוריית עדכונים ‹'}
          </button>
        </div>
      )}

      {showHistory && <History db={props.db} funds={funds} onSave={save} />}

      {funds.map(f => {
        const last = latest(f);
        const since = depositsSince(f, data.transactions, today);
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
            </button>
            {open && (
              <div class="fund-stats">
                <label class="field">
                  <span>הוראת קבע שמפקידה אליה</span>
                  <select
                    value={f.recurringId ?? ''}
                    onChange={e => save(funds.map(x => (x.id === f.id ? { ...x, recurringId: e.currentTarget.value || undefined } : x)))}
                  >
                    <option value="">אין (יורד מהמשכורת)</option>
                    {data.recurring
                      .filter(r => r.type === 'expense' && (!r.endDate || r.id === f.recurringId))
                      .map(r => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                  </select>
                </label>
                <button
                  class="link small danger-link"
                  onClick={async () => {
                    if (!confirm(`למחוק את "${f.name}" ואת כל העדכונים שלה?\nהפקדות שנרשמו מהבנק נשארות ברשימת הפעולות.`)) return;
                    await save(funds.filter(x => x.id !== f.id));
                  }}
                >
                  מחיקת הקופה
                </button>
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
            ) : depositing === f.id ? (
              <DepositForm
                db={props.db}
                fund={f}
                data={data}
                onCancel={() => setDepositing(null)}
                onSaved={() => {
                  setDepositing(null);
                  props.onChange();
                }}
              />
            ) : (
              <div class="fund-buttons">
                <button class="secondary small-btn" onClick={() => setUpdating(f.id)}>
                  עדכון יתרה מהדוח
                </button>
                <button class="secondary small-btn" onClick={() => setDepositing(f.id)}>
                  + הפקדה נוספת
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

/**
 * Every day an update was made, newest first, with the total as it stood that day; tapping one shows each
 * fund's balance then. An update typed wrong can be fixed or deleted from there.
 */
function History(props: { db: IDBDatabase; funds: Fund[]; onSave: (funds: Fund[]) => void }) {
  const today = todayStr();
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ fundId: string; index: number; balance: number } | null>(null);
  const history = fundsHistory(props.funds);
  const change = (fundId: string, index: number, balance: number | null) =>
    props.onSave(
      props.funds.map(f =>
        f.id !== fundId ? f : { ...f, updates: balance === null ? f.updates.filter((_, i) => i !== index) : f.updates.map((u, i) => (i === index ? { ...u, balance } : u)) },
      ),
    );
  return (
    <div class="card fund-history-card">
      <h2 class="list-title">היסטוריית עדכונים</h2>
      {history.map(h => (
        <div key={h.date} class="fund-day">
          <button class="fund-day-head" onClick={() => setOpenDay(openDay === h.date ? null : h.date)} aria-expanded={openDay === h.date}>
            <span>
              {fullDate(h.date)}
              <span class={`chevron small-chevron ${openDay === h.date ? 'open' : ''}`}> ‹</span>
            </span>
            <strong class="sav">{formatMoney(h.total)}</strong>
          </button>
          {openDay === h.date && (
            <div class="fund-day-rows">
              {h.funds.map(r => {
                const here = r.asOf === h.date;
                const isEditing = editing?.fundId === r.fund.id && editing.index === r.index && here;
                return (
                  <div key={r.fund.id} class="fund-day-row">
                    <div class="line small">
                      <span>
                        {r.fund.name}
                        {!here && <span class="muted"> (עדכון מ־{fullDate(r.asOf)})</span>}
                      </span>
                      <span>
                        {formatMoney(r.balance)}
                        {here && !isEditing && (
                          <button class="link small" onClick={() => setEditing({ fundId: r.fund.id, index: r.index, balance: r.balance })}>
                            {' '}
                            ✎
                          </button>
                        )}
                      </span>
                    </div>
                    {isEditing && (
                      <div class="fund-edit">
                        <MoneyInput value={editing.balance} onChange={v => setEditing({ ...editing, balance: v })} />
                        <div class="hero-buttons">
                          <button
                            disabled={editing.balance <= 0}
                            onClick={() => {
                              change(r.fund.id, r.index, editing.balance);
                              setEditing(null);
                            }}
                          >
                            לתקן
                          </button>
                          <button class="secondary" onClick={() => setEditing(null)}>
                            ביטול
                          </button>
                        </div>
                        {r.fund.updates.length > 1 ? (
                          <button
                            class="link small danger-link"
                            onClick={() => {
                              if (!confirm(`למחוק את העדכון של "${r.fund.name}" מ־${fullDate(h.date)}?`)) return;
                              change(r.fund.id, r.index, null);
                              setEditing(null);
                            }}
                          >
                            למחוק את העדכון הזה
                          </button>
                        ) : (
                          <p class="muted small">זה העדכון היחיד של הקופה. כדי להסיר אותו, מוחקים את הקופה.</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** A new balance from the fund's report. */
function UpdateForm(props: { fund: Fund; data: AppData; onCancel: () => void; onSave: (u: { date: string; balance: number; deposits: number }) => void }) {
  const { fund } = props;
  const today = todayStr();
  const last = latest(fund);
  const [date, setDate] = useState(today);
  const [balance, setBalance] = useState(0);
  const ok = balance > 0 && !!date && date <= today && (!last || date >= last.date);
  return (
    <div class="fund-form">
      <p class="field-label">כמה יש בקופה (לפי הדוח)</p>
      <MoneyInput value={balance} onChange={setBalance} autoFocus />
      <label class="field">
        <span>נכון לתאריך</span>
        <input type="date" value={date} min={last?.date} max={today} onInput={e => setDate(e.currentTarget.value)} />
      </label>
      <div class="hero-buttons">
        <button disabled={!ok} onClick={() => props.onSave({ date, balance, deposits: last ? depositsSince(fund, props.data.transactions, date) : 0 })}>
          לשמור
        </button>
        <button class="secondary" onClick={props.onCancel}>
          ביטול
        </button>
      </div>
    </div>
  );
}

/**
 * An extra deposit into the fund, from the bank (or cash): recorded as money put into savings — out of the
 * account, in the month's orange savings tile, not spending — and added to the fund's estimated balance.
 */
function DepositForm(props: { db: IDBDatabase; fund: Fund; data: AppData; onCancel: () => void; onSaved: () => void }) {
  const { data, fund } = props;
  const today = todayStr();
  const methods = data.methods.filter(m => m.kind !== 'credit' && !m.archived && m.name.trim());
  const saving = savingsCategoryIds(data);
  const order = data.recurring.find(r => r.id === fund.recurringId);
  // The category its standing order uses, or one marked as savings; otherwise any expense category
  const savingCats = data.categories.filter(c => c.kind === 'expense' && saving.has(c.id) && !c.archived);
  const categories = savingCats.length ? savingCats : data.categories.filter(c => c.kind === 'expense' && !c.archived && c.name.trim());
  const [amount, setAmount] = useState(0);
  const [date, setDate] = useState(today);
  const [methodId, setMethodId] = useState(order?.methodId && methods.some(m => m.id === order.methodId) ? order.methodId : methods.find(m => m.kind === 'bank')?.id ?? methods[0]?.id);
  const [categoryId, setCategoryId] = useState(order?.categoryId ?? savingCats[0]?.id);
  const ok = amount > 0 && !!date && date <= today && !!methodId && !!categoryId;
  const add = async () => {
    const now = new Date().toISOString();
    const t: Transaction = { id: crypto.randomUUID(), type: 'expense', amount, date, methodId, categoryId, note: `הפקדה נוספת ל${fund.name}`, fundId: fund.id, createdAt: now, updatedAt: now };
    await putRecords(props.db, 'transactions', [t]);
    props.onSaved();
  };
  return (
    <div class="fund-form">
      <p class="field-label">כמה הפקדת</p>
      <MoneyInput value={amount} onChange={setAmount} autoFocus />
      <label class="field">
        <span>מתי</span>
        <input type="date" value={date} max={today} onInput={e => setDate(e.currentTarget.value)} />
      </label>
      <p class="field-label">מאיפה יצא הכסף</p>
      <Chips items={methods} value={methodId} onChange={setMethodId} />
      <p class="field-label">קטגוריה</p>
      <Chips items={categories} value={categoryId} onChange={setCategoryId} />
      {!savingCats.length && <p class="muted small">כדאי לסמן קטגוריה כ"חיסכון" (בהגדרות הקטגוריות), כדי שההפקדה תופיע באריח החיסכון ולא בהוצאות.</p>}
      <div class="hero-buttons">
        <button disabled={!ok} onClick={add}>
          לרשום הפקדה
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

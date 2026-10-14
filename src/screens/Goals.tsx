import { useState } from 'preact/hooks';
import { AnimatedMoney } from '../components/AnimatedMoney';
import { Chips, MoneyInput, Segmented } from '../components/inputs';
import { summarize } from '../data/balance';
import { dayLabel, todayStr } from '../data/dates';
import { deleteRecord, putRecords } from '../data/db';
import { goalNumbers, goalPlan } from '../data/goals';
import { formatMoney } from '../data/money';
import type { AppData } from '../data/store';
import type { Account, Transaction } from '../data/types';
import { FundsScreen } from './Funds';

/** Which part of the tab was open last, kept while the app is open. */
let lastPart: 'goals' | 'long' = 'goals';

/** Where a goal's money is, in words. */
export const placeText = (g: Account, data: Pick<AppData, 'accounts'>) => {
  const source = data.accounts.find(a => a.id === g.goalSource)?.name;
  if (g.goalPlace === 'inside') return `בתוך ${source ?? 'הכסף הנזיל'} (מסומן)`;
  if (g.goalPlace === 'envelope') return 'מזומן בצד';
  return 'בצד, בפיקדון';
};

const shortDate = (d: string) => d.split('-').reverse().map(Number).slice(0, 3).join('.');

/**
 * "הקופות שלי": savings goals (money put aside to spend later) and long-term savings (pension and the like, for
 * the picture only), each its own part, never added up together.
 */
export function GoalsTab(props: { db: IDBDatabase; data: AppData; onOpen: (goal: Account) => void; onNew: () => void; onChange: () => void }) {
  const { data } = props;
  const [part, setPart] = useState(lastPart);
  const pick = (p: 'goals' | 'long') => {
    lastPart = p;
    setPart(p);
  };
  const today = todayStr();
  const { goals } = summarize(data, today);
  const active = goals.filter(g => !g.account.archived);
  const total = active.reduce((a, g) => a + g.balance, 0);
  const reservedTotal = active.filter(g => g.account.goalPlace === 'inside').reduce((a, g) => a + g.balance, 0);

  return (
    <>
      <header class="top">
        <h1>הקופות שלי</h1>
      </header>
      <Segmented
        value={part}
        onChange={pick}
        options={[
          ['goals', 'יעדים'],
          ['long', 'לטווח ארוך'],
        ]}
      />
      {part === 'long' ? (
        <FundsScreen embedded db={props.db} data={data} onBack={() => pick('goals')} onChange={props.onChange} />
      ) : (
      <>

      {active.length === 0 ? (
        <div class="card locked">
          <h2>עוד אין יעדים</h2>
          <p class="muted">חופשה, רכב, כרית ביטחון… לכל יעד יש "קופה" משלו. מעבירים אליה כסף מהכסף הנזיל, ואפשר גם להחזיר.</p>
          <button onClick={props.onNew}>יעד ראשון</button>
        </div>
      ) : (
        <>
          <div class="card hero">
            <div class="muted small">נחסך ביעדים</div>
            <div class="big-number sav">
              <AnimatedMoney value={total} />
            </div>
            <div class="muted small">
              {reservedTotal > 0 && reservedTotal < total
                ? `מתוכם ${formatMoney(reservedTotal)} בתוך הכסף הנזיל (רק מסומן), והשאר בצד`
                : reservedTotal > 0
                  ? 'הכל בתוך הכסף הנזיל, רק מסומן כשמור'
                  : 'בצד, ולא נספר בכסף הנזיל'}
            </div>
          </div>
          {active.map(({ account: g, balance }) => {
            const plan = goalPlan(g, balance, data.transactions, today);
            return (
              <button key={g.id} class="card goal-card" onClick={() => props.onOpen(g)}>
                <div class="line">
                  <span class="goal-name">{g.name}</span>
                  <span class="sav">
                    {formatMoney(balance)}
                    {g.goalTarget ? <span class="muted small"> מתוך {formatMoney(g.goalTarget)}</span> : null}
                  </span>
                </div>
                {plan.progress !== undefined && (
                  <div class={`bar goal-bar ${plan.reached ? 'done' : ''}`}>
                    <span style={{ width: `${Math.min(1, plan.progress) * 100}%` }} />
                  </div>
                )}
                <div class="muted small">
                  {plan.reached
                    ? '🎉 היעד הושג'
                    : [
                        placeText(g, data),
                        g.goalDate && `עד ${shortDate(g.goalDate)}`,
                        plan.perMonth && `צריך ${formatMoney(plan.perMonth)} בחודש`,
                        plan.perMonth && plan.thisMonth > 0 && (plan.leftThisMonth ? `החודש הועבר ${formatMoney(plan.thisMonth)}` : 'החודש ✓'),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                </div>
              </button>
            );
          })}
          <button class="secondary" onClick={props.onNew}>
            + יעד חדש
          </button>
        </>
      )}
      </>
      )}
    </>
  );
}

/** One goal: move money into it or out of it, see the moves, edit or remove it. */
export function GoalDetail(props: { db: IDBDatabase; data: AppData; goalId: string; onBack: () => void; onEdit: () => void; onChange: () => void }) {
  const { data } = props;
  const today = todayStr();
  const summary = summarize(data, today);
  const entry = summary.goals.find(g => g.account.id === props.goalId);
  const liquid = data.accounts.filter(a => !a.archived && a.kind !== 'goal' && a.name.trim());
  const [dir, setDir] = useState<'in' | 'out' | 'spend'>('in');
  const [spendCategory, setSpendCategory] = useState<string | undefined>();
  const expenseCategories = data.categories.filter(c => c.kind === 'expense' && c.name.trim() && !c.archived);
  const [amount, setAmount] = useState(0);
  const goalAccount = data.accounts.find(a => a.id === props.goalId);
  // A goal inside a source moves only within that source; one apart can take from anywhere
  const [accountId, setAccountId] = useState(
    goalAccount?.goalPlace === 'inside' && goalAccount.goalSource ? goalAccount.goalSource : liquid.find(a => a.kind === 'bank')?.id ?? liquid[0]?.id,
  );
  const [formKey, setFormKey] = useState(0);
  if (!entry) return null;
  const { account: goal, balance } = entry;
  const plan = goalPlan(goal, balance, data.transactions, today);
  const nums = goalNumbers(goal, balance, data.transactions);
  const inside = goal.goalPlace === 'inside' && !!goal.goalSource;
  const [showPaid, setShowPaid] = useState(false);
  const paidList = data.transactions
    .filter(t => t.type === 'expense' && (t.accountId === goal.id || t.goalId === goal.id))
    .sort((a, b) => b.date.localeCompare(a.date));
  const howPaid = (t: Transaction) =>
    t.accountId === goal.id ? 'מתוך היעד' : `${data.methods.find(m => m.id === t.methodId)?.name ?? ''}${data.transactions.some(x => x.coverFor === t.id) ? ' · מהכסף שבצד' : ''}`;
  const moves = data.transactions.filter(t => t.accountId === goal.id || t.toAccountId === goal.id).sort((a, b) => b.date.localeCompare(a.date));
  const name = (id?: string) => data.accounts.find(a => a.id === id)?.name ?? '';
  const catName = (id?: string) => data.categories.find(c => c.id === id)?.name ?? '';
  const tooMuch = dir !== 'in' && amount > balance;
  const categoryId = spendCategory ?? goal.goalCategoryId;
  const ready = !!amount && !tooMuch && (dir === 'spend' ? !!categoryId : !!accountId);

  const move = async () => {
    if (!ready) return;
    const now = new Date().toISOString();
    const tx: Transaction = dir === 'spend' ? { id: crypto.randomUUID(), type: 'expense', amount, date: today, categoryId, accountId: goal.id, note: goal.name, createdAt: now, updatedAt: now } : {
      id: crypto.randomUUID(),
      type: 'transfer',
      amount,
      date: today,
      accountId: dir === 'in' ? accountId : goal.id,
      toAccountId: dir === 'in' ? goal.id : accountId,
      note: dir === 'in' ? `ליעד ${goal.name}` : `מהיעד ${goal.name}`,
      createdAt: now,
      updatedAt: now,
    };
    await putRecords(props.db, 'transactions', [tx]);
    setAmount(0);
    setFormKey(k => k + 1);
    props.onChange();
  };

  const remove = async () => {
    if (balance !== 0 && !inside) return alert(`ביעד יש עדיין ${formatMoney(balance)}. קודם העבר אותו בחזרה לכסף הנזיל.`);
    if (!confirm(inside && balance ? `למחוק את היעד "${goal.name}"? ה־${formatMoney(balance)} השמורים בו יחזרו להיות פנויים (הכסף לא זז).` : `למחוק את היעד "${goal.name}"?`)) return;
    // Its past moves stay in the statement, so a goal that had any is hidden rather than removed
    const hidden: Account = { ...goal, archived: true };
    if (moves.length) await putRecords(props.db, 'accounts', [hidden]);
    else await deleteRecord(props.db, 'accounts', goal.id);
    props.onChange();
    props.onBack();
  };

  return (
    <>
      <header class="top">
        <h1>{goal.name}</h1>
        <button class="link" onClick={props.onBack}>
          חזרה
        </button>
      </header>

      <div class="card hero">
        <div class="muted small">נשאר ביעד · {placeText(goal, data)}</div>
        <div class="big-number sav">
          <AnimatedMoney value={balance} />
        </div>
        {plan.progress !== undefined && (
          <div class={`bar goal-bar ${plan.reached ? 'done' : ''}`}>
            <span style={{ width: `${Math.min(1, plan.progress) * 100}%` }} />
          </div>
        )}
        <div class="goal-numbers">
          {goal.goalTarget ? (
            <div class="line">
              <span>היעד</span>
              <span>{formatMoney(goal.goalTarget)}</span>
            </div>
          ) : null}
          <div class="line">
            <span>{inside ? 'סומן כשמור עד עכשיו' : 'הופקד עד עכשיו'}</span>
            <span>{formatMoney(nums.deposited)}</span>
          </div>
          <button class="line goal-paid" onClick={() => setShowPaid(!showPaid)} aria-expanded={showPaid} disabled={!paidList.length}>
            <span>שולם על היעד{paidList.length ? (showPaid ? ' ›' : ' ‹') : ''}</span>
            <span>{formatMoney(nums.paid)}</span>
          </button>
          {showPaid && (
            <div class="goal-paid-list">
              {paidList.map(t => (
                <div key={t.id} class="line small">
                  <span>
                    {t.note && t.note !== goal.name ? t.note : catName(t.categoryId)} · {dayLabel(t.date, today)} · <span class="muted">{howPaid(t)}</span>
                  </span>
                  <span>{formatMoney(t.amount)}</span>
                </div>
              ))}
            </div>
          )}
          <div class="line">
            <span>נשאר ביעד</span>
            <span>{formatMoney(nums.left)}</span>
          </div>
          {nums.toSave !== undefined && (
            <div class="line goal-tosave">
              <span>נשאר לחסוך</span>
              <span>{formatMoney(nums.toSave)}</span>
            </div>
          )}
        </div>
        <div class="small">
          {plan.reached
            ? `🎉 היעד הושג${nums.surplus > 0 ? ` · יש ${formatMoney(nums.surplus)} מעבר` : ''}`
            : plan.perMonth
              ? `כדי להגיע ${goal.goalDate ? `עד ${shortDate(goal.goalDate)}` : 'בזמן'}: ${formatMoney(plan.perMonth)} בחודש${plan.monthsLeft ? ` (${plan.monthsLeft} חודשים)` : ''}`
              : ''}
        </div>
        {plan.perMonth && !plan.reached ? (
          <div class="muted small">
            {plan.leftThisMonth ? `נשאר להכניס החודש: ${formatMoney(plan.leftThisMonth)}` : '✓ הסכום של החודש כבר הוכנס'}
            {plan.thisMonth ? ` (הוכנסו ${formatMoney(plan.thisMonth)})` : ''}
          </div>
        ) : null}
        {goal.goalCategoryId && <div class="muted small">קטגוריה: {catName(goal.goalCategoryId)}</div>}
      </div>

      <div class="card">
        <Segmented
          value={dir}
          onChange={setDir}
          options={[
            ['in', inside ? 'לשמור עוד' : 'הפקדה'],
            ['out', inside ? 'לשחרר' : 'החזרה לנזיל'],
            ['spend', 'הוצאה מהיעד'],
          ]}
        />
        <label class="field">
          <span>כמה</span>
          <MoneyInput key={formKey} value={amount} onChange={setAmount} />
        </label>
        {dir === 'in' && plan.leftThisMonth > 0 && !plan.reached && (
          <button
            type="button"
            class="link small"
            onClick={() => {
              setAmount(plan.leftThisMonth);
              setFormKey(k => k + 1);
            }}
          >
            להכניס את מה שנשאר לחודש הזה ({formatMoney(plan.leftThisMonth)})
          </button>
        )}
        {dir === 'spend' ? (
          <>
            <p class="field-label">על מה</p>
            <Chips items={expenseCategories} value={categoryId} onChange={setSpendCategory} />
            <p class="muted small">נרשם כהוצאה בקטגוריה הזאת, והכסף יורד מהיעד (לא מהכסף הנזיל).</p>
          </>
        ) : (
          inside ? (
            <p class="muted small">
              {dir === 'in'
                ? `מסמן עוד כסף ב${name(goal.goalSource)} כשמור ליעד. הכסף לא זז.`
                : `הכסף השמור ב${name(goal.goalSource)} חוזר להיות פנוי לשימוש. הכסף לא זז.`}
            </p>
          ) : (
          <>
            <p class="field-label">{dir === 'in' ? 'מאיפה' : 'לאן'}</p>
            <Chips items={liquid} value={accountId} onChange={setAccountId} />
          </>
          )
        )}
        {tooMuch && <p class="small warn">ביעד יש רק {formatMoney(balance)}</p>}
        <button disabled={!ready} onClick={move}>
          {dir === 'in' ? (inside ? 'לשמור' : 'להעביר ליעד') : dir === 'out' ? (inside ? 'לשחרר' : 'להחזיר לכסף הנזיל') : 'לרשום הוצאה'}
        </button>
      </div>

      {moves.length > 0 && (
        <div class="card list">
          <h2 class="list-title">תנועות</h2>
          {moves.map(t => (
            <div key={t.id} class="tx">
              <div>
                <div>
                {t.type === 'expense'
                  ? `הוצאה: ${catName(t.categoryId)}`
                  : inside
                    ? t.toAccountId === goal.id
                      ? 'סומן כשמור'
                      : 'שוחרר'
                    : t.toAccountId === goal.id
                      ? `מ${name(t.accountId)}`
                      : `ל${name(t.toAccountId)}`}
              </div>
                <div class="muted small">{dayLabel(t.date, today)}</div>
              </div>
              <div class={t.toAccountId === goal.id ? 'inc' : 'exp'}>{formatMoney(t.toAccountId === goal.id ? t.amount : -t.amount, { sign: true })}</div>
            </div>
          ))}
        </div>
      )}

      <button class="secondary" onClick={props.onEdit}>
        עריכת היעד
      </button>
      <button class="danger" onClick={remove}>
        מחיקת היעד
      </button>
    </>
  );
}

/** A new goal, or editing one: a target by a date, or a fixed amount every month. */
export function GoalForm(props: { db: IDBDatabase; data: AppData; goal?: Account; onDone: (goal?: Account) => void; onCancel: () => void }) {
  const g = props.goal;
  const [name, setName] = useState(g?.name ?? '');
  const [kind, setKind] = useState<'target' | 'monthly'>(g?.goalMonthly && !g.goalTarget ? 'monthly' : 'target');
  const [target, setTarget] = useState(g?.goalTarget ?? 0);
  const [date, setDate] = useState(g?.goalDate ?? '');
  const [monthly, setMonthly] = useState(g?.goalMonthly ?? 0);
  const [already, setAlready] = useState(g?.openingBalance ?? 0);
  const [categoryId, setCategoryId] = useState(g?.goalCategoryId);
  const [place, setPlace] = useState<'deposit' | 'envelope' | 'inside'>(g?.goalPlace ?? 'deposit');
  const sources = props.data.accounts.filter(a => !a.archived && a.kind !== 'goal' && a.name.trim());
  const [source, setSource] = useState(g?.goalSource ?? sources.find(a => a.kind === 'bank')?.id ?? sources[0]?.id);
  const held = g ? summarize(props.data, todayStr()).goals.find(x => x.account.id === g.id)?.balance ?? 0 : 0;
  const placeChanged = !!g && held > 0 && ((g.goalPlace ?? 'deposit') !== place || (place === 'inside' && g.goalSource !== source));
  const categories = props.data.categories.filter(c => c.kind === 'expense' && c.name.trim() && (!c.archived || c.id === g?.goalCategoryId));
  const valid = name.trim() && categoryId && (kind === 'target' ? target > 0 : monthly > 0) && (place !== 'inside' || !!source);

  const sourceName = sources.find(a => a.id === source)?.name ?? '';
  const placeChangeText =
    place === 'inside'
      ? `ה־${formatMoney(held)} שביעד יחזרו להיות חלק מהיתרה של ${sourceName}, מסומנים כשמורים (בבדיקה מול ${sourceName} הם ייספרו).`
      : `ה־${formatMoney(held)} שביעד ייצאו מהכסף הנזיל, כי הם עכשיו בצד.`;

  const save = async () => {
    if (!valid) return;
    const goal: Account = {
      id: g?.id ?? crypto.randomUUID(),
      name: name.trim(),
      kind: 'goal',
      openingBalance: already,
      order: g?.order ?? props.data.accounts.length,
      goalTarget: kind === 'target' ? target : undefined,
      goalDate: kind === 'target' && date ? date : undefined,
      goalMonthly: kind === 'monthly' ? monthly : undefined,
      goalCategoryId: categoryId,
      goalPlace: place,
      // Inside: the source it's in. Apart: where its money comes back to (a deposit: the bank; an envelope: cash)
      goalSource: place === 'inside' ? source : place === 'envelope' ? sources.find(a => a.kind === 'cash')?.id : sources.find(a => a.kind === 'bank')?.id,
    };
    if (placeChanged && !confirm(placeChangeText)) return;
    await putRecords(props.db, 'accounts', [goal]);
    props.onDone(goal);
  };

  return (
    <div class="sheet">
      <header class="top">
        <button class="link" onClick={props.onCancel}>
          ביטול
        </button>
        <h1>{g ? 'עריכת יעד' : 'יעד חדש'}</h1>
        <span style={{ width: '40px' }} />
      </header>

      <section>
        <h2>שם</h2>
        <input type="text" value={name} placeholder="למשל: חופשה ביוון, רכב, כרית ביטחון" onInput={e => setName(e.currentTarget.value)} />
      </section>

      <section>
        <h2>לאיזו קטגוריה</h2>
        <Chips items={categories} value={categoryId} onChange={setCategoryId} />
        <p class="muted small">כשתוציא את הכסף מהיעד (למשל כשתשלם על החופשה), זו תהיה הוצאה בקטגוריה הזאת.</p>
      </section>

      <section>
        <h2>איזה יעד</h2>
        <Segmented
          value={kind}
          onChange={setKind}
          options={[
            ['target', 'סכום להגיע אליו'],
            ['monthly', 'סכום קבוע כל חודש'],
          ]}
        />
        {kind === 'target' ? (
          <>
            <label class="field">
              <span>כמה צריך</span>
              <MoneyInput value={target} onChange={setTarget} />
            </label>
            <label class="field">
              <span>עד מתי (לא חובה)</span>
              <input type="date" value={date} onChange={e => setDate(e.currentTarget.value)} />
            </label>
            <p class="muted small">עם תאריך, האפליקציה תחשב כמה להכניס כל חודש כדי להגיע בזמן.</p>
          </>
        ) : (
          <label class="field">
            <span>כמה לשים בצד כל חודש</span>
            <MoneyInput value={monthly} onChange={setMonthly} />
          </label>
        )}
      </section>

      <section>
        <h2>איפה הכסף של היעד?</h2>
        <div class="place-options">
          {(
            [
              ['deposit', 'בצד: פיקדון או חשבון נפרד', 'הכסף יוצא מהכסף הנזיל.'],
              ['envelope', 'בצד: מזומן במעטפה', 'כסף שלא סופרים עם הארנק. יוצא מהכסף הנזיל.'],
              ['inside', 'בתוך הכסף הנזיל', 'נשאר בבנק (או במזומן, בביט), רק מסומן כשמור. בבדיקה מול הבנק הוא נספר.'],
            ] as const
          ).map(([id, title, hint]) => (
            <button key={id} type="button" class={`tile place-tile ${place === id ? 'on' : ''}`} onClick={() => setPlace(id)}>
              {title}
              <span class="small">{hint}</span>
            </button>
          ))}
        </div>
        {place === 'inside' && (
          <>
            <p class="field-label">בתוך</p>
            <Chips items={sources} value={source} onChange={setSource} />
          </>
        )}
        {placeChanged && <p class="small warn">{placeChangeText}</p>}
      </section>

      {!g && (
        <section>
          <h2>כבר חסכת לזה?</h2>
          <label class="field">
            <span>{place === 'inside' ? 'כמה כבר שמור לזה מתוך הכסף הנזיל' : 'כמה כבר יש בצד (לא יורד מהכסף הנזיל)'}</span>
            <MoneyInput value={already} onChange={setAlready} />
          </label>
        </section>
      )}

      <button disabled={!valid} onClick={save}>
        שמור
      </button>
    </div>
  );
}

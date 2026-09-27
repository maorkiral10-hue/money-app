import { useState } from 'preact/hooks';
import { AnimatedMoney } from '../components/AnimatedMoney';
import { MoneyInput, Segmented } from '../components/inputs';
import { budgetStatus, monthCommitments, usualSpending, type Budget, type BudgetLine } from '../data/budget';
import { periodEnd, periodKey, periodStart } from '../data/dashboard';
import { categoryColor } from '../data/colors';
import { putRecords, setMeta } from '../data/db';
import { dayLabel, todayStr } from '../data/dates';
import { formatMoney } from '../data/money';
import type { AppData } from '../data/store';
import type { Category } from '../data/types';

/** The budget tab: locked until its questionnaire is filled, then how the month stands against the limits. */
export function BudgetTab(props: { data: AppData; onEdit: () => void }) {
  const { data } = props;
  const today = todayStr();
  const [showFixed, setShowFixed] = useState(false);

  if (!data.budget) {
    return (
      <>
        <header class="top">
          <h1>תקציב</h1>
        </header>
        <div class="card locked">
          <div class="lock-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
              <rect x="5" y="11" width="14" height="10" rx="2" />
              <path d="M8 11V8a4 4 0 0 1 8 0v3" />
            </svg>
          </div>
          <h2>התקציב עוד לא מוגדר</h2>
          <p class="muted">שלוש שאלות קצרות: כמה להוציא בחודש, תקרה לקטגוריות שחשובות לך, ואיך להתייחס לכסף שעובר לחיסכון.</p>
          <button onClick={props.onEdit}>בוא נגדיר</button>
        </div>
      </>
    );
  }

  const status = budgetStatus(data, today)!;
  const fixedTotal = status.commitments.reduce((a, c) => a + c.amount, 0);
  const paid = status.commitments.reduce((a, c) => a + c.paid, 0);
  const name = (id: string) => data.categories.find(c => c.id === id)?.name ?? 'ללא קטגוריה';

  return (
    <>
      <header class="top">
        <h1>תקציב</h1>
      </header>

      {status.overall && (
        <div class="card hero">
          <div class={`small ${status.overall.remaining >= 0 ? 'inc' : 'exp'}`}>{status.overall.remaining >= 0 ? 'נשאר להוציא החודש' : 'חריגה מהתקציב'}</div>
          <div class={`big-number ${status.overall.remaining >= 0 ? 'inc' : 'exp'}`}>
            <AnimatedMoney value={Math.abs(status.overall.remaining)} />
          </div>
          <Meter line={status.overall} color={status.overall.remaining >= 0 ? 'var(--inc-bar)' : 'var(--exp-bar)'} />
          <div class="budget-parts">
            {status.fixedMode === 'included' && (
              <div class="line">
                <span>הוראות קבע וקבועות</span>
                <span class="exp">{formatMoney(-status.overall.fixed)}</span>
              </div>
            )}
            <div class="line">
              <span>הוצאות יומיומיות</span>
              <span class="exp">{formatMoney(-status.overall.spent)}</span>
            </div>
            <div class="line muted">
              <span>מתוך תקציב של</span>
              <span>{formatMoney(status.overall.limit)}</span>
            </div>
          </div>
          {status.overall.remaining > 0 && (
            <div class="per-day">
              עד {dayLabel(status.end, today)}: <b>{formatMoney(status.overall.perDay)}</b> ליום ({status.daysLeft} ימים)
            </div>
          )}
        </div>
      )}

      {status.commitments.length > 0 && (
        <div class="card">
          <button class="section-head flat" onClick={() => setShowFixed(!showFixed)} aria-expanded={showFixed}>
            <span>
              <span class="section-title">הוראות קבע החודש</span>
              <span class="muted small block">
                {status.fixedMode === 'included' ? 'כבר ירדו מהתקציב' : 'בנפרד מהתקציב'} · ירד כבר {formatMoney(paid)}
              </span>
            </span>
            <span class="section-value exp">
              <AnimatedMoney value={-fixedTotal} /> <span class={`chevron ${showFixed ? 'open' : ''}`}>‹</span>
            </span>
          </button>
          {showFixed &&
            status.commitments.map(c => (
              <div key={c.rec.id} class="tx">
                <div>
                  <div>
                    <span class="cat-dot" style={{ background: categoryColor(c.rec.categoryId, data.categories) }} />
                    {c.rec.name}
                  </div>
                  <div class="muted small">
                    {c.dates.map(d => dayLabel(d, today)).join(', ')} · {c.paid >= c.amount ? 'ירד' : c.paid > 0 ? 'ירד בחלקו' : 'עוד ירד'}
                  </div>
                </div>
                <div class="amount expense">{formatMoney(-c.amount)}</div>
              </div>
            ))}
        </div>
      )}

      {status.categories.length > 0 && (
        <div class="card">
          <h2>לפי קטגוריה</h2>
          {status.categories.map(c => {
            const used = c.spent + c.fixed;
            const left = c.limit - used;
            return (
              <div key={c.categoryId} class="budget-row">
                <div class="line">
                  <span>
                    <span class="cat-dot" style={{ background: categoryColor(c.categoryId, data.categories) }} />
                    {name(c.categoryId)}
                  </span>
                  <span class={left >= 0 ? '' : 'exp'}>
                    {left >= 0 ? `נשאר ${formatMoney(left)}` : `חריגה ${formatMoney(-left)}`}
                  </span>
                </div>
                <Meter line={c} color={left >= 0 ? categoryColor(c.categoryId, data.categories) : 'var(--exp-bar)'} />
                <div class="muted small">
                  {formatMoney(used)} מתוך {formatMoney(c.limit)}
                  {c.fixed > 0 && ` (כולל ${formatMoney(c.fixed)} הוראות קבע)`}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Only once something was actually moved to savings this month */}
      {data.budget.savingsMode === 'separate' && status.saved > 0 && (
        <div class="card">
          <div class="line">
            <span class="inc">הועבר לחיסכון החודש</span>
            <span class="inc">{formatMoney(status.saved)}</span>
          </div>
          <p class="muted small">
            מה שרשמת בקטגוריה "{data.categories.find(c => c.id === data.budget!.savingsCategoryId)?.name ?? 'חיסכון'}". הכסף ירד מהכסף הנזיל,
            אבל הוא לא הוצאה, ולכן לא נספר בתקציב.
          </p>
        </div>
      )}

      <button class="secondary" onClick={props.onEdit}>
        עריכת התקציב
      </button>
    </>
  );
}

/** Standing orders (light) and day-to-day spending (solid) out of a limit. */
function Meter(props: { line: BudgetLine; color: string }) {
  const { limit, spent, fixed } = props.line;
  const whole = Math.max(limit, spent + fixed, 1);
  return (
    <div class="bar split meter">
      <span class="expected" style={{ width: `${(fixed / whole) * 100}%`, background: props.color }} />
      <span style={{ width: `${(spent / whole) * 100}%`, background: props.color }} />
      {spent + fixed > limit && <i class="limit-mark" style={{ right: `${(limit / whole) * 100}%` }} />}
    </div>
  );
}

/** The budget questionnaire: first time it unlocks the tab; later it edits the same answers. */
export function BudgetSetup(props: { db: IDBDatabase; data: AppData; onDone: () => void; onCancel: () => void }) {
  const { data } = props;
  const today = todayStr();
  const usual = usualSpending(data, today);
  const existing = data.budget;
  const expenseCats = data.categories.filter(c => c.kind === 'expense' && !c.archived && c.name.trim());
  const [step, setStep] = useState(0);
  const [overall, setOverall] = useState(existing?.overall ?? 0);
  const [limits, setLimits] = useState<Record<string, number>>(existing?.categories ?? {});
  const [fixedMode, setFixedMode] = useState<NonNullable<Budget['fixedMode']>>(existing?.fixedMode ?? 'included');
  const monthFixed = (() => {
    const key = periodKey(today, data.monthStartDay);
    return monthCommitments(data, periodStart(key, data.monthStartDay), periodEnd(key, data.monthStartDay), today).reduce((a, c) => a + c.amount, 0);
  })();
  const [savingsMode, setSavingsMode] = useState<Budget['savingsMode']>(existing?.savingsMode ?? 'separate');
  const [savingsCategoryId, setSavingsCategoryId] = useState(existing?.savingsCategoryId ?? expenseCats.find(c => c.name.includes('חיסכון'))?.id ?? '');
  const [saving, setSaving] = useState(false);
  const usualText = (n: number) => (usual.basedOnFinishedMonths ? `בממוצע: ${formatMoney(Math.round(n))}` : `עד עכשיו החודש: ${formatMoney(Math.round(n))}`);

  const finish = async () => {
    setSaving(true);
    let catId = savingsCategoryId;
    if (savingsMode === 'separate' && !catId) {
      // No savings category yet: add one, so moving money to savings can be recorded like any entry
      catId = crypto.randomUUID();
      const savings: Category = { id: catId, name: 'חיסכון', kind: 'expense', order: data.categories.length };
      await putRecords(props.db, 'categories', [savings]);
    }
    const budget: Budget = {
      overall: overall > 0 ? overall : undefined,
      categories: Object.fromEntries(Object.entries(limits).filter(([, v]) => v > 0)),
      savingsMode,
      savingsCategoryId: savingsMode === 'separate' ? catId : undefined,
      fixedMode,
    };
    await setMeta(props.db, 'budget', budget);
    props.onDone();
  };

  return (
    <div class="sheet onboarding">
      <header class="top">
        <button class="link" onClick={step === 0 ? props.onCancel : () => setStep(step - 1)}>
          {step === 0 ? 'ביטול' : '→ חזרה'}
        </button>
        <span class="muted small">שאלה {step + 1} מתוך 4</span>
      </header>

      {step === 0 && (
        <>
          <h1>כמה אתה רוצה להוציא בחודש?</h1>
          <p class="muted">סכום כולל להוצאות החודש. בשאלה הבאה תחליט אם הוראות הקבע בתוכו. אפשר להשאיר ריק אם אתה רוצה רק תקרות לקטגוריות.</p>
          <div class="card">
            <MoneyInput value={overall} onChange={setOverall} />
            {usual.overall > 0 && <p class="muted small">{usualText(usual.overall)}</p>}
          </div>
          <button onClick={() => setStep(1)}>המשך</button>
        </>
      )}

      {step === 1 && (
        <>
          <h1>הוראות קבע והוצאות קבועות</h1>
          <p class="muted">שכר דירה, ועד בית, טלפון, מנויים… {monthFixed > 0 && <>החודש הן מסתכמות ב-<b>{formatMoney(monthFixed)}</b>.</>}</p>
          <div class="card">
            <Segmented
              value={fixedMode}
              onChange={setFixedMode}
              options={[
                ['included', 'חלק מהתקציב'],
                ['separate', 'בנפרד'],
              ]}
            />
            <p class="muted small">
              {fixedMode === 'included'
                ? 'הן יורדות מהתקציב כבר בתחילת החודש, ותראה כמה נשאר אחריהן להוצאות היומיומיות.'
                : 'התקציב רק להוצאות היומיומיות. הוראות הקבע יוצגו לידו, בלי להיספר בו.'}
            </p>
          </div>
          <button onClick={() => setStep(2)}>המשך</button>
        </>
      )}

      {step === 2 && (
        <>
          <h1>תקרה לקטגוריות</h1>
          <p class="muted">מלא רק בקטגוריות שחשוב לך לשמור עליהן, למשל אוכל בחוץ או קניות. השאר ריק בשאר.</p>
          <div class="card">
            {expenseCats
              .filter(c => c.id !== savingsCategoryId || savingsMode !== 'separate')
              .map(c => (
                <label key={c.id} class="field budget-field">
                  <span>
                    <span class="cat-dot" style={{ background: categoryColor(c.id, data.categories) }} />
                    {c.name}
                    {usual.byCategory[c.id] ? <span class="muted small"> · {usualText(usual.byCategory[c.id])}</span> : null}
                  </span>
                  <MoneyInput value={limits[c.id] ?? 0} onChange={v => setLimits({ ...limits, [c.id]: v })} />
                </label>
              ))}
          </div>
          <button onClick={() => setStep(3)}>המשך</button>
        </>
      )}

      {step === 3 && (
        <>
          <h1>כסף שעובר לחיסכון</h1>
          <p class="muted">
            כסף שאתה מעביר לפיקדון, לקופה או לצד נשאר שלך, אבל הוא לא זמין לשימוש. איך להתייחס אליו?
          </p>
          <div class="card">
            <Segmented
              value={savingsMode}
              onChange={setSavingsMode}
              options={[
                ['separate', 'סעיף נפרד'],
                ['expense', 'כהוצאה'],
              ]}
            />
            <p class="muted small">
              {savingsMode === 'separate'
                ? 'יורד מהכסף הנזיל, אבל לא נספר כהוצאה ולא בתקציב. יופיע בנפרד: "חסכת החודש".'
                : 'נספר כמו כל הוצאה אחרת, גם בתקציב.'}
            </p>
            {savingsMode === 'separate' && (
              <label class="field">
                <span>באיזו קטגוריה אתה רושם העברה לחיסכון?</span>
                <select value={savingsCategoryId} onChange={e => setSavingsCategoryId(e.currentTarget.value)}>
                  <option value="">קטגוריה חדשה בשם "חיסכון"</option>
                  {expenseCats.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <button disabled={saving} onClick={finish}>
            {existing ? 'שמור' : 'פתח את התקציב'}
          </button>
        </>
      )}
    </div>
  );
}

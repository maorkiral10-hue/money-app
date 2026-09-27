import { useState } from 'preact/hooks';
import { Chips, MoneyInput, Segmented } from '../components/inputs';
import { dayLabel, todayStr } from '../data/dates';
import { setMeta } from '../data/db';
import { formatMoney } from '../data/money';
import type { QuickPreset } from '../data/quick';
import { appBalance, correctBalance, logCheck, type CheckEvery } from '../data/reconcile';
import type { AppData } from '../data/store';

/**
 * Checking a balance against the bank (or the wallet): type what's really there, see the gap, and choose
 * how to close it - add the missing expense or income, set the app's balance, or leave it. No pop-ups:
 * this screen is opened when you want it, from the quiet line on the home screen or from settings.
 */
export function BalanceCheck(props: {
  db: IDBDatabase;
  data: AppData;
  onBack: () => void;
  onChange: () => void;
  onAddMissing: (preset: QuickPreset) => void;
}) {
  const { data } = props;
  const today = todayStr();
  const accounts = data.accounts.filter(a => !a.archived && a.name.trim());
  const [accountId, setAccountId] = useState(accounts.find(a => a.kind === 'bank')?.id ?? accounts[0]?.id);
  const [real, setReal] = useState(0);
  const [typed, setTyped] = useState(false);
  const [checked, setChecked] = useState(false);
  const [done, setDone] = useState('');
  const account = accounts.find(a => a.id === accountId);
  const app = account ? appBalance(data, account.id, today) : 0;
  const gap = real - app;
  const name = (id: string) => data.accounts.find(a => a.id === id)?.name ?? '';

  const compare = async () => {
    if (!account) return;
    setChecked(true);
    setDone('');
    await logCheck(props.db, { date: today, accountId: account.id, real, app, result: gap === 0 ? 'match' : 'gap' });
    props.onChange();
  };

  const correct = async () => {
    if (!account || !confirm(`לעדכן את היתרה של ${account.name} באפליקציה ל-${formatMoney(real)}?\nזה לא משנה הוצאות או הכנסות, רק את היתרה.`)) return;
    await correctBalance(props.db, account, real, app, today);
    setDone(`היתרה של ${account.name} עודכנה ל-${formatMoney(real)}.`);
    props.onChange();
  };

  return (
    <>
      <header class="top">
        <h1>בדיקה מול הבנק</h1>
        <button class="link" onClick={props.onBack}>
          חזרה
        </button>
      </header>
      <p class="muted small">הקלד כמה יש באמת, כמו שרואים באפליקציה של הבנק, והאפליקציה תשווה.</p>

      <div class="card">
        <h2>איפה בודקים?</h2>
        <Chips
          items={accounts}
          value={accountId}
          onChange={id => {
            setAccountId(id);
            setChecked(false);
            setDone('');
          }}
        />
        <label class="field">
          <span>כמה יש שם עכשיו באמת</span>
          <MoneyInput
            key={accountId}
            value={0}
            onChange={v => {
              setReal(v);
              setTyped(true);
              setChecked(false);
            }}
          />
        </label>
        <button disabled={!typed || !account} onClick={compare}>
          השווה
        </button>
      </div>

      {checked && account && !done && (
        <div class={`card check-result ${gap === 0 ? 'inc-panel' : 'exp-panel'}`}>
          {gap === 0 ? (
            <h2 class="inc">✓ מתאים בדיוק</h2>
          ) : (
            <>
              <h2 class="exp">יש פער של {formatMoney(Math.abs(gap))}</h2>
              <div class="line">
                <span>באפליקציה</span>
                <span>{formatMoney(app)}</span>
              </div>
              <div class="line">
                <span>באמת</span>
                <span>{formatMoney(real)}</span>
              </div>
              <p class="muted small">
                {gap < 0
                  ? 'יש פחות ממה שהאפליקציה חושבת: כנראה הוצאה שלא נרשמה.'
                  : 'יש יותר ממה שהאפליקציה חושבת: כנראה הכנסה שלא נרשמה.'}
              </p>
              <button onClick={() => props.onAddMissing({ type: gap < 0 ? 'expense' : 'income', amount: Math.abs(gap) })}>
                {gap < 0 ? `להוסיף הוצאה של ${formatMoney(-gap)}` : `להוסיף הכנסה של ${formatMoney(gap)}`}
              </button>
              <button class="secondary" onClick={correct}>
                לעדכן את היתרה באפליקציה ל-{formatMoney(real)}
              </button>
              <button class="link" onClick={props.onBack}>
                להשאיר ככה
              </button>
            </>
          )}
        </div>
      )}
      {done && <div class="card note">{done}</div>}

      <div class="card">
        <h2>תזכורת שקטה</h2>
        <p class="muted small">בלי הודעות: רק השורה בתחתית מסך הבית משנה צבע כשהגיע הזמן.</p>
        <Segmented
          value={data.checkEvery}
          onChange={async (v: CheckEvery) => {
            await setMeta(props.db, 'checkEvery', v);
            props.onChange();
          }}
          options={[
            ['never', 'בלי'],
            ['week', 'כל שבוע'],
            ['month', 'כל חודש'],
          ]}
        />
      </div>

      {data.balanceChecks.length > 0 && (
        <div class="card list">
          <h2 class="list-title">בדיקות קודמות</h2>
          {data.balanceChecks.slice(0, 8).map((c, i) => (
            <div key={i} class="tx">
              <div>
                <div>{name(c.accountId)}</div>
                <div class="muted small">
                  {dayLabel(c.date, today)} · {c.result === 'match' ? 'התאים' : c.result === 'corrected' ? 'היתרה עודכנה' : `פער של ${formatMoney(Math.abs(c.real - c.app))}`}
                </div>
              </div>
              <div class={c.result === 'gap' ? 'exp' : 'inc'}>{c.result === 'gap' ? '≠' : '✓'}</div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

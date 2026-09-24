import { useState } from 'preact/hooks';
import { Chips, MoneyInput, Segmented } from '../components/inputs';
import { deleteRecord, putRecords, setMeta } from '../data/db';
import { addDays, todayStr } from '../data/dates';
import { formatMoney } from '../data/money';
import type { AppData } from '../data/store';
import type { Transaction, TxType } from '../data/types';

const INSTALLMENTS = Array.from({ length: 36 }, (_, i) => i + 1);

export function EntryForm(props: { db: IDBDatabase; data: AppData; tx?: Transaction; onClose: () => void; onSaved: () => void }) {
  const { data, tx } = props;
  const today = todayStr();
  // Hidden items stay available only for the transaction that already uses them
  const accounts = data.accounts.filter(a => a.name.trim() && (!a.archived || a.id === tx?.accountId || a.id === tx?.toAccountId));
  const methods = data.methods.filter(m => m.name.trim() && (!m.archived || m.id === tx?.methodId));
  const defaultMethod = methods.find(m => m.id === data.lastMethodId && !m.archived) ?? methods.find(m => !m.archived);

  const [type, setType] = useState<TxType>(tx?.type ?? 'expense');
  const [amount, setAmount] = useState(tx?.amount ?? 0);
  const [categoryId, setCategoryId] = useState(tx?.categoryId);
  const [methodId, setMethodId] = useState(tx?.methodId ?? defaultMethod?.id);
  const [accountId, setAccountId] = useState(tx?.accountId ?? accounts[0]?.id);
  const [toAccountId, setToAccountId] = useState(tx?.toAccountId ?? accounts[1]?.id);
  const [date, setDate] = useState(tx?.date ?? today);
  const [installments, setInstallments] = useState(tx?.installments ?? 1);
  const [note, setNote] = useState(tx?.note ?? '');
  const [saving, setSaving] = useState(false);

  const categories = data.categories.filter(c => c.kind === type && c.name.trim() && (!c.archived || c.id === tx?.categoryId));
  const method = methods.find(m => m.id === methodId);
  const isCredit = type === 'expense' && method?.kind === 'credit';

  const valid =
    amount > 0 &&
    (type === 'expense' ? !!categoryId && !!methodId : type === 'income' ? !!categoryId && !!accountId : !!accountId && !!toAccountId && accountId !== toAccountId);

  const changeType = (t: TxType) => {
    setType(t);
    setCategoryId(undefined);
  };

  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    const now = new Date().toISOString();
    const record: Transaction = {
      id: tx?.id ?? crypto.randomUUID(),
      type,
      amount,
      date,
      note: note.trim() || undefined,
      createdAt: tx?.createdAt ?? now,
      updatedAt: now,
      ...(type === 'expense' && { categoryId, methodId, installments: isCredit && installments > 1 ? installments : undefined }),
      ...(type === 'income' && { categoryId, accountId }),
      ...(type === 'transfer' && { accountId, toAccountId }),
    };
    await putRecords(props.db, 'transactions', [record]);
    if (type === 'expense' && methodId) await setMeta(props.db, 'lastMethodId', methodId);
    props.onSaved();
  };

  const remove = async () => {
    if (!tx || !confirm('למחוק את התנועה?')) return;
    await deleteRecord(props.db, 'transactions', tx.id);
    props.onSaved();
  };

  return (
    <div class="sheet">
      <header class="top">
        <button class="link" onClick={props.onClose}>
          ביטול
        </button>
        <h1>{tx ? 'עריכה' : 'תנועה חדשה'}</h1>
        <span style={{ width: '40px' }} />
      </header>

      <Segmented
        value={type}
        onChange={changeType}
        options={[
          ['expense', 'הוצאה'],
          ['income', 'הכנסה'],
          ['transfer', 'העברה'],
        ]}
      />

      <MoneyInput class="big" value={amount} onChange={setAmount} autoFocus={!tx} />

      {type !== 'transfer' && (
        <section>
          <h2>{type === 'expense' ? 'על מה' : 'מה נכנס'}</h2>
          <Chips items={categories} value={categoryId} onChange={setCategoryId} />
        </section>
      )}

      {type === 'expense' && (
        <section>
          <h2>איך שילמת</h2>
          <Chips items={methods} value={methodId} onChange={setMethodId} />
          {isCredit && (
            <label class="field inline">
              <span>תשלומים</span>
              <select value={installments} onChange={e => setInstallments(Number(e.currentTarget.value))}>
                {INSTALLMENTS.map(n => (
                  <option key={n} value={n}>
                    {n === 1 ? 'תשלום אחד' : n}
                  </option>
                ))}
              </select>
              {installments > 1 && amount > 0 && <span class="muted small">בערך {formatMoney(Math.floor(amount / installments))} לחודש</span>}
            </label>
          )}
        </section>
      )}

      {type === 'income' && (
        <section>
          <h2>לאן נכנס</h2>
          <Chips items={accounts} value={accountId} onChange={setAccountId} />
        </section>
      )}

      {type === 'transfer' && (
        <section>
          <h2>מאיפה</h2>
          <Chips items={accounts} value={accountId} onChange={setAccountId} />
          <h2>לאן</h2>
          <Chips items={accounts} value={toAccountId} onChange={setToAccountId} />
          <p class="muted small">למשל משיכת מזומן מהכספומט, או העברה מביט לבנק. זה לא הוצאה, הכסף רק עובר ממקום למקום.</p>
        </section>
      )}

      <section>
        <h2>מתי</h2>
        <div class="chips">
          <button type="button" class={`chip ${date === today ? 'on' : ''}`} onClick={() => setDate(today)}>
            היום
          </button>
          <button type="button" class={`chip ${date === addDays(today, -1) ? 'on' : ''}`} onClick={() => setDate(addDays(today, -1))}>
            אתמול
          </button>
          <input type="date" class="chip" value={date} onChange={e => e.currentTarget.value && setDate(e.currentTarget.value)} />
        </div>
        {date > today && <p class="muted small">תאריך עתידי: התנועה תופיע כצפויה, ותיכנס ליתרה רק כשיגיע התאריך.</p>}
        {date < data.startDate && <p class="muted small">התאריך לפני תחילת המעקב, ולכן התנועה לא תשנה את היתרה (היא כבר כלולה ביתרת הפתיחה).</p>}
      </section>

      <section>
        <input type="text" class="note-input" placeholder="הערה (לא חובה)" value={note} onInput={e => setNote(e.currentTarget.value)} />
      </section>

      <button disabled={!valid || saving} onClick={save}>
        שמור
      </button>
      {tx && (
        <button class="danger" onClick={remove}>
          מחק תנועה
        </button>
      )}
    </div>
  );
}

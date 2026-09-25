import type { Account, Category, PaymentMethod } from '../data/types';
import { MoneyInput } from './inputs';

// Shared by the first-run questionnaire and the settings screen.
// Unticking an item sets `archived`: the questionnaire then leaves it out, settings hides it
// from the entry form but keeps it so past transactions still show where they came from.

type Patch<T> = (id: string, patch: Partial<T>) => void;

function update<T extends { id: string }>(items: T[], onChange: (items: T[]) => void): Patch<T> {
  return (id, patch) => onChange(items.map(i => (i.id === id ? { ...i, ...patch } : i)));
}

export function AccountsEditor(props: { items: Account[]; onChange: (items: Account[]) => void; balanceLabel: string }) {
  const set = update(props.items, props.onChange);
  return (
    <>
      {props.items.map(a => (
        <div key={a.id} class={`edit-row ${a.archived ? 'off' : ''}`}>
          <input type="checkbox" checked={!a.archived} onChange={e => set(a.id, { archived: !e.currentTarget.checked })} />
          <div class="edit-fields">
            <input type="text" value={a.name} onInput={e => set(a.id, { name: e.currentTarget.value })} />
            {!a.archived && (
              <label class="field">
                <span>{props.balanceLabel}</span>
                <MoneyInput value={a.openingBalance} onChange={v => set(a.id, { openingBalance: v })} />
              </label>
            )}
          </div>
        </div>
      ))}
      <button
        type="button"
        class="secondary"
        onClick={() =>
          props.onChange([...props.items, { id: crypto.randomUUID(), name: '', kind: 'other', openingBalance: 0, order: props.items.length }])
        }
      >
        + מקום נוסף שיש בו כסף
      </button>
    </>
  );
}

const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

export function MethodsEditor(props: { items: PaymentMethod[]; accounts: Account[]; onChange: (items: PaymentMethod[]) => void }) {
  const set = update(props.items, props.onChange);
  const accounts = props.accounts.filter(a => !a.archived);
  const banks = accounts.filter(a => a.kind === 'bank');
  const add = (m: Partial<PaymentMethod>) =>
    props.onChange([
      ...props.items,
      { id: crypto.randomUUID(), name: '', kind: 'other', accountId: accounts[0]?.id ?? '', order: props.items.length, ...m },
    ]);

  return (
    <>
      {props.items.map(m => (
        <div key={m.id} class={`edit-row ${m.archived ? 'off' : ''}`}>
          <input type="checkbox" checked={!m.archived} onChange={e => set(m.id, { archived: !e.currentTarget.checked })} />
          <div class="edit-fields">
            <input type="text" value={m.name} placeholder={m.kind === 'credit' ? 'שם הכרטיס, למשל מקס' : 'שם'} onInput={e => set(m.id, { name: e.currentTarget.value })} />
            {!m.archived && (
              <>
                <label class="field">
                  <span>{m.kind === 'credit' ? 'מחויב מ' : 'הכסף יוצא מ'}</span>
                  <select value={m.accountId} onChange={e => set(m.id, { accountId: e.currentTarget.value })}>
                    {(m.kind === 'credit' && banks.length ? banks : accounts).map(a => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </label>
                {m.kind === 'credit' && (
                  <>
                    <label class="field">
                      <span>יום החיוב בחודש</span>
                      <select value={m.chargeDay} onChange={e => set(m.id, { chargeDay: Number(e.currentTarget.value) })}>
                        {DAYS.map(d => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label class="field">
                      <span>כמה כבר נצבר לחיוב הקרוב (ביום ההתחלה)</span>
                      <MoneyInput value={m.openingPending ?? 0} onChange={v => set(m.id, { openingPending: v })} />
                    </label>
                    <label class="field">
                      <span>מסגרת האשראי של הכרטיס</span>
                      <MoneyInput value={m.creditLimit ?? 0} onChange={v => set(m.id, { creditLimit: v || undefined })} />
                    </label>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      ))}
      <button type="button" class="secondary" onClick={() => add({ kind: 'credit', chargeDay: 10, openingPending: 0, accountId: banks[0]?.id ?? accounts[0]?.id })}>
        + כרטיס אשראי
      </button>
      <button type="button" class="secondary" onClick={() => add({})}>
        + אמצעי תשלום אחר
      </button>
    </>
  );
}

export function CategoriesEditor(props: { items: Category[]; kind: Category['kind']; onChange: (items: Category[]) => void }) {
  const set = update(props.items, props.onChange);
  return (
    <>
      {props.items
        .filter(c => c.kind === props.kind)
        .map(c => (
          <div key={c.id} class={`edit-row compact ${c.archived ? 'off' : ''}`}>
            <input type="checkbox" checked={!c.archived} onChange={e => set(c.id, { archived: !e.currentTarget.checked })} />
            <input type="text" value={c.name} onInput={e => set(c.id, { name: e.currentTarget.value })} />
          </div>
        ))}
      <button
        type="button"
        class="secondary"
        onClick={() =>
          props.onChange([...props.items, { id: crypto.randomUUID(), name: '', kind: props.kind, order: props.items.length }])
        }
      >
        + קטגוריה
      </button>
    </>
  );
}

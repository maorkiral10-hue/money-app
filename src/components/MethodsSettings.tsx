import { useState } from 'preact/hooks';
import { nextChargeDate } from '../data/balance';
import { todayStr } from '../data/dates';
import { formatMoney } from '../data/money';
import type { Account, MethodKind, PaymentMethod } from '../data/types';
import { MoneyInput } from './inputs';
import { SwipeRow } from './SwipeRow';

// The settings screen for payment methods: grouped by type, one summary line per method, tap to edit.
// (The first-run questionnaire keeps its own simpler list.)

const GROUPS: { kind: MethodKind; title: string; add: string; hint: string }[] = [
  { kind: 'credit', title: 'כרטיסי אשראי', add: '+ כרטיס אשראי', hint: 'קנייה נרשמת ביום שקנית, ויורדת מהבנק ביום החיוב של הכרטיס.' },
  { kind: 'bank', title: 'העברות והוראות קבע מהבנק', add: '+ חשבון להעברות', hint: 'יורד מהחשבון באותו יום.' },
  { kind: 'cash', title: 'מזומן', add: '+ מזומן', hint: '' },
  { kind: 'app', title: 'אפליקציות תשלום', add: '+ אפליקציית תשלום', hint: 'למשל ביט או פייבוקס.' },
  { kind: 'other', title: 'אחר', add: '+ אמצעי תשלום אחר', hint: '' },
];

const KIND_NAMES: [MethodKind, string][] = [
  ['credit', 'כרטיס אשראי'],
  ['bank', 'העברה / הוראת קבע מהבנק'],
  ['cash', 'מזומן'],
  ['app', 'אפליקציית תשלום'],
  ['other', 'אחר'],
];
const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

export function MethodsSettings(props: {
  items: PaymentMethod[];
  accounts: Account[];
  onChange: (items: PaymentMethod[]) => void;
  onDelete: (id: string) => void;
  startDate: string;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const accounts = props.accounts.filter(a => !a.archived && a.kind !== 'goal');
  const banks = accounts.filter(a => a.kind === 'bank');
  const visible = props.items.filter(m => !m.archived);
  const accountName = (id: string) => props.accounts.find(a => a.id === id)?.name ?? '';
  const set = (id: string, patch: Partial<PaymentMethod>) => props.onChange(props.items.map(m => (m.id === id ? { ...m, ...patch } : m)));

  const add = (kind: MethodKind) => {
    const m: PaymentMethod = {
      id: crypto.randomUUID(),
      name: '',
      kind,
      accountId: (kind === 'credit' || kind === 'bank' ? banks[0] : accounts.find(a => a.kind === kind) ?? accounts[0])?.id ?? '',
      order: props.items.length,
      ...(kind === 'credit' && { chargeDay: 10, openingPending: 0 }),
    };
    props.onChange([...props.items, m]);
    setOpen(m.id);
  };

  const summary = (m: PaymentMethod) =>
    m.kind === 'credit'
      ? [`חיוב ב-${m.chargeDay ?? '?'} מ${accountName(m.accountId)}`, m.creditLimit ? `מסגרת ${formatMoney(m.creditLimit)}` : 'בלי מסגרת'].join(' · ')
      : `יוצא מ${accountName(m.accountId)}`;

  // Groups with methods in them, plus the credit-card group always (so a card can be added)
  const groups = GROUPS.filter(g => g.kind === 'credit' || visible.some(m => m.kind === g.kind));

  return (
    <>
      {groups.map(g => (
        <div key={g.kind} class="card method-group">
          <h2>{g.title}</h2>
          {g.hint && <p class="muted small">{g.hint}</p>}
          {visible
            .filter(m => m.kind === g.kind)
            .map(m => (
              <SwipeRow key={m.id} onDelete={() => props.onDelete(m.id)}>
                <div class="method">
                  <button class="method-head" onClick={() => setOpen(open === m.id ? null : m.id)} aria-expanded={open === m.id}>
                    <span>
                      <span class="method-name">{m.name.trim() || 'ללא שם'}</span>
                      <span class="muted small block">{summary(m)}</span>
                    </span>
                    <span class={`chevron ${open === m.id ? 'open' : ''}`}>‹</span>
                  </button>
                  {open === m.id && (
                    <div class="method-body">
                      <label class="field">
                        <span>שם</span>
                        <input type="text" value={m.name} placeholder={m.kind === 'credit' ? 'למשל מקס' : 'שם'} onInput={e => set(m.id, { name: e.currentTarget.value })} />
                      </label>
                      <label class="field">
                        <span>סוג</span>
                        <select
                          value={m.kind}
                          onChange={e => {
                            const kind = e.currentTarget.value as MethodKind;
                            set(m.id, kind === 'credit' ? { kind, chargeDay: m.chargeDay ?? 10, accountId: banks[0]?.id ?? m.accountId } : { kind });
                          }}
                        >
                          {KIND_NAMES.map(([k, label]) => (
                            <option key={k} value={k}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
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
                            <span>מסגרת האשראי</span>
                            <MoneyInput value={m.creditLimit ?? 0} onChange={v => set(m.id, { creditLimit: v || undefined })} />
                          </label>
                          {/* Only until that first charge has gone out; after it, it's history */}
                          {todayStr() < nextChargeDate(props.startDate, m.chargeDay ?? 1) && (
                            <label class="field">
                              <span>כמה היה צבור על הכרטיס ביום תחילת המעקב</span>
                              <MoneyInput value={m.openingPending ?? 0} onChange={v => set(m.id, { openingPending: v })} />
                            </label>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </SwipeRow>
            ))}
          <button type="button" class="link add-in-group" onClick={() => add(g.kind)}>
            {g.add}
          </button>
        </div>
      ))}
      <div class="card add-kinds">
        <p class="muted small">להוספה מסוג אחר:</p>
        <div class="chips">
          {GROUPS.filter(g => !groups.includes(g)).map(g => (
            <button key={g.kind} type="button" class="chip" onClick={() => add(g.kind)}>
              {g.add}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

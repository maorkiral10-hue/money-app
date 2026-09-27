import { useState } from 'preact/hooks';
import type { UpcomingItem } from '../data/balance';
import { formatMoney } from '../data/money';
import type { AppData } from '../data/store';
import type { Recurring, Transaction } from '../data/types';
import { ExpectedList } from './ExpectedList';

const GROUPS: { id: string; title: string; test: (i: UpcomingItem) => boolean }[] = [
  { id: 'income', title: 'הכנסות צפויות', test: i => i.kind === 'income' },
  { id: 'fixed', title: 'הוראות קבע וקבועות', test: i => i.kind === 'expense' && !!i.txId?.startsWith('expected:') },
  { id: 'credit', title: 'חיובי אשראי', test: i => i.kind === 'credit' },
  { id: 'planned', title: 'הוצאות מתוכננות', test: i => i.kind === 'expense' && !i.txId?.startsWith('expected:') },
];

/** Expected items as a few headings with their totals; tapping a heading shows its rows. */
export function ExpectedGroups(props: {
  data: AppData;
  items: UpcomingItem[];
  today: string;
  onEdit: (tx: Transaction) => void;
  onEditRecurring: (rec: Recurring) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const groups = GROUPS.map(g => ({ ...g, items: props.items.filter(g.test) })).filter(g => g.items.length);
  if (!groups.length) return <p class="muted small">לא צפוי לרדת או להיכנס כלום.</p>;

  return (
    <>
      {groups.map(g => {
        const sum = g.items.reduce((a, i) => a + i.amount, 0);
        return (
          <div key={g.id} class="group">
            <button class="group-head" onClick={() => setOpen(open === g.id ? null : g.id)} aria-expanded={open === g.id}>
              <span class={g.id === 'income' ? 'inc' : 'exp'}>{g.title}</span>
              <span class={g.id === 'income' ? 'inc' : 'exp'}>
                {formatMoney(sum, { sign: g.id === 'income' })} <span class={`chevron ${open === g.id ? 'open' : ''}`}>‹</span>
              </span>
            </button>
            {open === g.id && (
              <div class="group-body">
                <ExpectedList data={props.data} items={g.items} today={props.today} onEdit={props.onEdit} onEditRecurring={props.onEditRecurring} />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

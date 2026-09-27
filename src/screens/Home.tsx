import { useState } from 'preact/hooks';
import { AnimatedMoney } from '../components/AnimatedMoney';
import { CardLine } from '../components/CardLine';
import { StatementItems } from '../components/StatementItems';
import { cardStatements, cardUsage, summarize, type Statement } from '../data/balance';
import { PendingCard } from '../components/PendingCard';
import { categoryColor } from '../data/colors';
import { dayLabel, todayStr } from '../data/dates';
import { openOccurrences } from '../data/recurring';
import { formatMoney } from '../data/money';
import type { AppData } from '../data/store';
import type { Transaction } from '../data/types';

function daysAgo(iso: string) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return days === 0 ? 'היום' : days === 1 ? 'אתמול' : `לפני ${days} ימים`;
}

export function Home(props: {
  db: IDBDatabase;
  data: AppData;
  onChange: () => void;
  onEdit: (tx: Transaction) => void;
  onOpenData: () => void;
}) {
  const { data } = props;
  const today = todayStr();
  const summary = summarize(data, today);
  const cards = cardUsage(data, today);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [openCharge, setOpenCharge] = useState<string | null>(null);
  const pending = data.recurring
    .filter(r => r.variable)
    .map(rec => ({ rec, open: openOccurrences(rec, today, data.startDate) }))
    .filter(p => p.open.length > 0);

  const name = new Map<string, string>([...data.accounts, ...data.methods, ...data.categories].map(x => [x.id, x.name]));
  // Like an account statement: what leaves or enters your accounts and wallet. A credit card purchase
  // (including subscriptions and standing orders on the card) isn't a line of its own: it's inside the
  // card's charge, which appears on its charge day. Tap a card in "פירוט" to see what's building up.
  const creditIds = new Set(data.methods.filter(m => m.kind === 'credit').map(m => m.id));
  const statements = new Map(cards.map(u => [u.card.id, cardStatements(data, u.card.id)]));
  const rows: Row[] = [
    ...data.transactions.filter(t => !(t.type === 'expense' && creditIds.has(t.methodId ?? ''))).map(tx => ({ kind: 'tx' as const, date: tx.date, tx })),
    ...[...statements.values()].flat().filter(st => st.date <= today).map(st => ({ kind: 'charge' as const, date: st.date, st })),
  ].sort((a, b) => b.date.localeCompare(a.date) || (a.kind === 'tx' && b.kind === 'tx' ? b.tx.createdAt.localeCompare(a.tx.createdAt) : 0));
  const groups = new Map<string, Row[]>();
  for (const r of rows) groups.set(r.date, [...(groups.get(r.date) ?? []), r]);

  return (
    <>
      <header class="top">
        <h1>הכסף שלי</h1>
      </header>

      <div class="card hero">
        <div class="muted small">כסף נזיל עכשיו</div>
        <div class="big-number">
          <AnimatedMoney value={summary.liquid} />
        </div>
        {showBreakdown && (
          <div class="upcoming">
            {summary.byAccount.map(({ account, balance }) => (
              <Line key={account.id} label={account.name} value={balance} />
            ))}
            {cards.length > 0 && <div class="muted small section-label">מסגרות אשראי</div>}
            {cards.map(u => (
              <CardLine key={u.card.id} usage={u} today={today} statements={statements.get(u.card.id)} data={data} onEdit={props.onEdit} />
            ))}
          </div>
        )}
        <div class="hero-buttons">
          <button class="secondary" onClick={() => setShowBreakdown(!showBreakdown)}>
            {showBreakdown ? 'הסתר פירוט' : 'פירוט'}
          </button>
        </div>
      </div>

      <button class="quiet" onClick={props.onOpenData}>
        {data.lastBackupAt ? `גיבוי אחרון: ${daysAgo(data.lastBackupAt)}` : 'עדיין לא בוצע גיבוי'}
      </button>

      {pending.map(({ rec, open }) => (
        <PendingCard key={`${rec.id}${open[0]}`} db={props.db} data={data} rec={rec} occurrence={open[0]} more={open.length - 1} onDone={props.onChange} />
      ))}

      {groups.size === 0 && <p class="muted center">עדיין אין תנועות. לחץ על + כדי להוסיף את הראשונה.</p>}
      {[...groups].map(([date, items]) => (
        <div key={date} class="day">
          <div class="day-label">
            {dayLabel(date, today)}
            {date > today && <span class="tag">צפויה</span>}
            {date < data.startDate && <span class="tag">לפני תחילת המעקב</span>}
          </div>
          <div class="card list">
            {items.map(row =>
              row.kind === 'charge' ? (
                <div key={`${row.st.methodId}${row.st.date}`}>
                  <button class="tx" onClick={() => setOpenCharge(openCharge === row.st.methodId + row.st.date ? null : row.st.methodId + row.st.date)}>
                    <div>
                      <div>חיוב {name.get(row.st.methodId)}</div>
                      <div class="muted small">
                        {row.st.items.length === 1 ? 'פריט אחד' : `${row.st.items.length} פריטים`} · לחץ לפירוט
                      </div>
                    </div>
                    <div class="amount expense">{formatMoney(-row.st.amount)}</div>
                  </button>
                  {openCharge === row.st.methodId + row.st.date && <StatementItems data={data} items={row.st.items} today={today} onEdit={props.onEdit} />}
                </div>
              ) : (
              <TxRow key={row.tx.id} tx={row.tx} />
              ),
            )}
          </div>
        </div>
      ))}

    </>
  );

  function TxRow({ tx }: { tx: Transaction }) {
    return (
              <button class="tx" onClick={() => props.onEdit(tx)}>
                <div>
                  <div>
                    {tx.type !== 'transfer' && <span class="cat-dot" style={{ background: categoryColor(tx.categoryId, data.categories) }} />}
                    {tx.type === 'transfer' ? `${name.get(tx.accountId!)} ← ${name.get(tx.toAccountId!)}` : tx.recurringId ? tx.note : name.get(tx.categoryId!)}
                  </div>
                  <div class="muted small">
                    {[
                      tx.type === 'expense' ? name.get(tx.methodId!) : tx.type === 'income' ? name.get(tx.accountId!) : 'העברה',
                      tx.recurringId && 'הוראת קבע',
                      tx.installments && `${tx.installments} תשלומים`,
                      !tx.recurringId && tx.note,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
                <div class={`amount ${tx.type}`}>
                  {formatMoney(tx.type === 'expense' ? -tx.amount : tx.amount, { sign: tx.type === 'income' })}
                </div>
              </button>
    );
  }
}

type Row = { kind: 'tx'; date: string; tx: Transaction } | { kind: 'charge'; date: string; st: Statement };

function Line(props: { label: string; value: number }) {
  return (
    <div class="line">
      <span>{props.label}</span>
      <span>{formatMoney(props.value)}</span>
    </div>
  );
}

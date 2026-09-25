import { AccountsEditor, CategoriesEditor, MethodsEditor } from '../components/Editors';
import { putRecords } from '../data/db';
import type { AppData } from '../data/store';
import { APP_VERSION } from '../version';

export type SettingsPage = 'accounts' | 'methods' | 'categories';

/** The settings menu: one line per topic, each opening its own screen. */
export function SettingsMenu(props: {
  data: AppData;
  onBack: () => void;
  onOpen: (page: SettingsPage) => void;
  onOpenRecurring: () => void;
  onOpenData: () => void;
}) {
  const { data } = props;
  const active = <T extends { archived?: boolean; name: string }>(items: T[]) => items.filter(i => !i.archived && i.name.trim());
  const cards = active(data.methods).filter(m => m.kind === 'credit').length;
  const categories = active(data.categories);

  const Item = (p: { title: string; sub: string; onClick: () => void }) => (
    <button class="tx menu-item" onClick={p.onClick}>
      <div>
        <div>{p.title}</div>
        <div class="muted small">{p.sub}</div>
      </div>
      <span class="muted">‹</span>
    </button>
  );

  return (
    <>
      <header class="top">
        <h1>הגדרות</h1>
        <button class="link" onClick={props.onBack}>
          חזרה
        </button>
      </header>

      <div class="card list">
        <Item title="איפה הכסף נמצא" sub={active(data.accounts).map(a => a.name).join(', ')} onClick={() => props.onOpen('accounts')} />
        <Item
          title="אמצעי תשלום וכרטיסי אשראי"
          sub={`${active(data.methods).length} אמצעים${cards === 1 ? ', מתוכם כרטיס אשראי אחד' : cards ? `, מתוכם ${cards} כרטיסי אשראי` : ''}`}
          onClick={() => props.onOpen('methods')}
        />
        <Item
          title="קטגוריות"
          sub={`${categories.filter(c => c.kind === 'expense').length} הוצאה · ${categories.filter(c => c.kind === 'income').length} הכנסה`}
          onClick={() => props.onOpen('categories')}
        />
      </div>

      <div class="card list">
        <Item title="הכנסות והוצאות קבועות" sub={`${data.recurring.filter(r => !r.endDate).length} פעילות`} onClick={props.onOpenRecurring} />
      </div>

      <div class="card list">
        <Item
          title="גיבוי ונתונים"
          sub={data.lastBackupAt ? `גיבוי אחרון: ${new Date(data.lastBackupAt).toLocaleDateString('he-IL')}` : 'עדיין לא בוצע גיבוי'}
          onClick={props.onOpenData}
        />
      </div>

      <p class="muted small center">
        תחילת המעקב: {data.startDate.split('-').reverse().join('.')} · גרסה {APP_VERSION}
      </p>
    </>
  );
}

const TITLES: Record<SettingsPage, string> = {
  accounts: 'איפה הכסף נמצא',
  methods: 'אמצעי תשלום וכרטיסי אשראי',
  categories: 'קטגוריות',
};

export function SettingsPageScreen(props: { db: IDBDatabase; data: AppData; page: SettingsPage; onChange: () => void; onBack: () => void }) {
  const { db, data } = props;
  const save = (store: SettingsPage) => async (items: { id: string }[]) => {
    await putRecords(db, store, items);
    props.onChange();
  };

  return (
    <>
      <header class="top">
        <h1>{TITLES[props.page]}</h1>
        <button class="link" onClick={props.onBack}>
          חזרה
        </button>
      </header>
      <p class="muted small">שינויים נשמרים מיד. ביטול סימון מסתיר מהטופס, אבל תנועות קודמות נשארות כמו שהן.</p>

      {props.page === 'accounts' && (
        <div class="card">
          <AccountsEditor items={data.accounts} onChange={save('accounts')} balanceLabel="יתרה ביום ההתחלה" />
        </div>
      )}
      {props.page === 'methods' && (
        <div class="card">
          <MethodsEditor items={data.methods} accounts={data.accounts} onChange={save('methods')} />
        </div>
      )}
      {props.page === 'categories' && (
        <>
          <div class="card">
            <h2>הוצאות</h2>
            <CategoriesEditor items={data.categories} kind="expense" onChange={save('categories')} />
          </div>
          <div class="card">
            <h2>הכנסות</h2>
            <CategoriesEditor items={data.categories} kind="income" onChange={save('categories')} />
          </div>
        </>
      )}
    </>
  );
}

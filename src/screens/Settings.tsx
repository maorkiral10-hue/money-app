import { AccountsEditor, CategoriesEditor } from '../components/Editors';
import { MethodsSettings } from '../components/MethodsSettings';
import { MonthStartPicker } from '../components/MonthStartPicker';
import { addDays, todayStr } from '../data/dates';
import { putRecords, setMeta } from '../data/db';

/** How long the start-day balances stay editable in settings. */
const FIRST_MONTH_DAYS = 31;
import { deleteSetting, type AppData } from '../data/store';
import { APP_VERSION } from '../version';

export type SettingsPage = 'accounts' | 'methods' | 'categories' | 'preferences';
export type MenuTarget = SettingsPage | 'recurring' | 'check' | 'data';

/** Everything about how the money is set up, gathered under one heading of the side menu. */
const MONEY_SETTINGS: [MenuTarget, string][] = [
  ['accounts', 'איפה הכסף נמצא'],
  ['methods', 'אמצעי תשלום וכרטיסי אשראי'],
  ['categories', 'קטגוריות'],
  ['recurring', 'הכנסות והוצאות קבועות'],
  ['check', 'בדיקה מול הבנק'],
  ['preferences', 'העדפות'],
];

/** Which list the side menu shows: its main headings, or the sub-topics of one of them. */
export type MenuSection = 'main' | 'money';

/**
 * The side menu: slides in from the right over the current screen, big headings only. A heading with
 * sub-topics swaps the menu for their list; a sub-topic (or a plain heading) opens its own full screen.
 */
export function SideMenu(props: {
  open: boolean;
  section: MenuSection;
  data: AppData;
  onClose: () => void;
  onSection: (section: MenuSection) => void;
  onOpen: (target: MenuTarget) => void;
}) {
  const item = (title: string, onClick: () => void, more?: boolean) => (
    <button key={title} class="side-menu-item" onClick={onClick}>
      {title}
      {more && <span class="muted">‹</span>}
    </button>
  );
  return (
    <div class={`side-menu ${props.open ? 'open' : ''}`} aria-hidden={!props.open}>
      <div class="side-menu-backdrop" onClick={props.onClose} />
      <nav class="side-menu-panel">
        <div class="side-menu-bar">
          {props.section !== 'main' && (
            <button class="link" onClick={() => props.onSection('main')}>
              → תפריט
            </button>
          )}
          <button class="link side-menu-close" aria-label="סגירה" onClick={props.onClose}>
            ✕
          </button>
        </div>
        {props.section === 'main' ? (
          <>
            {item('הכסף שלי - הגדרות', () => props.onSection('money'), true)}
            {item('גיבוי ונתונים', () => props.onOpen('data'))}
          </>
        ) : (
          <>
            <h2 class="side-menu-title">הכסף שלי - הגדרות</h2>
            {MONEY_SETTINGS.map(([target, title]) => item(title, () => props.onOpen(target)))}
          </>
        )}
        <p class="muted small side-menu-foot">
          תחילת המעקב: {props.data.startDate.split('-').reverse().join('.')} · גרסה {APP_VERSION}
        </p>
      </nav>
    </div>
  );
}

/** The three-line button at the top of every main screen, opening the side menu. */
export function MenuButton(props: { onClick: () => void }) {
  return (
    <button class="icon-btn" aria-label="תפריט" onClick={props.onClick}>
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
        <path d="M4 7h16M4 12h16M4 17h16" />
      </svg>
    </button>
  );
}

const TITLES: Record<SettingsPage, string> = {
  accounts: 'איפה הכסף נמצא',
  methods: 'אמצעי תשלום וכרטיסי אשראי',
  categories: 'קטגוריות',
  preferences: 'העדפות',
};

export function SettingsPageScreen(props: { db: IDBDatabase; data: AppData; page: SettingsPage; onChange: () => void; onBack: () => void }) {
  const { db, data } = props;
  const save = (store: 'accounts' | 'methods' | 'categories') => async (items: { id: string }[]) => {
    await putRecords(db, store, items);
    props.onChange();
  };
  const remove = (store: 'categories' | 'methods') => async (id: string) => {
    await deleteSetting(db, data, store, id);
    props.onChange();
  };
  const setting = (key: string) => async (value: unknown) => {
    await setMeta(db, key, value);
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
      {props.page !== 'preferences' && (
        <p class="muted small">
          {props.page === 'accounts'
            ? 'שינויים נשמרים מיד. ביטול סימון מסתיר מהטופס, אבל תנועות קודמות נשארות כמו שהן.'
            : 'שינויים נשמרים מיד. כדי למחוק, החלק שורה שמאלה. תנועות שכבר נרשמו נשארות כמו שהן.'}
        </p>
      )}

      {props.page === 'accounts' && (
        <div class="card">
          <AccountsEditor
            items={data.accounts.filter(a => a.kind !== 'goal')}
            onChange={save('accounts')}
            balanceLabel="יתרה ביום ההתחלה"
            hideBalance={todayStr() > addDays(data.startDate, FIRST_MONTH_DAYS)}
          />
        </div>
      )}
      {props.page === 'methods' && (
        <MethodsSettings items={data.methods} accounts={data.accounts} onChange={save('methods')} onDelete={remove('methods')} startDate={data.startDate} />
      )}
      {props.page === 'categories' && (
        <>
          <div class="card">
            <h2 class="exp">הוצאות</h2>
            <CategoriesEditor items={data.categories} kind="expense" onChange={save('categories')} onDelete={remove('categories')} />
          </div>
          <div class="card">
            <h2 class="inc">הכנסות</h2>
            <CategoriesEditor items={data.categories} kind="income" onChange={save('categories')} onDelete={remove('categories')} />
          </div>
        </>
      )}
      {props.page === 'preferences' && (
        <>
          <div class="card">
            <h2>מתי מתחיל החודש הכספי</h2>
            <MonthStartPicker value={data.monthStartDay} onChange={setting('monthStartDay')} />
          </div>
          <div class="card">
            <label class="toggle-row">
              <span>
                פתיחה ישר על הזנה חדשה
                <span class="muted small block">כשפותחים את האפליקציה, או חוזרים אליה אחרי 10 שניות ומעלה (לא באמצע הקלדה)</span>
              </span>
              <input type="checkbox" checked={data.openOnEntry} onChange={e => setting('openOnEntry')(e.currentTarget.checked)} />
            </label>
          </div>
        </>
      )}
    </>
  );
}

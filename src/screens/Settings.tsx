import { AccountsEditor, CategoriesEditor, MethodsEditor } from '../components/Editors';
import { putRecords } from '../data/db';
import type { AppData } from '../data/store';

export function Settings(props: {
  db: IDBDatabase;
  data: AppData;
  onChange: () => void;
  onBack: () => void;
  onOpenData: () => void;
  onOpenRecurring: () => void;
}) {
  const { db, data } = props;
  const save = (store: 'accounts' | 'methods' | 'categories') => async (items: { id: string }[]) => {
    await putRecords(db, store, items);
    props.onChange();
  };

  return (
    <>
      <header class="top">
        <h1>הגדרות</h1>
        <button class="link" onClick={props.onBack}>
          חזרה
        </button>
      </header>
      <p class="muted small">שינויים נשמרים מיד. ביטול סימון מסתיר מהטופס, אבל תנועות קודמות נשארות כמו שהן.</p>

      <button class="secondary" onClick={props.onOpenRecurring}>
        הכנסות והוצאות קבועות ({data.recurring.filter(r => !r.endDate).length})
      </button>

      <div class="card">
        <h2>איפה הכסף נמצא</h2>
        <AccountsEditor items={data.accounts} onChange={save('accounts')} balanceLabel="יתרה ביום ההתחלה" />
      </div>
      <div class="card">
        <h2>אמצעי תשלום</h2>
        <MethodsEditor items={data.methods} accounts={data.accounts} onChange={save('methods')} />
      </div>
      <div class="card">
        <h2>קטגוריות הוצאה</h2>
        <CategoriesEditor items={data.categories} kind="expense" onChange={save('categories')} />
      </div>
      <div class="card">
        <h2>קטגוריות הכנסה</h2>
        <CategoriesEditor items={data.categories} kind="income" onChange={save('categories')} />
      </div>
      <button class="secondary" onClick={props.onOpenData}>
        גיבוי ונתונים
      </button>
      <p class="muted small center">תחילת המעקב: {data.startDate.split('-').reverse().join('.')}</p>
    </>
  );
}

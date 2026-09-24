import { useState } from 'preact/hooks';
import { AccountsEditor, CategoriesEditor, MethodsEditor } from '../components/Editors';
import { suggestedAccounts, suggestedCategories, suggestedMethods } from '../data/defaults';
import { finishSetup } from '../data/store';
import type { Account, Category, PaymentMethod } from '../data/types';

const named = <T extends { name: string; archived?: boolean }>(items: T[]) => items.filter(i => !i.archived && i.name.trim());

export function Onboarding(props: { db: IDBDatabase; onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [accounts, setAccounts] = useState<Account[]>(suggestedAccounts);
  const [methods, setMethods] = useState<PaymentMethod[] | null>(null);
  const [categories, setCategories] = useState<Category[]>(suggestedCategories);
  const [saving, setSaving] = useState(false);

  const toMethods = () => {
    // Suggest payment methods from the accounts chosen; keep the user's edits if they come back to this step
    if (!methods) setMethods(suggestedMethods(accounts));
    setStep(1);
  };

  const finish = async () => {
    setSaving(true);
    const keptAccounts = named(accounts);
    const keptIds = new Set(keptAccounts.map(a => a.id));
    await finishSetup(props.db, {
      accounts: keptAccounts,
      methods: named(methods ?? []).filter(m => keptIds.has(m.accountId)),
      categories: named(categories),
    });
    props.onDone();
  };

  return (
    <div class="onboarding">
      <p class="muted small">שאלה {step + 1} מתוך 3 · אפשר לשנות הכול אחר כך בהגדרות</p>

      {step === 0 && (
        <>
          <h1>איפה הכסף שלך נמצא?</h1>
          <p class="muted">סמן כל מקום שיש בו כסף שאתה יכול להשתמש בו, וכתוב כמה יש בו היום. הסכום של כולם יהיה המספר הגדול במסך הראשי.</p>
          <div class="card">
            <AccountsEditor items={accounts} onChange={setAccounts} balanceLabel="כמה יש בו היום" />
          </div>
          <button disabled={named(accounts).length === 0} onClick={toMethods}>
            המשך
          </button>
        </>
      )}

      {step === 1 && methods && (
        <>
          <h1>איך אתה משלם?</h1>
          <p class="muted">
            סמן את מה שאתה משתמש בו. לכרטיס אשראי כתוב באיזה יום בחודש הוא יורד מהבנק, וכמה כבר צברת עליו לחיוב הקרוב. את הסכום הזה רואים באפליקציה של הכרטיס.
          </p>
          <div class="card">
            <MethodsEditor items={methods} accounts={named(accounts)} onChange={setMethods} />
          </div>
          <button disabled={named(methods).length === 0} onClick={() => setStep(2)}>
            המשך
          </button>
          <button class="link" onClick={() => setStep(0)}>
            חזרה
          </button>
        </>
      )}

      {step === 2 && (
        <>
          <h1>על מה אתה מוציא?</h1>
          <p class="muted">הורד סימון ממה שלא רלוונטי, שנה שמות או הוסף משלך.</p>
          <div class="card">
            <h2>הוצאות</h2>
            <CategoriesEditor items={categories} kind="expense" onChange={setCategories} />
          </div>
          <div class="card">
            <h2>הכנסות</h2>
            <CategoriesEditor items={categories} kind="income" onChange={setCategories} />
          </div>
          <button disabled={saving} onClick={finish}>
            סיום
          </button>
          <button class="link" onClick={() => setStep(1)}>
            חזרה
          </button>
        </>
      )}
    </div>
  );
}

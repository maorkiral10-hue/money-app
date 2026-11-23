import { useState } from 'preact/hooks';
import { ACCENTS, loadTheme, saveTheme, type Theme } from '../theme';

/** "ערכת נושא": dark or light, and the main color. Everything changes at once, as it's chosen. */
export function ThemeScreen(props: { onBack: () => void }) {
  const [theme, setTheme] = useState<Theme>(loadTheme);
  // From the latest choice, so two quick taps (a mode, then a color) both count
  const choose = (change: Partial<Theme>) =>
    setTheme(prev => {
      const next = { ...prev, ...change };
      saveTheme(next);
      return next;
    });
  return (
    <>
      <header class="top">
        <h1>ערכת נושא</h1>
        <button class="link" onClick={props.onBack}>
          חזרה
        </button>
      </header>
      <p class="muted">איך האפליקציה נראית אצלך. השינוי קורה מיד, ונשמר במכשיר הזה.</p>

      <div class="muted small">מצב</div>
      <div class="theme-seg" role="group" aria-label="מצב">
        <span class={`theme-seg-ind ${theme.mode === 'light' ? 'light' : ''}`} />
        <button aria-pressed={theme.mode === 'dark'} onClick={() => choose({ mode: 'dark' })}>
          כהה
        </button>
        <button aria-pressed={theme.mode === 'light'} onClick={() => choose({ mode: 'light' })}>
          בהיר
        </button>
      </div>

      <div class="muted small">צבע ראשי</div>
      <div class="swatches">
        {ACCENTS.map(a => (
          <button key={a.id} class={`swatch-pick ${theme.accent === a.id ? 'on' : ''}`} aria-pressed={theme.accent === a.id} onClick={() => choose({ accent: a.id })}>
            <span class="dot" style={{ background: theme.mode === 'dark' ? a.dark : a.light }} />
            {a.name}
          </button>
        ))}
      </div>

      <div class="card">
        <p class="muted small">הצבע הראשי צובע כפתורים, קישורים, את היום הנבחר וכותרות של גרפים. הכנסות תמיד בירוק, הוצאות באדום וחיסכון בכתום.</p>
        <div class="money-key small">
          <span class="inc">● הכנסות</span>
          <span class="exp">● הוצאות</span>
          <span class="sav">● חיסכון</span>
        </div>
        <button onClick={props.onBack}>נראה טוב</button>
      </div>
    </>
  );
}

// The look the user chose in "ערכת נושא": dark or light, and a main color. Kept on this device (like a
// phone's wallpaper), and put on the page before it's drawn (index.html) so it never flashes the wrong one.

export type ThemeMode = 'dark' | 'light';
export type Accent = 'mint' | 'purple' | 'coral' | 'sky' | 'pink' | 'gold';

export interface Theme {
  mode: ThemeMode;
  accent: Accent;
}

/** Each main color: its name, and its step on a dark and on a light background (the same as styles.css). */
export const ACCENTS: { id: Accent; name: string; dark: string; light: string }[] = [
  { id: 'mint', name: 'מנטה', dark: '#7df2c3', light: '#0e8f65' },
  { id: 'purple', name: 'סגול', dark: '#b9a6ff', light: '#6c4ce0' },
  { id: 'coral', name: 'אלמוג', dark: '#ff9c85', light: '#d9502c' },
  { id: 'sky', name: 'תכלת', dark: '#7cc8ff', light: '#1f74cc' },
  { id: 'pink', name: 'ורוד', dark: '#ff8fc7', light: '#c93682' },
  { id: 'gold', name: 'זהב', dark: '#ffd166', light: '#a87400' },
];

const KEY = 'theme';
export const DEFAULT_THEME: Theme = { mode: 'dark', accent: 'mint' };
const BACKGROUND: Record<ThemeMode, string> = { dark: '#0a0e1a', light: '#f3f5fa' };

export function loadTheme(): Theme {
  try {
    const t = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Theme> | null;
    return {
      mode: t?.mode === 'light' ? 'light' : 'dark',
      accent: ACCENTS.some(a => a.id === t?.accent) ? t!.accent! : DEFAULT_THEME.accent,
    };
  } catch {
    return DEFAULT_THEME;
  }
}

export function applyTheme(t: Theme) {
  const root = document.documentElement;
  root.dataset.mode = t.mode;
  root.dataset.accent = t.accent;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', BACKGROUND[t.mode]);
}

export function saveTheme(t: Theme) {
  applyTheme(t);
  try {
    localStorage.setItem(KEY, JSON.stringify(t));
  } catch {
    // private browsing: it holds until the app closes
  }
}

// The look the user chose in "ערכת נושא": dark or light, and a main color. Kept on this device (like a
// phone's wallpaper), and put on the page before it's drawn (index.html) so it never flashes the wrong one.

export type ThemeMode = 'dark' | 'light';
export type Accent = 'mint' | 'purple' | 'coral' | 'sky' | 'pink' | 'gold';
export type FontSet = 'poster' | 'soft' | 'magazine' | 'notebook' | 'terminal' | 'headline';

export interface Theme {
  mode: ThemeMode;
  accent: Accent;
  font: FontSet;
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

/** The font sets (their faces are in styles.css): a name and what it feels like. */
export const FONTS: { id: FontSet; name: string; feel: string }[] = [
  { id: 'poster', name: 'פוסטר', feel: 'גבוה, צר ונועז' },
  { id: 'soft', name: 'רך', feel: 'מעוגל וידידותי' },
  { id: 'magazine', name: 'מגזין', feel: 'סריף קלאסי' },
  { id: 'notebook', name: 'פנקס', feel: 'כמו כתב יד' },
  { id: 'terminal', name: 'מסוף', feel: 'טכני ומדויק' },
  { id: 'headline', name: 'כותרת', feel: 'עבה ובולט' },
];

const KEY = 'theme';
export const DEFAULT_THEME: Theme = { mode: 'dark', accent: 'mint', font: 'poster' };
const BACKGROUND: Record<ThemeMode, string> = { dark: '#0a0e1a', light: '#f3f5fa' };

export function loadTheme(): Theme {
  try {
    const t = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Theme> | null;
    return {
      mode: t?.mode === 'light' ? 'light' : 'dark',
      accent: ACCENTS.some(a => a.id === t?.accent) ? t!.accent! : DEFAULT_THEME.accent,
      font: FONTS.some(f => f.id === t?.font) ? t!.font! : DEFAULT_THEME.font,
    };
  } catch {
    return DEFAULT_THEME;
  }
}

export function applyTheme(t: Theme) {
  const root = document.documentElement;
  root.dataset.mode = t.mode;
  root.dataset.accent = t.accent;
  root.dataset.font = t.font;
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

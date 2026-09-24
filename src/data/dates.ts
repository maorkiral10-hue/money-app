const pad = (n: number) => String(n).padStart(2, '0');

export const ymd = (y: number, m0: number, d: number) => `${y}-${pad(m0 + 1)}-${pad(d)}`;
export const toDateStr = (d: Date) => ymd(d.getFullYear(), d.getMonth(), d.getDate());
export const todayStr = () => toDateStr(new Date());

export const parseDate = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m0: m - 1, d };
};

export const daysInMonth = (y: number, m0: number) => new Date(y, m0 + 1, 0).getDate();

export function addDays(s: string, n: number) {
  const { y, m0, d } = parseDate(s);
  return toDateStr(new Date(y, m0, d + n));
}

/** The given day in the month `offset` months after `s`'s month, moved back to the month's last day if it has fewer days. */
export function dayInMonth(s: string, offset: number, day: number) {
  const { y, m0 } = parseDate(s);
  const first = new Date(y, m0 + offset, 1);
  return ymd(first.getFullYear(), first.getMonth(), Math.min(day, daysInMonth(first.getFullYear(), first.getMonth())));
}

export const endOfNextMonth = (today: string) => dayInMonth(today, 1, 31);

export const monthName = (s: string) => {
  const { y, m0 } = parseDate(s);
  return new Date(y, m0, 1).toLocaleDateString('he-IL', { month: 'long' });
};

export function dayLabel(s: string, today: string) {
  if (s === today) return 'היום';
  if (s === addDays(today, -1)) return 'אתמול';
  if (s === addDays(today, 1)) return 'מחר';
  const { y, m0, d } = parseDate(s);
  return new Date(y, m0, d).toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'numeric' });
}

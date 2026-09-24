const whole = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 });
const cents = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', minimumFractionDigits: 2 });

/** Agorot → "‏1,234 ₪" (agorot shown only when there are any). */
export function formatMoney(agorot: number, opts: { sign?: boolean } = {}) {
  const text = (agorot % 100 === 0 ? whole : cents).format(Math.abs(agorot) / 100);
  const sign = agorot < 0 ? '−' : opts.sign && agorot > 0 ? '+' : '';
  return `${sign}${text}`;
}

/** What the user typed → agorot, or null if it isn't a number. Accepts "12", "12.5", "12,50", "1,234". */
export function parseMoney(text: string): number | null {
  let t = text.replace(/[^\d.,]/g, '');
  // a comma followed by exactly 1–2 digits at the end is a decimal comma; otherwise commas are thousands separators
  t = /,\d{1,2}$/.test(t) && !t.includes('.') ? t.replace(',', '.') : t.replace(/,/g, '');
  if (!t || isNaN(Number(t))) return null;
  return Math.round(Number(t) * 100);
}

export const moneyInputText = (agorot: number) => (agorot ? String(agorot / 100) : '');

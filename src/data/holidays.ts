import { addDays, parseDate } from './dates';

/**
 * Jewish and Israeli days of note, worked out from the Hebrew calendar the phone already knows (no
 * internet, any year). The Hebrew calendar is fixed arithmetic; the Israeli days move by the rules in
 * force (set by law), so every year comes out as the state keeps it — as long as those rules stay.
 * Election days aren't included: each one is set on its own.
 */
export interface Holiday {
  date: string;
  name: string;
  /** A day off by law (שבתון): banks and most businesses closed. */
  rest?: boolean;
  /** An eve (ערב חג): listed on its day, not marked on the calendar grid. */
  eve?: boolean;
}

type HebrewDate = { year: number; month: string; day: number };

const format = new Intl.DateTimeFormat('en-u-ca-hebrew', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

// Month names as the calendar gives them, with the spellings some systems use
const MONTHS: [string, RegExp][] = [
  ['Tishri', /^tish/i],
  ['Heshvan', /hes?hvan|cheshvan/i],
  ['Kislev', /^kislev/i],
  ['Tevet', /^tevet|^tebeth/i],
  ['Shevat', /^she?vat/i],
  ['Adar I', /^adar (i|1)$/i],
  ['Adar II', /^adar (ii|2)$/i],
  ['Adar', /^adar$/i],
  ['Nisan', /^nisan/i],
  ['Iyar', /^iyy?ar/i],
  ['Sivan', /^sivan/i],
  ['Tamuz', /^tamm?uz/i],
  ['Av', /^av$/i],
  ['Elul', /^elul/i],
];

export function hebrewDate(date: string): HebrewDate {
  const parts = format.formatToParts(new Date(`${date}T12:00:00Z`));
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  const raw = get('month');
  const month = MONTHS.find(([, re]) => re.test(raw))?.[0] ?? raw;
  return { year: Number(get('year').replace(/\D/g, '')), month, day: Number(get('day')) };
}

const weekdayOf = (s: string) => {
  const { y, m0, d } = parseDate(s);
  return new Date(y, m0, d).getDay();
};
const FRIDAY = 5;
const SATURDAY = 6;
const SUNDAY = 0;
const MONDAY = 1;

const HANUKKAH_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שביעי', 'שמיני'];

/** Worked out once per calendar year (the calendar redraws often: dragging, pinching). */
const yearCache = new Map<number, Holiday[]>();
const ofYear = (gy: number) => {
  let list = yearCache.get(gy);
  if (!list) yearCache.set(gy, (list = compute(`${gy}-01-01`, `${gy}-12-31`)));
  return list;
};

/** The Jewish and Israeli days between two days (inclusive), in date order. */
export function holidaysIn(from: string, to: string): Holiday[] {
  const out: Holiday[] = [];
  for (let gy = parseDate(from).y; gy <= parseDate(to).y; gy++) out.push(...ofYear(gy).filter(h => h.date >= from && h.date <= to));
  return out;
}

/** A day's own entries (usually none or one). */
export const holidaysOn = (date: string) => ofYear(parseDate(date).y).filter(h => h.date === date);

function compute(from: string, to: string): Holiday[] {
  // Hebrew dates of every day around the range, so each Hebrew year's days can be found
  const byHebrew = new Map<string, string>();
  const years = new Set<number>();
  for (let d = addDays(from, -400); d <= addDays(to, 40); d = addDays(d, 1)) {
    const h = hebrewDate(d);
    byHebrew.set(`${h.year}|${h.month}|${h.day}`, d);
    if (d >= from && d <= to) years.add(h.year);
  }
  const out: Holiday[] = [];
  for (const y of years) out.push(...yearHolidays(y, byHebrew));
  return out.filter(h => h.date >= from && h.date <= to).sort((a, b) => a.date.localeCompare(b.date));
}

function yearHolidays(y: number, byHebrew: Map<string, string>): Holiday[] {
  const at = (month: string, day: number, year = y) => byHebrew.get(`${year}|${month}|${day}`);
  // In a leap year Purim is in Adar II
  const adar = at('Adar II', 1) ? 'Adar II' : 'Adar';
  const list: Holiday[] = [];
  const add = (date: string | undefined, name: string, extra: Partial<Holiday> = {}) => {
    if (date) list.push({ date, name, ...extra });
  };
  /** A fast that falls on Shabbat is kept the next day. */
  const fast = (month: string, day: number, name: string) => {
    const d = at(month, day);
    if (d) add(weekdayOf(d) === SATURDAY ? addDays(d, 1) : d, name);
  };

  // Tishri
  add(at('Elul', 29, y - 1), 'ערב ראש השנה', { eve: true });
  add(at('Tishri', 1), 'ראש השנה', { rest: true });
  add(at('Tishri', 2), 'ראש השנה · יום שני', { rest: true });
  fast('Tishri', 3, 'צום גדליה');
  add(at('Tishri', 9), 'ערב יום כיפור', { eve: true });
  add(at('Tishri', 10), 'יום כיפור', { rest: true });
  add(at('Tishri', 14), 'ערב סוכות', { eve: true });
  add(at('Tishri', 15), 'סוכות', { rest: true });
  for (let d = 16; d <= 20; d++) add(at('Tishri', d), 'חול המועד סוכות');
  add(at('Tishri', 21), 'הושענא רבה');
  add(at('Tishri', 22), 'שמיני עצרת · שמחת תורה', { rest: true });

  // Rabin memorial day: 12 Heshvan, a Friday one moves to Thursday
  const rabin = at('Heshvan', 12);
  if (rabin) add(weekdayOf(rabin) === FRIDAY ? addDays(rabin, -1) : rabin, 'יום הזיכרון ליצחק רבין');

  // Hanukkah: eight days from 25 Kislev
  const hanukkah = at('Kislev', 25);
  if (hanukkah) HANUKKAH_DAYS.forEach((n, i) => add(addDays(hanukkah, i), `חנוכה · יום ${n}`));
  fast('Tevet', 10, 'צום עשרה בטבת');
  add(at('Shevat', 15), 'ט"ו בשבט');

  // Purim: the fast of Esther on Shabbat is kept on the Thursday before
  const esther = at(adar, 13);
  if (esther) add(weekdayOf(esther) === SATURDAY ? addDays(esther, -2) : esther, 'תענית אסתר');
  add(at(adar, 14), 'פורים');
  add(at(adar, 15), 'שושן פורים');

  // Nisan
  add(at('Nisan', 14), 'ערב פסח', { eve: true });
  add(at('Nisan', 15), 'פסח', { rest: true });
  for (let d = 16; d <= 20; d++) add(at('Nisan', d), 'חול המועד פסח');
  add(at('Nisan', 21), 'שביעי של פסח', { rest: true });

  // Holocaust day: 27 Nisan; a Friday moves to Thursday, a Sunday to Monday
  const shoah = at('Nisan', 27);
  if (shoah) {
    const w = weekdayOf(shoah);
    add(w === FRIDAY ? addDays(shoah, -1) : w === SUNDAY ? addDays(shoah, 1) : shoah, 'יום הזיכרון לשואה ולגבורה');
  }

  // Independence day: 5 Iyar; Friday or Shabbat moves to Thursday, Monday to Tuesday (so the memorial
  // day before it never follows Shabbat). The memorial day is always the day before.
  const five = at('Iyar', 5);
  if (five) {
    const w = weekdayOf(five);
    const atzmaut = w === FRIDAY ? addDays(five, -1) : w === SATURDAY ? addDays(five, -2) : w === MONDAY ? addDays(five, 1) : five;
    add(addDays(atzmaut, -1), 'יום הזיכרון לחללי מערכות ישראל ולנפגעי פעולות האיבה');
    add(atzmaut, 'יום העצמאות', { rest: true });
  }
  add(at('Iyar', 18), 'ל"ג בעומר');
  add(at('Iyar', 28), 'יום ירושלים');

  // Sivan, Tamuz, Av
  add(at('Sivan', 5), 'ערב שבועות', { eve: true });
  add(at('Sivan', 6), 'שבועות', { rest: true });
  fast('Tamuz', 17, 'צום י"ז בתמוז');
  fast('Av', 9, 'תשעה באב');
  add(at('Av', 15), 'ט"ו באב');
  return list;
}

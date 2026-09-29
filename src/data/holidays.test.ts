import { describe, expect, it } from 'vitest';
import { holidaysIn } from './holidays';

const find = (year: number, name: string) =>
  holidaysIn(`${year}-01-01`, `${year}-12-31`)
    .filter(h => h.name === name)
    .map(h => h.date);

describe('Jewish and Israeli days, against dates the state published', () => {
  it('the moving Israeli days land where they were kept', () => {
    // 2024: 5 Iyar was a Monday, moved to Tuesday (memorial day then Monday, not Sunday)
    expect(find(2024, 'יום העצמאות')).toEqual(['2024-05-14']);
    expect(find(2024, 'יום הזיכרון לחללי מערכות ישראל ולנפגעי פעולות האיבה')).toEqual(['2024-05-13']);
    // 2025: 5 Iyar a Friday, moved to Thursday
    expect(find(2025, 'יום העצמאות')).toEqual(['2025-05-01']);
    // 2021: 5 Iyar a Saturday, moved to Thursday
    expect(find(2021, 'יום העצמאות')).toEqual(['2021-04-15']);
    expect(find(2023, 'יום העצמאות')).toEqual(['2023-04-26']);
    // Bank of Israel's list for 2026
    expect(find(2026, 'יום העצמאות')).toEqual(['2026-04-22']);
    // Holocaust day 2024: 27 Nisan a Sunday, moved to Monday
    expect(find(2024, 'יום הזיכרון לשואה ולגבורה')).toEqual(['2024-05-06']);
    expect(find(2025, 'יום הזיכרון לשואה ולגבורה')).toEqual(['2025-04-24']);
    // The coming years, as listed by Hebcal
    expect([2027, 2028, 2029, 2030].map(y => find(y, 'יום העצמאות')[0])).toEqual(['2027-05-12', '2028-05-02', '2029-04-19', '2030-05-08']);
    expect([2027, 2028, 2029, 2030].map(y => find(y, 'יום הזיכרון לשואה ולגבורה')[0])).toEqual(['2027-05-04', '2028-04-24', '2029-04-12', '2030-04-30']);
  });

  it('fasts on Shabbat move, the fast of Esther to Thursday', () => {
    expect(find(2024, 'תענית אסתר')).toEqual(['2024-03-21']);
    expect(find(2025, 'תשעה באב')).toEqual(['2025-08-03']);
    expect(find(2024, 'תשעה באב')).toEqual(['2024-08-13']);
  });

  it('holidays and rest days match the Bank of Israel list for 2026', () => {
    const y = holidaysIn('2026-01-01', '2026-12-31');
    const on = (date: string) => y.filter(h => h.date === date).map(h => `${h.name}${h.rest ? ' (שבתון)' : ''}`);
    expect(on('2026-03-03')).toEqual(['פורים']);
    expect(on('2026-03-04')).toEqual(['שושן פורים']);
    expect(on('2026-04-02')).toEqual(['פסח (שבתון)']);
    expect(on('2026-04-08')).toEqual(['שביעי של פסח (שבתון)']);
    expect(on('2026-05-22')).toEqual(['שבועות (שבתון)']);
    expect(on('2026-07-23')).toEqual(['תשעה באב']);
    expect(on('2026-09-12')).toEqual(['ראש השנה (שבתון)']);
    expect(on('2026-09-13')).toEqual(['ראש השנה · יום שני (שבתון)']);
    expect(on('2026-09-21')).toEqual(['יום כיפור (שבתון)']);
    expect(on('2026-09-11')).toEqual(['ערב ראש השנה']);
  });

  it('Hanukkah is eight days from 25 Kislev, across the new year', () => {
    const h = holidaysIn('2024-12-20', '2025-01-10').filter(x => x.name.startsWith('חנוכה'));
    expect(h.map(x => x.date)).toEqual(['2024-12-26', '2024-12-27', '2024-12-28', '2024-12-29', '2024-12-30', '2024-12-31', '2025-01-01', '2025-01-02']);
  });
});

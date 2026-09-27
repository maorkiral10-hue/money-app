import { Segmented } from './inputs';

const DAYS = Array.from({ length: 27 }, (_, i) => i + 2);

/** When the financial month starts: the 1st, or another day such as salary day. Used in the questionnaire and settings. */
export function MonthStartPicker(props: { value: number; onChange: (day: number) => void }) {
  return (
    <>
      <Segmented
        value={props.value === 1 ? 'first' : 'other'}
        onChange={v => props.onChange(v === 'first' ? 1 : props.value === 1 ? 10 : props.value)}
        options={[
          ['first', 'ב-1 בחודש'],
          ['other', 'ביום אחר'],
        ]}
      />
      {props.value !== 1 && (
        <label class="field inline">
          <span>החודש מתחיל כל חודש ב-</span>
          <select value={props.value} onChange={e => props.onChange(Number(e.currentTarget.value))}>
            {DAYS.map(d => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
      )}
      <p class="muted small">
        {props.value === 1
          ? 'חודש רגיל, מה-1 עד סוף החודש. הכי נוח להשוואה עם פירוט הבנק.'
          : `כל חודש כספי יתחיל ב-${props.value} ויסתיים ב-${props.value - 1} בחודש שאחריו. מתאים למי שחי ממשכורת למשכורת.`}
      </p>
    </>
  );
}

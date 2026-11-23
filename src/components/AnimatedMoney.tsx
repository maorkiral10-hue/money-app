import { useEffect, useState } from 'preact/hooks';
import { formatMoney } from '../data/money';

const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
const isDigit = (c: string) => DIGITS.includes(c);

/**
 * An amount whose digits roll into place like a counter: up from zero when it first appears, and each digit
 * on its own to the new value when it changes (the ones on the right first). Separators and the ₪ stay still.
 * Skipped for people who turned motion down in the phone's accessibility settings.
 */
export function AnimatedMoney(props: { value: number; sign?: boolean }) {
  const text = formatMoney(props.value, { sign: props.sign });
  // First paint at zero, then roll to the value on the next frame
  const [rolled, setRolled] = useState(reducedMotion());
  useEffect(() => {
    if (rolled) return;
    const f = requestAnimationFrame(() => requestAnimationFrame(() => setRolled(true)));
    // frames don't run with the app in the background: land anyway
    const land = setTimeout(() => setRolled(true), 120);
    return () => {
      cancelAnimationFrame(f);
      clearTimeout(land);
    };
  }, []);

  // The number itself (first digit to last) rolls in a left-to-right run of its own; what's around it
  // (the sign, the ₪, the direction marks) stays as plain text, so it sits where it always did
  const chars = [...text];
  const first = chars.findIndex(isDigit);
  if (first < 0) return <>{text}</>;
  let last = chars.length - 1;
  while (!isDigit(chars[last])) last--;
  const number = chars.slice(first, last + 1);
  // Digits are counted from the right, so a digit keeps its column when the amount grows a digit on the left
  let place = number.filter(isDigit).length;
  return (
    <span class="odo" role="img" aria-label={text}>
      {chars.slice(0, first).join('')}
      <span class="odo-num" aria-hidden="true">
        {number.map((c, i) => {
          if (!isDigit(c)) return <span key={`s${i}`}>{c}</span>;
          const p = place--;
          const d = rolled ? Number(c) : 0;
          return (
            <span key={`d${p}`} class="odo-digit">
              {/* invisible: gives the column its own digit's width */}
              <span class="odo-size">{c}</span>
              <span class="odo-col" style={{ transform: `translateY(${-d * 10}%)`, transitionDelay: `${(p - 1) * 45}ms` }}>
                {DIGITS.map(x => (
                  <span key={x}>{x}</span>
                ))}
              </span>
            </span>
          );
        })}
      </span>
      {chars.slice(last + 1).join('')}
    </span>
  );
}

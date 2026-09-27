import { useEffect, useRef, useState } from 'preact/hooks';
import { formatMoney } from '../data/money';

const DURATION = 650;
const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * An amount that counts up quickly to its value when it first appears, and from the old value to the
 * new one when it changes. Skipped for people who turned motion down in the phone's accessibility settings.
 */
export function AnimatedMoney(props: { value: number; sign?: boolean }) {
  const [shown, setShown] = useState(reducedMotion() ? props.value : 0);
  const from = useRef(shown);

  useEffect(() => {
    if (reducedMotion()) {
      setShown(props.value);
      return;
    }
    const start = performance.now();
    const origin = from.current;
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION);
      const eased = 1 - Math.pow(1 - t, 3);
      const v = Math.round(origin + (props.value - origin) * eased);
      from.current = v;
      setShown(v);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    // If frames don't run (app in the background, a paused screen), land on the real amount anyway
    const land = setTimeout(() => {
      from.current = props.value;
      setShown(props.value);
    }, DURATION + 80);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(land);
    };
  }, [props.value]);

  // Whole shekels while counting, so the digits don't jitter; the exact amount once it lands
  const landed = shown === props.value;
  return <>{formatMoney(landed ? shown : Math.round(shown / 100) * 100, { sign: props.sign })}</>;
}

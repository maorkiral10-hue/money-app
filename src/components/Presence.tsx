import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

const LEAVE_MS = 260;

/**
 * Lets a pop-up leave softly: when what it wraps goes away, the last of it stays on screen for a moment
 * with "leaving" on (it fades and sinks, see styles.css) and can't be tapped, then it's gone. The wrapper is
 * the same while it shows and while it leaves, so the pop-up isn't drawn anew (it doesn't pop in again).
 */
export function Presence(props: { children?: ComponentChildren }) {
  const has = !!props.children && props.children !== true;
  const last = useRef<ComponentChildren>(null);
  const [leaving, setLeaving] = useState(false);
  if (has) last.current = props.children;

  useEffect(() => {
    if (has) {
      setLeaving(false);
      return;
    }
    if (!last.current) return;
    setLeaving(true);
    const t = setTimeout(() => {
      last.current = null;
      setLeaving(false);
    }, LEAVE_MS);
    return () => clearTimeout(t);
  }, [has]);

  const shown = has ? props.children : last.current;
  if (!shown) return null;
  return <div class={!has ? 'presence-leaving' : undefined}>{shown}</div>;
}

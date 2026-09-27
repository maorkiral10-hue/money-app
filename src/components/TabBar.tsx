import type { ComponentChildren } from 'preact';
import { useRef, useState } from 'preact/hooks';

export type Tab = 'home' | 'month' | 'dashboard';
/** Right to left, as they appear on screen. New main screens are added here. */
export const TABS: Tab[] = ['home', 'month', 'dashboard'];

const ICONS: Record<Tab, ComponentChildren> = {
  home: <path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z" />,
  month: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M4 10h16M9 3v4M15 3v4" />
    </>
  ),
  dashboard: (
    <>
      <path d="M5 20V11" />
      <path d="M12 20V5" />
      <path d="M19 20v-6" />
    </>
  ),
};
const LABELS: Record<Tab, string> = { home: 'בית', month: 'החודש', dashboard: 'דשבורד' };

/** The floating bar at the bottom: the main screens, with "+" (new entry) in the middle. */
export function TabBar(props: { current: Tab; onSelect: (tab: Tab) => void; onAdd: () => void }) {
  // "+" sits in the middle of the bar
  const half = Math.ceil(TABS.length / 2);
  const item = (tab: Tab) => (
    <button key={tab} class={`tab ${props.current === tab ? 'on' : ''}`} onClick={() => props.onSelect(tab)}>
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        {ICONS[tab]}
      </svg>
      <span>{LABELS[tab]}</span>
    </button>
  );
  return (
    <nav class="tabbar">
      {TABS.slice(0, half).map(item)}
      <button class="tab-add" aria-label="תנועה חדשה" onClick={props.onAdd}>
        +
      </button>
      {TABS.slice(half).map(item)}
    </nav>
  );
}

/**
 * The main screens, dragged sideways with the finger. The tabs sit right to left like the bar, so the
 * next one waits on the left: dragging right pulls it in from the left, dragging left brings back the
 * previous one from the right. The neighbour is drawn beside the current screen while dragging, and a
 * release past a quarter of the width finishes the slide. Rows with their own slide (delete), text
 * fields and selects are left alone.
 */
export function SwipeTabs(props: { current: Tab; onSelect: (tab: Tab) => void; render: (tab: Tab) => ComponentChildren }) {
  const [dx, setDx] = useState(0);
  const [animating, setAnimating] = useState(false);
  const drag = useRef<{ x: number; y: number; horizontal: boolean | null } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const i = TABS.indexOf(props.current);
  // Choosing a tab from the bar slides it in from its side too (a finished drag has already slid)
  const shownIndex = useRef(i);
  const byDrag = useRef(false);
  const enter = useRef('');
  if (shownIndex.current !== i) {
    enter.current = byDrag.current ? '' : i > shownIndex.current ? 'enter-from-left' : 'enter-from-right';
    shownIndex.current = i;
    byDrag.current = false;
  }
  const width = () => box.current?.clientWidth || window.innerWidth;
  // Dragging right shows the tab to the left (next); dragging left shows the one to the right (previous)
  const neighbour = dx > 0 ? TABS[i + 1] : dx < 0 ? TABS[i - 1] : undefined;
  // The neighbour is drawn from the top of what's on screen, so it lines up once it becomes the page
  const neighbourTop = box.current ? Math.max(0, -box.current.getBoundingClientRect().top) : 0;

  const finish = (target: Tab | undefined, to: number) => {
    setAnimating(true);
    setDx(to);
    setTimeout(() => {
      if (target) {
        byDrag.current = true;
        props.onSelect(target);
        scrollTo(0, 0);
      }
      setAnimating(false);
      setDx(0);
    }, 220);
  };

  return (
    <div
      ref={box}
      class="swipe-tabs"
      onTouchStart={e => {
        if (animating) return;
        const target = e.target as HTMLElement;
        drag.current = target.closest('.swipe, input, textarea, select') ? null : { x: e.touches[0].clientX, y: e.touches[0].clientY, horizontal: null };
      }}
      onTouchMove={e => {
        const d = drag.current;
        if (!d) return;
        const mx = e.touches[0].clientX - d.x;
        const my = e.touches[0].clientY - d.y;
        if (d.horizontal === null) {
          if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
          d.horizontal = Math.abs(mx) > Math.abs(my);
        }
        if (!d.horizontal) return;
        e.preventDefault();
        const hasNeighbour = mx > 0 ? !!TABS[i + 1] : !!TABS[i - 1];
        // Past the first or last tab it only gives a little, like a rubber band
        setDx(hasNeighbour ? mx : mx * 0.25);
      }}
      onTouchEnd={() => {
        const d = drag.current;
        drag.current = null;
        if (!d?.horizontal) return;
        const target = neighbour;
        if (target && Math.abs(dx) > width() / 4) finish(target, dx > 0 ? width() : -width());
        else finish(undefined, 0);
      }}
    >
      <div key={props.current} class={`tab-panel ${enter.current}`} style={{ transform: `translateX(${dx}px)`, transition: animating ? 'transform .22s ease-out' : 'none' }}>
        {props.render(props.current)}
      </div>
      {neighbour && (
        <div
          class="tab-panel neighbour"
          style={{
            top: `${neighbourTop}px`,
            transform: `translateX(${dx > 0 ? dx - width() : dx + width()}px)`,
            transition: animating ? 'transform .22s ease-out' : 'none',
          }}
        >
          {props.render(neighbour)}
        </div>
      )}
    </div>
  );
}

import type { ComponentChildren } from 'preact';
import { useRef } from 'preact/hooks';

export type Tab = 'home' | 'dashboard';
/** Right to left, as they appear on screen. New main screens are added here. */
export const TABS: Tab[] = ['home', 'dashboard'];

const ICONS: Record<Tab, ComponentChildren> = {
  home: <path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z" />,
  dashboard: (
    <>
      <path d="M5 20V11" />
      <path d="M12 20V5" />
      <path d="M19 20v-6" />
    </>
  ),
};
const LABELS: Record<Tab, string> = { home: 'בית', dashboard: 'תמונת מצב' };

/** The floating bar at the bottom: the main screens, with "+" (new entry) in the middle. */
export function TabBar(props: { current: Tab; onSelect: (tab: Tab) => void; onAdd: () => void }) {
  const [first, ...rest] = TABS;
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
      {item(first)}
      <button class="tab-add" aria-label="תנועה חדשה" onClick={props.onAdd}>
        +
      </button>
      {rest.map(item)}
    </nav>
  );
}

/**
 * Wraps a main screen so a sideways swipe moves to the neighbouring tab. Swipes that start on a
 * row with its own slide (delete), a text field or a scrollable strip are left alone.
 */
export function SwipeTabs(props: { current: Tab; onSelect: (tab: Tab) => void; children: ComponentChildren }) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const i = TABS.indexOf(props.current);

  return (
    <div
      class="swipe-tabs"
      onTouchStart={e => {
        const target = e.target as HTMLElement;
        start.current = target.closest('.swipe, input, textarea, select') ? null : { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }}
      onTouchEnd={e => {
        const s = start.current;
        start.current = null;
        if (!s) return;
        const dx = e.changedTouches[0].clientX - s.x;
        const dy = e.changedTouches[0].clientY - s.y;
        if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        // Tabs run right to left: a swipe to the left brings in the next one
        const next = dx < 0 ? TABS[i + 1] : TABS[i - 1];
        if (next) props.onSelect(next);
      }}
    >
      {props.children}
    </div>
  );
}

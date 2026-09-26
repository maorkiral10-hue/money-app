import type { ComponentChildren } from 'preact';
import { useRef, useState } from 'preact/hooks';

const OPEN = -88;

/**
 * A row that slides left to reveal a "מחיקה" button, like in iPhone lists.
 * Vertical movement is left to the page scroll; a tap after a slide doesn't also open the row.
 */
export function SwipeRow(props: { onDelete: () => void; children: ComponentChildren }) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; y: number; base: number; active: boolean } | null>(null);
  const swallowClick = useRef(false);

  return (
    <div class="swipe">
      <button
        type="button"
        class="swipe-delete"
        tabIndex={offset ? 0 : -1}
        // Hidden while the row is closed, so it never peeks out at the row's edges
        style={{ visibility: offset || dragging ? 'visible' : 'hidden' }}
        onClick={props.onDelete}
      >
        מחיקה
      </button>
      <div
        class={`swipe-content ${dragging ? 'dragging' : ''}`}
        style={{ transform: `translateX(${offset}px)`, transition: dragging ? 'none' : 'transform .2s' }}
        onPointerDown={e => {
          drag.current = { x: e.clientX, y: e.clientY, base: offset, active: false };
        }}
        onPointerMove={e => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x;
          const dy = e.clientY - d.y;
          if (!d.active) {
            if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) drag.current = null;
            if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy)) return;
            d.active = true;
            setDragging(true);
            // Sliding over a text field shouldn't type into or select it
            (document.activeElement as HTMLElement | null)?.blur();
            e.currentTarget.setPointerCapture(e.pointerId);
          }
          setOffset(Math.max(OPEN * 1.4, Math.min(0, d.base + dx)));
        }}
        onPointerUp={() => {
          const d = drag.current;
          drag.current = null;
          if (!d?.active) {
            // A plain tap on an open row closes it
            if (offset) {
              setOffset(0);
              swallowClick.current = true;
            }
            return;
          }
          setDragging(false);
          swallowClick.current = true;
          setOffset(o => (o < OPEN / 2 ? OPEN : 0));
        }}
        onPointerCancel={() => {
          drag.current = null;
          setDragging(false);
          setOffset(o => (o < OPEN / 2 ? OPEN : 0));
        }}
        onClickCapture={e => {
          if (swallowClick.current) {
            swallowClick.current = false;
            e.stopPropagation();
            e.preventDefault();
          }
        }}
      >
        {props.children}
      </div>
    </div>
  );
}

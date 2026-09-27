import { useState } from 'preact/hooks';
import { formatMoney } from '../data/money';

// Small SVG charts for the dashboard. Colors come from CSS variables (--series-N, --pos-bar, --neg-bar)
// so light and dark mode each get their own validated steps. Tapping a mark shows its numbers
// above the chart (the phone's version of hovering); every chart also has its numbers in text.

export const SERIES = (i: number) => `var(--series-${(i % 7) + 1})`;
export const OTHER_COLOR = 'var(--series-other)';

/** "52%", or "<1%" rather than a misleading 0% for a small but real amount. */
const pct = (part: number, total: number) => {
  const p = (part / total) * 100;
  return p > 0 && p < 1 ? '<1%' : `${Math.round(p)}%`;
};

/** Share of a whole, e.g. spending by category. Tap a slice or a legend row to see it in the middle. */
export function Donut(props: { slices: { label: string; amount: number; color: string }[] }) {
  const [selected, setSelected] = useState<number | null>(null);
  const total = props.slices.reduce((a, s) => a + s.amount, 0);
  const r = 42;
  const circ = 2 * Math.PI * r;
  const gap = props.slices.length > 1 ? 1.2 : 0;
  let offset = 0;
  const sel = selected !== null ? props.slices[selected] : undefined;

  return (
    <div class="donut">
      <svg viewBox="0 0 120 120" role="img" aria-label="התפלגות לפי קטגוריה">
        {props.slices.map((s, i) => {
          const len = (s.amount / total) * circ;
          const dash = Math.max(0, len - gap);
          const el = (
            <circle
              key={i}
              cx="60"
              cy="60"
              r={r}
              fill="none"
              stroke={s.color}
              stroke-width={selected === i ? 18 : 14}
              stroke-dasharray={`${dash} ${circ - dash}`}
              stroke-dashoffset={-offset}
              transform="rotate(-90 60 60)"
              opacity={selected === null || selected === i ? 1 : 0.35}
              onClick={() => setSelected(selected === i ? null : i)}
            />
          );
          offset += len;
          return el;
        })}
        <text x="60" y="56" text-anchor="middle" class="donut-label">
          {sel ? sel.label : 'סה"כ'}
        </text>
        <text x="60" y="72" text-anchor="middle" class="donut-value">
          {formatMoney(sel ? sel.amount : total)}
        </text>
      </svg>
      <div class="legend">
        {props.slices.map((s, i) => (
          <button key={i} class={`legend-row ${selected === i ? 'on' : ''}`} onClick={() => setSelected(selected === i ? null : i)}>
            <span class="swatch" style={{ background: s.color }} />
            <span class="legend-name">{s.label}</span>
            <span>{formatMoney(s.amount)}</span>
            <span class="muted small legend-pct">{pct(s.amount, total)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

interface MonthPoint {
  label: string;
  income: number;
  expenses: number;
}

const W = 320;
const H = 150;
const BASE = 130;

/** Income next to spending for each month. */
export function IncomeExpenseBars(props: { months: MonthPoint[] }) {
  const [selected, setSelected] = useState(props.months.length - 1);
  const max = Math.max(1, ...props.months.flatMap(m => [m.income, m.expenses]));
  const slot = W / Math.max(props.months.length, 1);
  const bw = Math.min(22, (slot - 10) / 2);
  const s = props.months[selected];

  return (
    <div>
      <div class="chart-legend">
        <span>
          <span class="swatch" style={{ background: 'var(--inc-bar)' }} /> <span class="inc">הכנסות</span>
        </span>
        <span>
          <span class="swatch" style={{ background: 'var(--exp-bar)' }} /> <span class="exp">הוצאות</span>
        </span>
      </div>
      {s && (
        <p class="chart-readout">
          <b>{s.label}:</b> <span class="inc">הכנסות {formatMoney(s.income)}</span> · <span class="exp">הוצאות {formatMoney(s.expenses)}</span> ·{' '}
          <span class={s.income - s.expenses >= 0 ? 'inc' : 'exp'}>
            {s.income - s.expenses >= 0 ? 'נשאר' : 'חסר'} {formatMoney(Math.abs(s.income - s.expenses))}
          </span>
        </p>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} class="chart" role="img" aria-label="הכנסות מול הוצאות לפי חודש">
        <line x1="0" x2={W} y1={BASE} y2={BASE} class="baseline" />
        {props.months.map((m, i) => {
          const cx = slot * i + slot / 2;
          const hi = (m.income / max) * (BASE - 8);
          const he = (m.expenses / max) * (BASE - 8);
          return (
            <g key={i} onClick={() => setSelected(i)} class={selected === i ? 'sel' : 'dim'}>
              <rect x={cx - slot / 2} y="0" width={slot} height={H} fill="transparent" />
              <Bar x={cx - bw - 1} w={bw} h={hi} color={'var(--inc-bar)'} />
              <Bar x={cx + 1} w={bw} h={he} color={'var(--exp-bar)'} />
              <text x={cx} y={H - 4} text-anchor="middle" class="axis-label">
                {m.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** A bar standing on the baseline with a rounded top. */
function Bar(props: { x: number; w: number; h: number; color: string }) {
  if (props.h <= 0) return null;
  const r = Math.min(4, props.h, props.w / 2);
  const { x, w, h } = props;
  const y = BASE - h;
  return <path d={`M${x},${BASE} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${BASE} Z`} fill={props.color} />;
}

/** What each month added or took away: up is left over, down is short. */
export function NetBars(props: { months: { label: string; net: number; note?: string }[] }) {
  const [selected, setSelected] = useState(props.months.length - 1);
  const max = Math.max(1, ...props.months.map(m => Math.abs(m.net)));
  const slot = W / Math.max(props.months.length, 1);
  const bw = Math.min(30, slot - 12);
  const mid = 64;
  const s = props.months[selected];

  return (
    <div>
      {s && (
        <p class="chart-readout">
          <b>{s.label}:</b>{' '}
          <span class={s.net >= 0 ? 'inc' : 'exp'}>
            {s.net >= 0 ? 'נשאר' : 'חסר'} {formatMoney(Math.abs(s.net))}
          </span>
          {s.note && <span class="muted"> · {s.note}</span>}
        </p>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} class="chart" role="img" aria-label="נשאר או חסר בכל חודש">
        <line x1="0" x2={W} y1={mid} y2={mid} class="baseline" />
        {props.months.map((m, i) => {
          const cx = slot * i + slot / 2;
          const h = (Math.abs(m.net) / max) * (mid - 6);
          const r = Math.min(4, h, bw / 2);
          const up = m.net >= 0;
          const x = cx - bw / 2;
          const d = up
            ? `M${x},${mid} V${mid - h + r} Q${x},${mid - h} ${x + r},${mid - h} H${x + bw - r} Q${x + bw},${mid - h} ${x + bw},${mid - h + r} V${mid} Z`
            : `M${x},${mid} V${mid + h - r} Q${x},${mid + h} ${x + r},${mid + h} H${x + bw - r} Q${x + bw},${mid + h} ${x + bw},${mid + h - r} V${mid} Z`;
          return (
            <g key={i} onClick={() => setSelected(i)} class={selected === i ? 'sel' : 'dim'}>
              <rect x={cx - slot / 2} y="0" width={slot} height={H} fill="transparent" />
              {h > 0 && <path d={d} fill={up ? 'var(--inc-bar)' : 'var(--exp-bar)'} />}
              <text x={cx} y={H - 4} text-anchor="middle" class="axis-label">
                {m.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** One bar split into parts, e.g. how spending was paid. */
export function StackBar(props: { parts: { label: string; amount: number; color: string }[] }) {
  const total = props.parts.reduce((a, p) => a + p.amount, 0);
  return (
    <div>
      <div class="stack">
        {props.parts.map((p, i) => (
          <span key={i} style={{ width: `${(p.amount / total) * 100}%`, background: p.color }} />
        ))}
      </div>
      <div class="legend">
        {props.parts.map((p, i) => (
          <div key={i} class="legend-row">
            <span class="swatch" style={{ background: p.color }} />
            <span class="legend-name">{p.label}</span>
            <span>{formatMoney(p.amount)}</span>
            <span class="muted small legend-pct">{pct(p.amount, total)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

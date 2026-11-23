import { useEffect, useRef, useState } from 'preact/hooks';
import { parseDate } from '../data/dates';
import { formatMoney } from '../data/money';

// The dashboard's charts, drawn in SVG. Time runs right to left like the text: the oldest on the right,
// the newest on the left. Tapping a mark shows its number (the phone's version of hovering).

const pct = (part: number, total: number) => {
  const p = (part / total) * 100;
  return p > 0 && p < 1 ? '<1%' : `${Math.round(p)}%`;
};

export interface Slice {
  key: string;
  label: string;
  amount: number;
  color: string;
  /** What a folded "other" slice holds, opened when it's chosen. */
  inside?: { label: string; amount: number }[];
}

/** Where the money went: each slice with its share on it, the amount in the middle when one is tapped. */
export function Pie(props: { slices: Slice[]; centerLabel: string; centerValue: string; centerNote?: string }) {
  const [sel, setSel] = useState<string | null>(null);
  const total = props.slices.reduce((a, s) => a + s.amount, 0);
  const chosen = props.slices.find(s => s.key === sel);
  const R = 100;
  const r = 62;
  const C = 110;
  let angle = -Math.PI / 2;
  const toggle = (k: string) => setSel(sel === k ? null : k);
  const point = (a: number, rad: number) => [C + rad * Math.cos(a), C + rad * Math.sin(a)];

  return (
    <div class="pie">
      <div class="pie-box">
        <svg viewBox="0 0 220 220" role="img" aria-label="לאן הכסף הולך, לפי סוג">
          {total > 0 &&
            props.slices.map(s => {
              const span = (s.amount / total) * Math.PI * 2;
              const a0 = angle;
              const a1 = angle + span;
              angle = a1;
              const mid = (a0 + a1) / 2;
              const push = s.key === sel ? 7 : 0;
              const dx = push * Math.cos(mid);
              const dy = push * Math.sin(mid);
              const large = span > Math.PI ? 1 : 0;
              const one = props.slices.length === 1;
              const [x0, y0] = point(a0, R);
              const [x1, y1] = point(a1, R);
              const [x2, y2] = point(a1, r);
              const [x3, y3] = point(a0, r);
              const d = one
                ? `M${C - R},${C} A${R},${R} 0 1 1 ${C + R},${C} A${R},${R} 0 1 1 ${C - R},${C} M${C - r},${C} A${r},${r} 0 1 0 ${C + r},${C} A${r},${r} 0 1 0 ${C - r},${C} Z`
                : `M${x0},${y0} A${R},${R} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${r},${r} 0 ${large} 0 ${x3},${y3} Z`;
              const [lx, ly] = point(mid, (R + r) / 2);
              const share = s.amount / total;
              return (
                <g key={s.key} transform={`translate(${dx} ${dy})`} onClick={() => toggle(s.key)} class="pie-slice">
                  <path d={d} fill={s.color} fill-rule="evenodd" />
                  {share >= 0.05 && (
                    <text x={lx} y={ly} class="pie-pct" text-anchor="middle" dominant-baseline="central">
                      {Math.round(share * 100)}%
                    </text>
                  )}
                </g>
              );
            })}
        </svg>
        <div class="pie-center">
          <span class="muted small">{chosen ? chosen.label : props.centerLabel}</span>
          <strong>{chosen ? formatMoney(chosen.amount) : props.centerValue}</strong>
          <span class="muted small">{chosen ? pct(chosen.amount, total) : props.centerNote}</span>
        </div>
      </div>
      <div class="legend">
        {props.slices.map(s => (
          <div key={s.key}>
            <button class={`legend-row ${sel === s.key ? 'on' : ''}`} onClick={() => toggle(s.key)}>
              <span class="swatch" style={{ background: s.color }} />
              <span class="legend-name">{s.label}</span>
              <span class="legend-pct">{pct(s.amount, total)}</span>
            </button>
            {sel === s.key && s.inside && (
              <div class="pie-inside">
                {s.inside.map(i => (
                  <div key={i.label} class="line small">
                    <span>{i.label}</span>
                    <span>{formatMoney(i.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const W = 320;
const H = 160;
const TOP = 10;
const BOTTOM = 136;

/** One bar per period, the chosen one strong; tapping a bar shows its amount. Bars go down for minus. */
export function PeriodBars(props: { bars: { label: string; amount: number; missing?: boolean; running?: boolean; partial?: boolean }[]; current: number; color: string; soft: string; empty?: string }) {
  const [tapped, setTapped] = useState<number | null>(null);
  useEffect(() => setTapped(null), [props.bars.map(b => b.label).join()]);
  const n = props.bars.length;
  if (!n || props.bars.every(b => !b.amount)) return <p class="muted small">{props.empty ?? 'אין עדיין נתונים'}</p>;
  const max = Math.max(1, ...props.bars.map(b => b.amount));
  const min = Math.min(0, ...props.bars.map(b => b.amount));
  const zero = TOP + 14 + ((BOTTOM - TOP - 14) * max) / (max - min);
  const scale = (BOTTOM - TOP - 14) / (max - min);
  const slot = W / n;
  const bw = Math.min(28, slot - 10);
  const shown = tapped ?? props.current;
  const s = props.bars[shown];
  return (
    <div>
      <p class="chart-readout">
        {s &&
          (s.missing ? (
            <>
              <b>{s.label}:</b> <span class="muted">אין נתונים, עוד לא רשמת אז באפליקציה</span>
            </>
          ) : (
            <>
              <b>
                {s.label}
                {s.running ? ' (עד היום)' : s.partial ? ' (רק מאז שהתחלת לרשום)' : ''}:
              </b>{' '}
              {formatMoney(Math.abs(s.amount))}
              {s.amount < 0 && <span class="muted"> (יותר כסף ממה שנרשם)</span>}
            </>
          ))}
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} class="chart" role="img" aria-label="סכום לכל תקופה">
        <line x1="0" x2={W} y1={zero} y2={zero} class="baseline" />
        {props.bars.map((b, i) => {
          // the oldest on the right
          const cx = W - slot * i - slot / 2;
          const h = Math.abs(b.amount) * scale;
          const x = cx - bw / 2;
          const y = b.amount >= 0 ? zero - h : zero;
          const rr = Math.min(4, h, bw / 2);
          const d =
            b.amount >= 0
              ? `M${x},${zero} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + bw - rr} Q${x + bw},${y} ${x + bw},${y + rr} V${zero} Z`
              : `M${x},${zero} V${zero + h - rr} Q${x},${zero + h} ${x + rr},${zero + h} H${x + bw - rr} Q${x + bw},${zero + h} ${x + bw},${zero + h - rr} V${zero} Z`;
          return (
            <g key={i} onClick={() => setTapped(i)}>
              <rect x={cx - slot / 2} y="0" width={slot} height={H} fill="transparent" />
              {b.missing ? (
                <rect x={x} y={zero - 22} width={bw} height="22" rx="4" class="bar-missing" />
              ) : (
                h > 0 && <path d={d} fill={i === props.current ? props.color : props.soft} />
              )}
              {!b.missing && b.amount !== 0 && (
                <text x={cx} y={b.amount >= 0 ? y - 4 : zero + h + 11} text-anchor="middle" class={`bar-value ${i === props.current ? 'on' : ''}`}>
                  {shortMoney(b.amount)}
                </text>
              )}
              <text x={cx} y={H - 4} text-anchor="middle" class={`axis-label ${i === shown ? 'on' : ''}`}>
                {b.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/**
 * Income next to what left the liquid money for each period: income, and beside it spending with the savings
 * stacked on top in their own color (savings still aren't spending, they're shown apart). Tap a period for the amounts.
 */
export function PairBars(props: { bars: { label: string; income: number; expenses: number; saved: number; missing?: boolean }[]; current: number }) {
  const [tapped, setTapped] = useState<number | null>(null);
  useEffect(() => setTapped(null), [props.bars.map(b => b.label).join()]);
  const n = props.bars.length;
  if (!n || props.bars.every(b => !b.income && !b.expenses && !b.saved)) return <p class="muted small">אין עדיין נתונים</p>;
  const max = Math.max(1, ...props.bars.flatMap(b => [b.income, b.expenses + b.saved]));
  const zero = BOTTOM;
  const scale = (BOTTOM - TOP - 4) / max;
  const slot = W / n;
  const bw = Math.min(16, (slot - 8) / 2);
  const shown = tapped ?? (props.current >= 0 ? props.current : n - 1);
  const s = props.bars[shown];
  // A bar from `base` up `h`; only the piece at the top gets rounded corners
  const bar = (x: number, h: number, color: string, base = zero, top = true) => {
    if (h <= 0) return null;
    const rr = top ? Math.min(3, h, bw / 2) : 0;
    const y = base - h;
    return <path d={`M${x},${base} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + bw - rr} Q${x + bw},${y} ${x + bw},${y + rr} V${base} Z`} fill={color} />;
  };
  return (
    <div>
      <div class="chart-legend">
        <span>
          <span class="swatch" style={{ background: 'var(--pos)' }} /> הכנסות
        </span>
        <span>
          <span class="swatch" style={{ background: 'var(--neg)' }} /> הוצאות
        </span>
        <span>
          <span class="swatch" style={{ background: 'var(--sav)' }} /> חיסכון
        </span>
      </div>
      <p class="chart-readout">
        {s &&
          (s.missing ? (
            <>
              <b>{s.label}:</b> <span class="muted">אין נתונים, עוד לא רשמת אז באפליקציה</span>
            </>
          ) : (
            <>
              <b>{s.label}:</b> הכנסות {formatMoney(s.income)} · הוצאות {formatMoney(s.expenses)}
              {s.saved > 0 && <> · חיסכון {formatMoney(s.saved)}</>}
            </>
          ))}
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} class="chart" role="img" aria-label="הכנסות מול הוצאות לכל תקופה">
        <line x1="0" x2={W} y1={zero} y2={zero} class="baseline" />
        {props.bars.map((b, i) => {
          const cx = W - slot * i - slot / 2;
          const dim = props.current >= 0 && i !== props.current && i !== tapped;
          return (
            <g key={i} onClick={() => setTapped(i)} opacity={dim ? 0.45 : 1}>
              <rect x={cx - slot / 2} y="0" width={slot} height={H} fill="transparent" />
              {b.missing ? (
                <rect x={cx - bw - 1} y={zero - 22} width={bw * 2 + 2} height="22" rx="4" class="bar-missing" />
              ) : (
                <>
                  {/* income on the right, spending on the left, as the text reads */}
                  {bar(cx + 1, b.income * scale, 'var(--pos)')}
                  {/* what left the liquid money: spending, and savings on top of it in its own color */}
                  {bar(cx - bw - 1, b.expenses * scale, 'var(--neg)', zero, !b.saved)}
                  {bar(cx - bw - 1, b.saved * scale, 'var(--sav)', zero - b.expenses * scale)}
                </>
              )}
              <text x={cx} y={H - 4} text-anchor="middle" class={`axis-label ${i === shown ? 'on' : ''}`}>
                {b.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** An amount small enough to sit over a bar: 9,149 → "9.1K", 640 → "640". */
const shortMoney = (agorot: number) => {
  const v = Math.abs(agorot) / 100;
  const t = v >= 10_000 ? `${Math.round(v / 1000)}K` : v >= 1000 ? `${Math.round(v / 100) / 10}K` : String(Math.round(v));
  return agorot < 0 ? `-${t}` : t;
};

/** Parts of a whole as bars: each with its amount and share; tapping "other" opens what it holds. */
function SliceBars(props: { slices: Slice[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const total = props.slices.reduce((s, x) => s + x.amount, 0);
  const max = Math.max(1, ...props.slices.map(s => s.amount));
  return (
    <div class="hbars">
      {props.slices.map(s => (
        <div key={s.key}>
          <button class="hbar" onClick={() => setOpen(open === s.key ? null : s.key)}>
            <span class="hbar-label">{s.label}</span>
            <span class="hbar-track">
              <span style={{ width: `${(s.amount / max) * 100}%`, background: s.color }} />
            </span>
            <span class="hbar-value">
              {formatMoney(s.amount)}
              <span class="muted small block">{pct(s.amount, total)}</span>
            </span>
          </button>
          {open === s.key && s.inside && (
            <div class="pie-inside">
              {s.inside.map(i => (
                <div key={i.label} class="line small">
                  <span>{i.label}</span>
                  <span>{formatMoney(i.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export type PartsMode = 'pie' | 'bars';
const modeKey = (id: string) => `dash-parts-${id}`;
function savedMode(id: string): PartsMode {
  try {
    return localStorage.getItem(modeKey(id)) === 'bars' ? 'bars' : 'pie';
  } catch {
    return 'pie';
  }
}

/**
 * Parts of a whole (where the money goes, how it was paid, where income came from), as a pie or as bars:
 * a switch in the corner, remembered for each part of the page on its own.
 */
export function Parts(props: { id: string; slices: Slice[]; centerLabel: string; centerValue: string; centerNote?: string }) {
  const [mode, setMode] = useState<PartsMode>(() => savedMode(props.id));
  const choose = (m: PartsMode) => {
    setMode(m);
    try {
      localStorage.setItem(modeKey(props.id), m);
    } catch {
      // private browsing: just for now
    }
  };
  return (
    <div class="parts">
      <div class="parts-toggle" role="group" aria-label="איך להציג">
        <button class={mode === 'pie' ? 'on' : ''} aria-label="עוגה" aria-pressed={mode === 'pie'} onClick={() => choose('pie')}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="8" />
            <path d="M12 4v8l6 5" />
          </svg>
        </button>
        <button class={mode === 'bars' ? 'on' : ''} aria-label="עמודות" aria-pressed={mode === 'bars'} onClick={() => choose('bars')}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 6H8" />
            <path d="M20 12H4" />
            <path d="M20 18h-9" />
          </svg>
        </button>
      </div>
      {mode === 'pie' ? (
        <Pie slices={props.slices} centerLabel={props.centerLabel} centerValue={props.centerValue} centerNote={props.centerNote} />
      ) : (
        <>
          <p class="chart-readout">
            <b>{props.centerLabel}:</b> {props.centerValue}
            {props.centerNote && <span class="muted"> {props.centerNote}</span>}
          </p>
          <SliceBars slices={props.slices} />
        </>
      )}
    </div>
  );
}

const dd = (s: string) => {
  const { m0, d } = parseDate(s);
  return `${d}.${m0 + 1}`;
};
const LH = 170;
const LB = 150;

export const ZOOMS: [number, string][] = [
  [7, 'שבוע'],
  [30, 'חודש'],
  [91, '3 חודשים'],
  [365, 'שנה'],
];

/**
 * A line of the money day by day, like a share's chart: zoom with the buttons or two fingers, drag sideways
 * to move in time (dragging left goes back, as the older days are on the right), tap for a day's amount.
 */
export function MoneyLine(props: { days: { date: string; amount: number }[] }) {
  const all = props.days;
  const last = all.length - 1;
  const [span, setSpan] = useState(30);
  const [end, setEnd] = useState(last);
  const [tap, setTap] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, number>());
  const gesture = useRef<{ x: number; end: number; moved: boolean; pinch?: { dist: number; span: number } } | null>(null);
  useEffect(() => setEnd(last), [last]);

  const maxSpan = Math.max(7, all.length);
  const s = Math.min(span, maxSpan);
  const e = Math.min(last, Math.max(Math.min(last, s - 1), end));
  const a = Math.max(0, e - s + 1);
  const shown = all.slice(a, e + 1);
  if (!shown.length) return <p class="muted small">אין עדיין נתונים</p>;
  const hi = Math.max(...shown.map(d => d.amount));
  const lo = Math.min(...shown.map(d => d.amount));
  const pad = Math.max(1, (hi - lo) * 0.12);
  const top = hi + pad;
  const bot = lo - pad;
  const y = (v: number) => 8 + ((top - v) / (top - bot)) * (LB - 8);
  const step = s > 1 ? W / (s - 1) : 0;
  // the newest on the left: day i sits (e − i) steps from the left edge
  const x = (i: number) => (e - i) * step;
  const pts = shown.map((d, j) => `${x(a + j).toFixed(1)},${y(d.amount).toFixed(1)}`);
  const line = `M${pts.join(' L')}`;
  const area = `${line} L${x(e).toFixed(1)},${LB} L${x(a).toFixed(1)},${LB} Z`;
  const t = tap !== null && tap >= a && tap <= e ? tap : null;
  const ticks = 4;
  const tickIdx = Array.from({ length: ticks }, (_, k) => Math.round(e - ((s - 1) * k) / (ticks - 1))).filter(i => i >= a);

  const indexAt = (clientX: number) => {
    const rect = box.current!.getBoundingClientRect();
    const fx = ((clientX - rect.left) / rect.width) * W;
    return Math.max(a, Math.min(e, Math.round(e - fx / (step || 1))));
  };
  const pinchDist = () => {
    const xs = [...pointers.current.values()];
    return Math.abs(xs[0] - xs[1]) || 1;
  };

  return (
    <div class="money-line">
      <p class="chart-readout">
        {t !== null ? (
          <>
            <b>{dd(all[t].date)}:</b> {formatMoney(all[t].amount)}
          </>
        ) : (
          <>
            ב־{dd(shown[0].date)}: {formatMoney(shown[0].amount)} · ב־{dd(shown[shown.length - 1].date)}: {formatMoney(shown[shown.length - 1].amount)}
          </>
        )}
      </p>
      <div
        ref={box}
        class="money-line-box no-tab-swipe"
        onPointerDown={ev => {
          (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
          pointers.current.set(ev.pointerId, ev.clientX);
          if (pointers.current.size === 2) gesture.current = { x: 0, end: e, moved: true, pinch: { dist: pinchDist(), span: s } };
          else gesture.current = { x: ev.clientX, end: e, moved: false };
        }}
        onPointerMove={ev => {
          const g = gesture.current;
          if (!g || !pointers.current.has(ev.pointerId)) return;
          pointers.current.set(ev.pointerId, ev.clientX);
          if (g.pinch && pointers.current.size === 2) {
            // fingers apart: fewer days (closer in); together: more days
            setSpan(Math.round(Math.max(7, Math.min(maxSpan, (g.pinch.span * g.pinch.dist) / pinchDist()))));
            return;
          }
          const dx = ev.clientX - g.x;
          if (!g.moved && Math.abs(dx) < 6) return;
          g.moved = true;
          const days = Math.round((dx / box.current!.clientWidth) * s);
          // dragging right brings in the newer days on the left, dragging left the older ones
          setEnd(Math.min(last, Math.max(s - 1, g.end + days)));
        }}
        onPointerUp={ev => {
          const g = gesture.current;
          pointers.current.delete(ev.pointerId);
          if (g && !g.moved) setTap(indexAt(ev.clientX));
          if (!pointers.current.size) gesture.current = null;
        }}
        onPointerCancel={ev => {
          pointers.current.delete(ev.pointerId);
          if (!pointers.current.size) gesture.current = null;
        }}
      >
        <svg viewBox={`0 0 ${W} ${LH}`} class="chart" role="img" aria-label="הכסף הנזיל יום אחרי יום">
          {[0, 0.5, 1].map(f => {
            const v = top - (top - bot) * f;
            const yy = y(v);
            return (
              <g key={f}>
                <line x1="0" x2={W} y1={yy} y2={yy} class="gridline" />
                <text x={W} y={yy - 3} text-anchor="end" class="axis-label">
                  {formatMoney(Math.round(v / 100) * 100)}
                </text>
              </g>
            );
          })}
          <path d={area} class="money-line-area" />
          <path d={line} class="money-line-path" />
          {t !== null && (
            <>
              <line x1={x(t)} x2={x(t)} y1="8" y2={LB} class="gridline strong" />
              <circle cx={x(t)} cy={y(all[t].amount)} r="4.5" class="money-line-dot" />
            </>
          )}
          {t === null && e === last && <circle cx={x(e)} cy={y(all[e].amount)} r="4" class="money-line-dot" />}
          {tickIdx.map((i, k) => (
            <text key={i} x={x(i)} y={LH - 3} text-anchor={k === 0 ? 'start' : k === tickIdx.length - 1 ? 'end' : 'middle'} class="axis-label">
              {dd(all[i].date)}
            </text>
          ))}
        </svg>
      </div>
      <div class="zoom-chips">
        {ZOOMS.map(([z, label]) => (
          <button
            key={z}
            class={`chip ${s === Math.min(z, maxSpan) && span === z ? 'on' : ''}`}
            onClick={() => {
              setSpan(z);
              setTap(null);
            }}
          >
            {label}
          </button>
        ))}
        {e < last && (
          <button class="chip" onClick={() => setEnd(last)}>
            להיום
          </button>
        )}
      </div>
    </div>
  );
}

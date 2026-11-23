import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { MoneyLine, PairBars, Parts, PeriodBars, type Slice } from '../components/dashCharts';
import { Segmented } from '../components/inputs';
import { statsTransactions } from '../data/budget';
import { categoryColor } from '../data/colors';
import { BARS, cut, daysBetween, liquidByDay, periodOf, periodStats, YEAR_AGO, type Period, type PeriodKind } from '../data/dash';
import { parseDate, todayStr } from '../data/dates';
import { formatMoney } from '../data/money';
import type { AppData } from '../data/store';

// The dashboard: a picture of the money right now, facts only (no advice). One page, a period chosen at the
// top for everything on it, and a strip on the side to jump between its parts. The liquid money line has
// its own zoom.

const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const SHORT = ['ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני', 'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳'];
/** The periods to choose from at the top; "all" is everything since the app was first used. */
type View = PeriodKind | 'all';
const KINDS: [View, string][] = [
  ['week', 'שבוע'],
  ['month', 'חודש'],
  ['quarter', '3 חודשים'],
  ['year', 'שנה'],
  ['all', 'מההתחלה'],
];
const UNIT_MANY: Record<PeriodKind, string> = { week: 'שבועות', month: 'חודשים', quarter: 'רבעונים', year: 'שנים' };
const UNIT: Record<PeriodKind, string> = { week: 'שבוע', month: 'חודש', quarter: '3 חודשים', year: 'שנה' };
const THIS: Record<PeriodKind, string> = { week: 'השבוע', month: 'החודש', quarter: '3 החודשים האלה', year: 'השנה' };
const BEFORE: Record<PeriodKind, string> = { week: 'שבוע קודם', month: 'חודש קודם', quarter: '3 החודשים הקודמים', year: 'שנה קודמת' };

const dd = (s: string) => {
  const { m0, d } = parseDate(s);
  return `${d}.${m0 + 1}`;
};

/** Kept while the app is open: coming back to the tab finds the same period. */
const kept: { view: View; k: number } = { view: 'month', k: 0 };

const SECTIONS: { id: string; label: string; icon: ComponentChildren }[] = [
  { id: 'where', label: 'לאן הכסף הולך', icon: <><circle cx="12" cy="12" r="8" /><path d="M12 4v8l6 5" /></> },
  { id: 'fixed', label: 'קבוע מול יום־יום', icon: <><path d="M4 12a8 8 0 0 1 14-5" /><path d="M20 12a8 8 0 0 1-14 5" /><path d="M18 3v4h-4" /><path d="M6 21v-4h4" /></> },
  { id: 'methods', label: 'אמצעי תשלום', icon: <><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M3 10h18" /></> },
  { id: 'spending', label: 'הוצאות לאורך זמן', icon: <><path d="M5 20V11" /><path d="M12 20V5" /><path d="M19 20v-6" /></> },
  { id: 'income', label: 'הכנסות', icon: <><rect x="3" y="6" width="18" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /></> },
  { id: 'versus', label: 'הכנסות מול הוצאות', icon: <><path d="M6 20V9" /><path d="M10 20V4" /><path d="M15 20v-8" /><path d="M19 20v-5" /></> },
  { id: 'liquid', label: 'הכסף הנזיל', icon: <><path d="M3 17l6-6 4 4 8-8" /><path d="M15 7h6v6" /></> },
  { id: 'unknown', label: 'כסף לא מזוהה', icon: <><circle cx="12" cy="12" r="8" /><path d="M10 9.5a2.2 2.2 0 1 1 3 2c-.7.3-1 .8-1 1.5" /><path d="M12 16.5v.01" /></> },
  { id: 'compare', label: 'השוואות', icon: <><path d="M7 4v16" /><path d="M17 4v16" /><path d="M4 8h6" /><path d="M14 16h6" /></> },
];

export function Dashboard(props: { data: AppData }) {
  const { data } = props;
  const today = todayStr();
  const startDay = data.monthStartDay;
  const [view, setView] = useState<View>(kept.view);
  const [k, setK] = useState(kept.k);
  const [onSection, setOnSection] = useState(SECTIONS[0].id);
  kept.view = view;
  kept.k = k;
  const all = view === 'all';
  // Since the start: bars of months (or of years, once there are more than twelve months)
  const kind: PeriodKind = all ? (periodOf('month', -12, today, startDay).to >= data.startDate ? 'year' : 'month') : view;

  const txs = useMemo(() => statsTransactions(data), [data]);
  const liquid = useMemo(() => liquidByDay(data, today), [data, today]);
  const p = all ? { from: data.startDate, to: today } : periodOf(kind, k, today, startDay);
  const running = p.to > today;
  const shownTo = running ? today : p.to;
  const stats = periodStats(data, { from: p.from, to: shownTo }, txs);
  const hasData = (q: Period) => q.to >= data.startDate;
  const canBack = !all && hasData(periodOf(kind, k - 1, today, startDay));

  const title = (q: Period) => {
    const a = parseDate(q.from);
    const b = parseDate(q.to);
    if (all) return 'מאז שהתחלת';
    if (kind === 'week') return a.m0 === b.m0 ? `${a.d}–${b.d} ב${MONTHS[a.m0]}` : `${dd(q.from)}–${dd(q.to)}`;
    if (kind === 'month') return startDay === 1 ? `${MONTHS[a.m0]} ${a.y}` : `${dd(q.from)}–${dd(q.to)}`;
    if (kind === 'quarter') return `${SHORT[a.m0]}–${SHORT[(b.m0 + (startDay === 1 ? 0 : 11)) % 12]} ${b.y}`;
    return String(a.y);
  };
  const short = (q: Period) => {
    const a = parseDate(q.from);
    if (kind === 'week') return dd(q.from);
    if (kind === 'month') return SHORT[a.m0];
    if (kind === 'quarter') return `${SHORT[a.m0]}–${SHORT[(a.m0 + 2) % 12]}`;
    return String(a.y);
  };

  // "Over time": this period and the ones of the same length before it, oldest first. Every slot is drawn,
  // the ones from before the app was used as empty places, so it's clear what each bar stands for.
  const series = useMemo(() => {
    const list: { q: Period; s?: ReturnType<typeof periodStats> }[] = [];
    let first = k - BARS[kind] + 1;
    if (all) {
      first = 0;
      while (hasData(periodOf(kind, first - 1, today, startDay))) first--;
    }
    for (let j = first; j <= k; j++) {
      const q = periodOf(kind, j, today, startDay);
      list.push({ q, s: hasData(q) ? periodStats(data, { from: q.from, to: q.to < today ? q.to : today }, txs) : undefined });
    }
    return list;
  }, [data, txs, kind, all, k, today]);
  const bars = (pick: (s: ReturnType<typeof periodStats>) => number) =>
    series.map(x => ({ label: short(x.q), amount: x.s ? pick(x.s) : 0, missing: !x.s, running: x.q.to > today, partial: !!x.s && x.q.from < data.startDate }));
  const barsSub = all
    ? `כל ה${UNIT_MANY[kind]} מאז שהתחלת.`
    : `${BARS[kind]} ${UNIT_MANY[kind]} אחרונים. הכהה: התקופה שבחרת.`;
  // Since the start there's no one chosen bar: all of them strong
  const chosen = all ? -1 : series.length - 1;

  // Where the money went: spending by category, savings as a slice of its own; small ones fold into "other"
  const catName = (id: string) => data.categories.find(c => c.id === id)?.name ?? 'ללא קטגוריה';
  const slices = useMemo(() => {
    const parts: Slice[] = stats.byCategory.map(c => ({ key: c.categoryId, label: catName(c.categoryId), amount: c.amount, color: categoryColor(c.categoryId, data.categories) }));
    if (stats.saved > 0) parts.push({ key: 'saved', label: 'חיסכון', amount: stats.saved, color: 'var(--sav)' });
    return fold(parts, 'saved');
  }, [stats]);
  // How it was paid: each method keeps its color, by its place in the list of methods and money sources
  const methodSlices = useMemo(() => {
    const names = [...[...data.methods].sort((a, b) => a.order - b.order).map(m => m.name), ...data.accounts.map(a => a.name), 'אחר'];
    return fold(stats.byMethod.map(m => ({ key: m.name, label: m.name, amount: m.amount, color: `var(--series-${(Math.max(0, names.indexOf(m.name)) % 7) + 1})` })));
  }, [stats]);
  const incomeSlices = useMemo(
    () => fold(stats.incomeByCategory.map(c => ({ key: c.categoryId, label: catName(c.categoryId), amount: c.amount, color: categoryColor(c.categoryId, data.categories) }))),
    [stats],
  );

  // Comparisons: each one up to the same point as this period when it isn't over yet
  const days = running ? daysBetween(p.from, today) : undefined;
  const compared = (j: number) => {
    const q = cut(periodOf(kind, j, today, startDay), days);
    return hasData(q) ? { s: periodStats(data, q, txs), partial: q.from < data.startDate } : undefined;
  };
  const prevs = [1, 2, 3].map(j => compared(k - j));

  // The strip on the side: tap or slide along it to jump to a part
  const jump = (id: string) => {
    setOnSection(id);
    const el = document.getElementById(`dash-${id}`);
    if (el) glideTo(el);
  };
  const rail = useRef<HTMLDivElement>(null);
  const railTouch = useRef<{ y: number; sliding: boolean } | null>(null);
  const slideTo = (y: number) => {
    const r = rail.current?.getBoundingClientRect();
    if (!r) return;
    const i = Math.max(0, Math.min(SECTIONS.length - 1, Math.floor(((y - r.top) / r.height) * SECTIONS.length)));
    if (SECTIONS[i].id !== onSection) {
      setOnSection(SECTIONS[i].id);
      document.getElementById(`dash-${SECTIONS[i].id}`)?.scrollIntoView({ block: 'start' });
    }
  };
  // Following the scroll: the part at the top of the screen lights up on the strip
  useEffect(() => {
    const onScroll = () => {
      let at = SECTIONS[0].id;
      for (const s of SECTIONS) {
        const el = document.getElementById(`dash-${s.id}`);
        if (el && el.getBoundingClientRect().top < 160) at = s.id;
      }
      setOnSection(at);
    };
    addEventListener('scroll', onScroll, { passive: true });
    return () => removeEventListener('scroll', onScroll);
  }, []);


  if (!data.transactions.length) {
    return (
      <div class="dashboard">
        <div class="top">
          <h1>דשבורד</h1>
        </div>
        <div class="card note">
          <p>כאן תראה לאן הכסף שלך הולך, ברגע שיהיו כמה פעולות רשומות.</p>
        </div>
      </div>
    );
  }

  const fixedShare = stats.expenses ? Math.round((stats.fixed / stats.expenses) * 100) : 0;

  return (
    <div class="dashboard">
      <div class="dash-head">
        <div class="top">
          <h1>דשבורד</h1>
        </div>
        <div class="period-pick">
          <Segmented
            options={KINDS}
            value={view}
            onChange={v => {
              setView(v);
              setK(0);
            }}
          />
        </div>
        <div class="dash-nav">
          <button class="chip" aria-label="התקופה הקודמת" disabled={!canBack} onClick={() => setK(k - 1)}>
            ›
          </button>
          <div class="center">
            <strong>{title(p)}</strong>
            <div class="muted small">{running ? `${dd(p.from)}–${dd(today)} (עד היום)` : `${dd(p.from)}–${dd(p.to)}`}</div>
          </div>
          <button class="chip" aria-label="התקופה הבאה" disabled={all || k >= 0} onClick={() => setK(k + 1)}>
            ‹
          </button>
        </div>
      </div>

      <div class="dash-body">
        <div class="dash-main">
          <div class="stat-row">
            <div class="stat">
              <div class="muted small">הכנסות</div>
              <div class="stat-value inc">{formatMoney(stats.income)}</div>
            </div>
            <div class="stat">
              <div class="muted small">הוצאות</div>
              <div class="stat-value">{formatMoney(stats.expenses)}</div>
            </div>
            <div class="stat sav-panel">
              <div class="muted small">חיסכון</div>
              <div class="stat-value sav">{formatMoney(stats.saved)}</div>
            </div>
          </div>

          <Section id="where" title="לאן הכסף הולך" sub="ההוצאות והחיסכון של התקופה, לפי סוג. לחיצה על חלק מראה את הסכום.">
            {slices.length ? (
              <Parts id="where" slices={slices} centerLabel='סה"כ הוצאות' centerValue={formatMoney(stats.expenses)} centerNote={stats.saved ? `+ ${formatMoney(stats.saved)} לחיסכון` : undefined} />
            ) : (
              <p class="muted small">לא נרשמו הוצאות בתקופה הזו</p>
            )}
          </Section>

          <Section id="fixed" title="קבוע מול יום־יום" sub="הוראות קבע והוצאות קבועות, מול כל השאר">
            {stats.expenses ? (
              <>
                <div class="stack fixed-stack">
                  {stats.fixed > 0 && <span style={{ width: `${fixedShare}%`, background: 'var(--series-7)' }} />}
                  {stats.expenses > stats.fixed && <span style={{ flex: 1, background: 'var(--series-3)' }} />}
                </div>
                <div class="legend">
                  <div class="legend-row">
                    <span class="swatch" style={{ background: 'var(--series-7)' }} />
                    <span class="legend-name">קבוע {fixedShare}%</span>
                    <span>{formatMoney(stats.fixed)}</span>
                  </div>
                  <div class="legend-row">
                    <span class="swatch" style={{ background: 'var(--series-3)' }} />
                    <span class="legend-name">יום־יום {100 - fixedShare}%</span>
                    <span>{formatMoney(stats.expenses - stats.fixed)}</span>
                  </div>
                </div>
              </>
            ) : (
              <p class="muted small">לא נרשמו הוצאות בתקופה הזו</p>
            )}
          </Section>

          <Section id="methods" title="אמצעי תשלום" sub="כמה יצא מכל כרטיס, מהבנק ובמזומן, לפי יום הקנייה">
            {methodSlices.length ? (
              <Parts id="methods" slices={methodSlices} centerLabel='סה"כ הוצאות' centerValue={formatMoney(stats.expenses)} />
            ) : (
              <p class="muted small">לא נרשמו הוצאות בתקופה הזו</p>
            )}
          </Section>

          <Section id="spending" title="הוצאות לאורך זמן" sub={barsSub}>
            <PeriodBars bars={bars(s => s.expenses)} current={chosen} color="var(--neg)" soft={all ? 'var(--neg)' : 'var(--exp-soft-strong)'} />
          </Section>

          <Section id="income" title="הכנסות" sub={`מאיפה הגיע הכסף בתקופה שבחרת. למטה: ${barsSub}`}>
            {incomeSlices.length ? (
              <Parts id="income" slices={incomeSlices} centerLabel='סה"כ הכנסות' centerValue={formatMoney(stats.income)} />
            ) : (
              <p class="muted small">לא נרשמו הכנסות בתקופה הזו</p>
            )}
            <PeriodBars bars={bars(s => s.income)} current={chosen} color="var(--pos)" soft={all ? 'var(--pos)' : 'var(--inc-soft-strong)'} />
          </Section>

          <Section id="versus" title="הכנסות מול הוצאות" sub={`מה נכנס, ומה יצא מהכסף הנזיל: ההוצאות, ומעליהן החיסכון בכתום. ${barsSub}`}>
            <PairBars bars={series.map(x => ({ label: short(x.q), income: x.s?.income ?? 0, expenses: x.s?.expenses ?? 0, saved: x.s?.saved ?? 0, missing: !x.s }))} current={chosen} />
          </Section>

          <Section id="liquid" title="הכסף הנזיל" sub="כמו בדף הבית, יום אחרי יום. צבוט לזום, גרור לזוז בזמן.">
            <div class="liquid-now">
              <strong>{formatMoney(liquid[liquid.length - 1]?.amount ?? 0)}</strong> <span class="muted small">היום</span>
            </div>
            <MoneyLine days={liquid} />
          </Section>

          <Section id="unknown" title="כסף לא מזוהה" sub={`כמה נרשם כ"לא מזוהה" בבדיקות, בכל ${UNIT[kind]} בפני עצמו (לא מצטבר)`}>
            <PeriodBars bars={bars(s => s.unknown)} current={chosen} color="var(--series-other-strong)" soft={all ? 'var(--series-other-strong)' : 'var(--series-other)'} empty='לא נרשם כסף "לא מזוהה" בתקופות האלה' />
          </Section>

          <Section id="compare" title="השוואות" sub={all ? 'בתצוגה "מההתחלה" אין תקופה קודמת להשוות אליה. בחר שבוע, חודש, 3 חודשים או שנה.' : days !== undefined ? `כולן עד אותה נקודה: ${days + 1} הימים הראשונים של כל ${UNIT[kind]}` : 'תקופות שלמות באותו אורך'}>
            {!all && <div class="dash-cmp">
              <div class="dash-cmp-row head">
                <span />
                <span>הכנסות</span>
                <span>הוצאות</span>
              </div>
              <CompareRow name={k === 0 ? THIS[kind] : title(p)} s={stats} bold />
              <CompareRow name={BEFORE[kind]} s={prevs[0]?.s} partial={prevs[0]?.partial} />
              {prevs.every(x => x) ? (
                <CompareRow
                  name="ממוצע 3 קודמים"
                  s={{ income: prevs.reduce((a, x) => a + x!.s.income, 0) / 3, expenses: prevs.reduce((a, x) => a + x!.s.expenses, 0) / 3 }}
                  partial={prevs.some(x => x!.partial)}
                />
              ) : (
                <CompareRow name="ממוצע 3 קודמים" />
              )}
              {kind !== 'year' && (() => {
                const y = compared(k + YEAR_AGO[kind]);
                return <CompareRow name="אותה תקופה אשתקד" s={y?.s} partial={y?.partial} />;
              })()}
            </div>}
          </Section>
        </div>

        <nav
          ref={rail}
          class="dash-rail no-tab-swipe"
          aria-label="קפיצה לחלק בדף"
          onTouchStart={e => (railTouch.current = { y: e.touches[0].clientY, sliding: false })}
          onTouchMove={e => {
            const t = railTouch.current;
            if (!t) return;
            e.preventDefault();
            // A tap glides there (the click); only a real slide along the strip jumps from part to part
            if (!t.sliding && Math.abs(e.touches[0].clientY - t.y) < 10) return;
            t.sliding = true;
            slideTo(e.touches[0].clientY);
          }}
          onTouchEnd={() => (railTouch.current = null)}
        >
          {SECTIONS.map(s => (
            <button key={s.id} class={onSection === s.id ? 'on' : ''} aria-label={s.label} onClick={() => jump(s.id)}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                {s.icon}
              </svg>
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}

/** Biggest first; parts under 4% fold into one "other" that opens to show them (`keep` never folds). */
function fold(parts: Slice[], keep?: string): Slice[] {
  const sorted = [...parts].sort((a, b) => b.amount - a.amount);
  const total = sorted.reduce((a, s) => a + s.amount, 0);
  const big = sorted.filter(s => s.key === keep || s.amount / total >= 0.04);
  const small = sorted.filter(s => !big.includes(s));
  if (small.length === 1) big.push(small[0]);
  else if (small.length)
    big.push({ key: 'other', label: 'אחר', amount: small.reduce((a, s) => a + s.amount, 0), color: 'var(--series-other)', inside: small.map(s => ({ label: s.label, amount: s.amount })) });
  return big;
}

/** Scrolls the page down (or up) to a part smoothly, so it's clear it's the same page, a little further on. */
let gliding = 0;
function glideTo(el: HTMLElement) {
  const margin = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
  const from = scrollY;
  const to = Math.max(0, Math.min(document.documentElement.scrollHeight - innerHeight, from + el.getBoundingClientRect().top - margin));
  const ms = Math.min(700, 300 + Math.abs(to - from) / 6);
  const start = performance.now();
  const id = ++gliding;
  const step = (now: number) => {
    if (id !== gliding) return;
    const f = Math.min(1, (now - start) / ms);
    const ease = f < 0.5 ? 2 * f * f : 1 - (-2 * f + 2) ** 2 / 2;
    scrollTo(0, from + (to - from) * ease);
    if (f < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** One part of the page, with an id the strip on the side jumps to. Top level, so its charts keep their state. */
function Section(s: { id: string; title: string; sub: string; children: ComponentChildren }) {
  return (
    <section id={`dash-${s.id}`} class="dash-section">
      <h2>{s.title}</h2>
      <p class="muted small dash-sub">{s.sub}</p>
      {s.children}
    </section>
  );
}

function CompareRow(props: { name: string; s?: { income: number; expenses: number }; bold?: boolean; partial?: boolean }) {
  return (
    <div class={`dash-cmp-row ${props.bold ? 'bold' : ''}`}>
      <span>
        {props.name}
        {props.partial && <span class="muted small"> (חלקי)</span>}
      </span>
      {props.s ? (
        <>
          <span>{formatMoney(Math.round(props.s.income / 100) * 100)}</span>
          <span>{formatMoney(Math.round(props.s.expenses / 100) * 100)}</span>
        </>
      ) : (
        <span class="muted small compare-none">אין עדיין נתונים</span>
      )}
    </div>
  );
}

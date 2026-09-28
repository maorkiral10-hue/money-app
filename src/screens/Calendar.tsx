import { useEffect, useRef, useState } from 'preact/hooks';
import { MoneyInput, Segmented } from '../components/inputs';
import { eventTotals, monthGrid, monthStart, periodRange, shiftPeriod, WEEKDAYS, weekStart, ZOOMS, type Zoom } from '../data/calendar';
import { addDays, dayLabel, parseDate, todayStr, ymd } from '../data/dates';
import { deleteRecord, putRecords } from '../data/db';
import { formatMoney } from '../data/money';
import type { AppData } from '../data/store';
import type { CalendarEvent } from '../data/types';

const MONTH_NAMES = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const ZOOM_NAMES: Record<Zoom, string> = { year: 'שנה', month: 'חודש', week: 'שבוע' };
const shortDate = (s: string) => {
  const { m0, d } = parseDate(s);
  return `${d}.${m0 + 1}`;
};

/** Where the calendar was left, so coming back from an event keeps the same view. */
let lastView: { zoom: Zoom; selected: string } | null = null;

/** Green for money coming in, red for going out, grey for an event with no money. */
const dotClass = (e: CalendarEvent) => (e.type === 'income' ? 'inc' : e.type === 'expense' ? 'exp' : 'none');

function Dots(props: { events: CalendarEvent[] }) {
  if (!props.events.length) return null;
  const kinds = [...new Set(props.events.map(dotClass))];
  return (
    <span class="cal-dots">
      {kinds.map(k => (
        <span key={k} class={`cal-dot ${k}`} />
      ))}
    </span>
  );
}

/**
 * The calendar: a year, a month or a week at a time; pinch in or out with two fingers (or tap the
 * buttons) to change how much shows. Below it, the chosen day's events. Events are for planning only:
 * nothing here touches the balance, the budget or the statement.
 */
export function CalendarScreen(props: { data: AppData; onBack: () => void; onEdit: (event?: CalendarEvent, date?: string) => void }) {
  const today = todayStr();
  const [zoom, setZoom] = useState<Zoom>(lastView?.zoom ?? 'month');
  const [selected, setSelected] = useState(lastView?.selected ?? today);
  const [pinch, setPinch] = useState(1);
  lastView = { zoom, selected };
  const area = useRef<HTMLDivElement>(null);

  const byDate = new Map<string, CalendarEvent[]>();
  for (const e of props.data.events) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);

  // Pinching: fingers apart shows less (year → month → week), together shows more. The day or month
  // between the fingers becomes the one in view.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    let start = 0;
    let last = 0;
    let anchor: string | undefined;
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      start = last = dist(e.touches);
      const x = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const y = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      anchor = (document.elementFromPoint(x, y)?.closest('[data-date]') as HTMLElement | null)?.dataset.date;
    };
    const onMove = (e: TouchEvent) => {
      if (!start || e.touches.length !== 2) return;
      // Keep the phone from zooming the whole page
      e.preventDefault();
      last = dist(e.touches);
      setPinch(Math.min(1.3, Math.max(0.75, last / start)));
    };
    const onEnd = (e: TouchEvent) => {
      if (!start || e.touches.length >= 2) return;
      const ratio = last / start;
      start = 0;
      setPinch(1);
      if (ratio > 1.2 || ratio < 0.83) {
        if (anchor) setSelected(anchor);
        setZoom(z => ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, ZOOMS.indexOf(z) + (ratio > 1 ? 1 : -1)))]);
      }
    };
    const stop = (e: Event) => e.preventDefault();
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    el.addEventListener('gesturestart', stop, { passive: false });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
      el.removeEventListener('gesturestart', stop);
    };
  }, []);

  const [from, to] = periodRange(zoom, selected);
  const totals = eventTotals(props.data.events, from, to);
  const { y, m0 } = parseDate(selected);
  const title = zoom === 'year' ? String(y) : zoom === 'month' ? `${MONTH_NAMES[m0]} ${y}` : `${shortDate(from)} – ${shortDate(to)}`;
  const dayEvents = byDate.get(selected) ?? [];

  const dayCell = (d: string | null, i: number) =>
    d ? (
      <button
        key={d}
        data-date={d}
        class={`cal-day ${d === today ? 'today' : ''} ${d === selected ? 'on' : ''}`}
        onClick={() => setSelected(d)}
      >
        <span>{parseDate(d).d}</span>
        <Dots events={byDate.get(d) ?? []} />
      </button>
    ) : (
      <span key={`blank${i}`} />
    );

  return (
    <>
      <header class="top">
        <h1>לוח זמנים</h1>
        <button class="link" onClick={props.onBack}>
          חזרה
        </button>
      </header>

      <Segmented value={zoom} onChange={setZoom} options={ZOOMS.map(z => [z, ZOOM_NAMES[z]] as [Zoom, string])} />

      <div class="month-switch">
        <button class="link" aria-label="קודם" onClick={() => setSelected(shiftPeriod(zoom, selected, -1))}>
          ›
        </button>
        <span>{title}</span>
        <button class="link" aria-label="הבא" onClick={() => setSelected(shiftPeriod(zoom, selected, 1))}>
          ‹
        </button>
      </div>

      <div class="card cal-area" ref={area}>
        <div style={{ transform: `scale(${pinch})`, transition: pinch === 1 ? 'transform .15s' : 'none' }}>
          {zoom === 'year' && (
            <div class="cal-year">
              {MONTH_NAMES.map((name, i) => {
                const first = ymd(y, i, 1);
                return (
                  <button
                    key={name}
                    data-date={first}
                    class={`cal-mini ${i === m0 ? 'on' : ''}`}
                    onClick={() => {
                      setSelected(monthStart(first) === monthStart(today) ? today : first);
                      setZoom('month');
                    }}
                  >
                    <span class="cal-mini-name">{name}</span>
                    <span class="cal-mini-grid">
                      {monthGrid(first).map((d, j) =>
                        d ? <span key={d} class={`cal-mini-day ${byDate.has(d) ? dotClass(byDate.get(d)![0]) : ''} ${d === today ? 'today' : ''}`} /> : <span key={`b${j}`} />,
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {zoom !== 'year' && (
            <>
              <div class="cal-grid cal-head">
                {WEEKDAYS.map(w => (
                  <span key={w}>{w}</span>
                ))}
              </div>
              <div class={`cal-grid ${zoom === 'week' ? 'week' : ''}`}>
                {(zoom === 'month' ? monthGrid(selected) : Array.from({ length: 7 }, (_, i) => addDays(weekStart(selected), i))).map(dayCell)}
              </div>
            </>
          )}
        </div>
        <p class="muted small center cal-hint">צביטה עם שתי אצבעות: פנימה לשבוע, החוצה לשנה</p>
      </div>

      {(totals.income > 0 || totals.expense > 0) && (
        <div class="cal-totals">
          <span>
            צפוי ב{ZOOM_NAMES[zoom]}:
          </span>
          {totals.income > 0 && <span class="inc">+{formatMoney(totals.income)}</span>}
          {totals.expense > 0 && <span class="exp">−{formatMoney(totals.expense)}</span>}
        </div>
      )}

      {zoom !== 'year' && (
        <div class="card list">
          <h2 class="list-title">{dayLabel(selected, today)}</h2>
          {dayEvents.length === 0 && <p class="muted small">אין אירועים ביום הזה</p>}
          {dayEvents.map(e => (
            <button key={e.id} class="tx" onClick={() => props.onEdit(e)}>
              <div>
                <div>
                  <span class={`cal-dot ${dotClass(e)}`} /> {e.title}
                </div>
                {e.note && <div class="muted small">{e.note}</div>}
              </div>
              {e.type !== 'none' && e.amount > 0 && (
                <div class={e.type === 'income' ? 'inc' : 'exp'}>{formatMoney(e.type === 'income' ? e.amount : -e.amount, { sign: true })}</div>
              )}
            </button>
          ))}
          <button class="secondary" onClick={() => props.onEdit(undefined, selected)}>
            + אירוע ב-{shortDate(selected)}
          </button>
        </div>
      )}
      <p class="muted small center">הסכומים כאן לתכנון בלבד. הם לא משנים את היתרה, התקציב או עובר ושב.</p>
    </>
  );
}

/** A new calendar event, or editing one. */
export function EventForm(props: { db: IDBDatabase; event?: CalendarEvent; date?: string; onDone: (date: string) => void; onCancel: () => void }) {
  const e = props.event;
  const [title, setTitle] = useState(e?.title ?? '');
  const [date, setDate] = useState(e?.date ?? props.date ?? todayStr());
  const [type, setType] = useState<CalendarEvent['type']>(e?.type ?? 'expense');
  const [amount, setAmount] = useState(e?.amount ?? 0);
  const [note, setNote] = useState(e?.note ?? '');
  const valid = title.trim() && date;

  const save = async () => {
    if (!valid) return;
    const event: CalendarEvent = {
      id: e?.id ?? crypto.randomUUID(),
      date,
      title: title.trim(),
      type,
      amount: type === 'none' ? 0 : amount,
      note: note.trim() || undefined,
      createdAt: e?.createdAt ?? new Date().toISOString(),
    };
    await putRecords(props.db, 'events', [event]);
    // Back on the calendar, the event's day is the one showing
    lastView = { zoom: lastView?.zoom === 'week' ? 'week' : 'month', selected: date };
    props.onDone(date);
  };
  const remove = async () => {
    if (!e || !confirm(`למחוק את "${e.title}"?`)) return;
    await deleteRecord(props.db, 'events', e.id);
    props.onDone(e.date);
  };

  return (
    <div class="sheet">
      <header class="top">
        <button class="link" onClick={props.onCancel}>
          ביטול
        </button>
        <h1>{e ? 'עריכת אירוע' : 'אירוע חדש'}</h1>
        <span style={{ width: '40px' }} />
      </header>

      <section>
        <h2>מה</h2>
        <input type="text" value={title} placeholder="למשל: חתונה של דני, טסט לרכב, בונוס" onInput={ev => setTitle(ev.currentTarget.value)} />
      </section>

      <section>
        <h2>מתי</h2>
        <input type="date" value={date} onChange={ev => setDate(ev.currentTarget.value)} />
      </section>

      <section>
        <h2>צפי כספי</h2>
        <Segmented
          value={type}
          onChange={setType}
          options={[
            ['expense', 'הוצאה צפויה'],
            ['income', 'הכנסה צפויה'],
            ['none', 'בלי כסף'],
          ]}
        />
        {type !== 'none' && (
          <label class="field">
            <span>בערך כמה</span>
            <MoneyInput value={amount} onChange={setAmount} />
          </label>
        )}
      </section>

      <section>
        <h2>הערה (לא חובה)</h2>
        <input type="text" value={note} onInput={ev => setNote(ev.currentTarget.value)} />
      </section>

      <button disabled={!valid} onClick={save}>
        שמור
      </button>
      {e && (
        <button class="danger" onClick={remove}>
          מחיקת האירוע
        </button>
      )}
    </div>
  );
}

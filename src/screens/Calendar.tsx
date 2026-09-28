import { useEffect, useRef, useState } from 'preact/hooks';
import { MoneyInput, Segmented } from '../components/inputs';
import { dayHours, eventBalance, layoutDay, monthGrid, monthStart, periodRange, shiftPeriod, timeLabel, WEEKDAYS, weekStart, ZOOMS, type Zoom } from '../data/calendar';
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
export function CalendarScreen(props: { data: AppData; onBack: () => void; onEdit: (event?: CalendarEvent, date?: string, time?: string) => void }) {
  const today = todayStr();
  const [zoom, setZoom] = useState<Zoom>(lastView?.zoom ?? 'month');
  const [selected, setSelected] = useState(lastView?.selected ?? today);
  const [pinch, setPinch] = useState(1);
  // A one-finger drag sideways: how far it's gone, and which way the new period slides in
  const [dragX, setDragX] = useState(0);
  const [slide, setSlide] = useState<'next' | 'prev' | null>(null);
  // Changing between year, month and week zooms from the point between the fingers (or the chosen day)
  const [zoomAnim, setZoomAnim] = useState<'in' | 'out' | null>(null);
  const [origin, setOrigin] = useState('50% 40%');
  lastView = { zoom, selected };
  const area = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const go = (by: number) => {
    setZoomAnim(null);
    setSlide(by > 0 ? 'next' : 'prev');
    setSelected(sel => shiftPeriod(zoomRef.current, sel, by));
  };
  const changeZoom = (next: Zoom) => {
    const from = ZOOMS.indexOf(zoomRef.current);
    const to = ZOOMS.indexOf(next);
    if (from === to) return;
    setSlide(null);
    setZoomAnim(to > from ? 'in' : 'out');
    setZoom(next);
  };

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
    // One finger: dragging right brings the next period, left the previous one
    let swipe: { x: number; y: number; dx: number; sideways?: boolean } | null = null;
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        swipe = { x: e.touches[0].clientX, y: e.touches[0].clientY, dx: 0 };
        return;
      }
      swipe = null;
      setDragX(0);
      if (e.touches.length !== 2) return;
      start = last = dist(e.touches);
      const x = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const y = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      anchor = (document.elementFromPoint(x, y)?.closest('[data-date]') as HTMLElement | null)?.dataset.date;
      const box = el.getBoundingClientRect();
      setOrigin(`${Math.round(x - box.left)}px ${Math.round(y - box.top)}px`);
    };
    const onMove = (e: TouchEvent) => {
      if (swipe && e.touches.length === 1) {
        const dx = e.touches[0].clientX - swipe.x;
        const dy = e.touches[0].clientY - swipe.y;
        // Decide once whether this is a sideways drag or ordinary scrolling
        if (swipe.sideways === undefined && Math.hypot(dx, dy) > 10) swipe.sideways = Math.abs(dx) > Math.abs(dy);
        if (swipe.sideways) {
          e.preventDefault();
          swipe.dx = dx;
          setDragX(dx);
        }
        return;
      }
      if (!start || e.touches.length !== 2) return;
      // Keep the phone from zooming the whole page
      e.preventDefault();
      last = dist(e.touches);
      setPinch(Math.min(1.8, Math.max(0.55, last / start)));
    };
    const onEnd = (e: TouchEvent) => {
      if (swipe) {
        const { dx, sideways } = swipe;
        swipe = null;
        setDragX(0);
        if (sideways && Math.abs(dx) > 50) go(dx > 0 ? 1 : -1);
        return;
      }
      if (!start || e.touches.length >= 2) return;
      const ratio = last / start;
      start = 0;
      setPinch(1);
      if (ratio > 1.2 || ratio < 0.83) {
        const next = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoomRef.current) + (ratio > 1 ? 1 : -1)))];
        if (anchor && next !== zoomRef.current) setSelected(anchor);
        changeZoom(next);
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
  const balance = eventBalance(props.data.events, props.data.transactions, from, to);
  const diff = balance.actual - balance.expected;
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

      <button class="secondary cal-add" onClick={() => props.onEdit(undefined, selected)}>
        + אירוע חדש
      </button>

      <Segmented value={zoom} onChange={z => {
          setOrigin('50% 40%');
          changeZoom(z);
        }} options={ZOOMS.map(z => [z, ZOOM_NAMES[z]] as [Zoom, string])} />

      <div class="month-switch">
        <button class="link" aria-label="קודם" onClick={() => go(-1)}>
          ›
        </button>
        <span>{title}</span>
        <button class="link" aria-label="הבא" onClick={() => go(1)}>
          ‹
        </button>
      </div>

      <div class="card cal-area" ref={area}>
        <div
          key={`${zoom}|${from}`}
          class={
            slide === 'next' ? 'enter-from-left' : slide === 'prev' ? 'enter-from-right' : zoomAnim === 'in' ? 'zoom-enter-in' : zoomAnim === 'out' ? 'zoom-enter-out' : ''
          }
          onAnimationEnd={() => {
            setSlide(null);
            setZoomAnim(null);
          }}
          style={{
            transform: `translateX(${dragX}px) scale(${pinch})`,
            transformOrigin: origin,
            // Fades a little the further the pinch goes, and springs back smoothly when let go early
            opacity: pinch === 1 ? 1 : Math.max(0.45, 1 - Math.abs(Math.log(pinch)) * 0.9),
            transition: pinch === 1 && dragX === 0 ? 'transform .28s cubic-bezier(.2,.8,.2,1), opacity .2s' : 'none',
          }}
        >
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
        <p class="muted small center cal-hint">גרירה ימינה או שמאלה: {ZOOM_NAMES[zoom]} הבא או הקודם · צביטה: פנימה לשבוע, החוצה לשנה</p>
      </div>

      {(balance.answered > 0 || balance.openCount > 0) && (
        // The events' own balance: what they were expected to cost or bring in against what they did
        <div class="card cal-balance">
          <h2>מאזן אירועים ב{ZOOM_NAMES[zoom]}</h2>
          {balance.answered > 0 && (
            <>
              <div class="line">
                <span>צפי</span>
                <span class={balance.expected < 0 ? 'exp' : 'inc'}>{formatMoney(balance.expected, { sign: true })}</span>
              </div>
              <div class="line">
                <span>בפועל</span>
                <span class={balance.actual < 0 ? 'exp' : 'inc'}>{formatMoney(balance.actual, { sign: true })}</span>
              </div>
              <div class="line cal-balance-diff">
                <span>{diff > 0 ? 'יצא טוב מהצפי ב־' : diff < 0 ? 'חריגה מהצפי ב־' : 'בדיוק לפי הצפי'}</span>
                {diff !== 0 && <span class={diff > 0 ? 'inc' : 'exp'}>{formatMoney(Math.abs(diff))}</span>}
              </div>
            </>
          )}
          {balance.openCount > 0 && (
            <div class="muted small">
              {balance.answered > 0 ? 'ועוד צפוי: ' : 'צפוי: '}
              <span class={balance.open < 0 ? 'exp' : 'inc'}>{formatMoney(balance.open, { sign: true })}</span>
              {' '}({balance.openCount === 1 ? 'אירוע אחד' : `${balance.openCount} אירועים`} {balance.openCount === 1 ? 'שעוד לא נגמר או לא עודכן' : 'שעוד לא נגמרו או לא עודכנו'})
            </div>
          )}
        </div>
      )}

      {zoom !== 'year' && (
        <DayView data={props.data} date={selected} today={today} events={dayEvents} onEdit={props.onEdit} />
      )}
      <p class="muted small center">הסכומים כאן לתכנון בלבד. הם לא משנים את היתרה, התקציב או עובר ושב.</p>
    </>
  );
}

/** An hour after 'HH:MM' (stopping at 23:59). */
const plusHour = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h >= 23 ? '23:59' : timeLabel((h + 1) * 60 + m);
};

/** Height of one hour on the day's timeline, in pixels. */
const HOUR_HEIGHT = 48;

/** What an event is expected to bring in or cost, and once it's over, what it actually came to. */
function EventMoney(props: { data: AppData; event: CalendarEvent }) {
  const e = props.event;
  if (e.type === 'none') return null;
  const tx = e.settled?.txId ? props.data.transactions.find(t => t.id === e.settled!.txId) : undefined;
  const sign = e.type === 'income' ? 1 : -1;
  return (
    <span class="cal-money">
      {e.amount > 0 && <span class={e.type === 'income' ? 'inc' : 'exp'}>צפי {formatMoney(sign * e.amount, { sign: true })}</span>}
      {e.settled && <span class="muted"> · ✓ {tx ? `בפועל ${formatMoney(sign * tx.amount, { sign: true })}` : 'בלי כסף'}</span>}
    </span>
  );
}

/**
 * One day: events with no time at the top, then the day hour by hour, each timed event as a block as long
 * as it lasts (overlapping ones side by side). Tapping an empty hour starts a new event at that hour.
 */
function DayView(props: {
  data: AppData;
  date: string;
  today: string;
  events: CalendarEvent[];
  onEdit: (event?: CalendarEvent, date?: string, time?: string) => void;
}) {
  const allDay = props.events.filter(e => !e.startTime);
  const timed = layoutDay(props.events);
  const [first, last] = dayHours(timed);
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const showNow = props.date === props.today && nowMinutes >= first * 60 && nowMinutes <= last * 60;
  const y = (minutes: number) => ((minutes - first * 60) / 60) * HOUR_HEIGHT;
  const hours = Array.from({ length: last - first }, (_, i) => first + i);

  return (
    <div class="card">
      <h2 class="list-title">{dayLabel(props.date, props.today)}</h2>
      {allDay.length > 0 && (
        <div class="cal-allday">
          <div class="muted small">כל היום</div>
          {allDay.map(e => (
            <button key={e.id} class={`cal-event flat ${dotClass(e)}`} onClick={() => props.onEdit(e)}>
              <span class="cal-event-title">{e.title}</span>
              <EventMoney data={props.data} event={e} />
            </button>
          ))}
        </div>
      )}
      <div class="cal-hours" style={{ height: `${(last - first) * HOUR_HEIGHT}px` }}>
        {hours.map(h => (
          <button
            key={h}
            class="cal-hour"
            style={{ top: `${(h - first) * HOUR_HEIGHT}px`, height: `${HOUR_HEIGHT}px` }}
            aria-label={`אירוע חדש ב-${timeLabel(h * 60)}`}
            onClick={() => props.onEdit(undefined, props.date, timeLabel(h * 60))}
          >
            <span class="cal-hour-label">{timeLabel(h * 60)}</span>
          </button>
        ))}
        {showNow && <div class="cal-now" style={{ top: `${y(nowMinutes)}px` }} />}
        {timed.map(t => (
          <button
            key={t.event.id}
            class={`cal-event ${dotClass(t.event)}`}
            style={{
              top: `${y(t.start) + 1}px`,
              height: `${Math.max(22, y(t.end) - y(t.start) - 2)}px`,
              right: `calc(50px + (100% - 50px) * ${t.column / t.columns})`,
              width: `calc((100% - 50px) / ${t.columns} - 3px)`,
            }}
            onClick={() => props.onEdit(t.event)}
          >
            <span class="cal-event-title">{t.event.title}</span>
            <span class="cal-event-time">
              {timeLabel(t.start)}–{timeLabel(t.end % (24 * 60))}
            </span>
            <EventMoney data={props.data} event={t.event} />
          </button>
        ))}
      </div>
      <button class="secondary" onClick={() => props.onEdit(undefined, props.date)}>
        + אירוע ב-{shortDate(props.date)}
      </button>
    </div>
  );
}

/** A new calendar event, or editing one. */
export function EventForm(props: { db: IDBDatabase; event?: CalendarEvent; date?: string; time?: string; onDone: (date: string) => void; onCancel: () => void }) {
  const e = props.event;
  const [title, setTitle] = useState(e?.title ?? '');
  const [date, setDate] = useState(e?.date ?? props.date ?? todayStr());
  const [type, setType] = useState<CalendarEvent['type']>(e?.type ?? 'expense');
  const [amount, setAmount] = useState(e?.amount ?? 0);
  const [note, setNote] = useState(e?.note ?? '');
  // A new event is at set hours unless changed: the hour tapped on the day, or the next whole hour
  const nextHour = Math.min(22, new Date().getHours() + 1) * 60;
  const [allDay, setAllDay] = useState(e ? !e.startTime : false);
  const [startTime, setStartTime] = useState(e?.startTime ?? props.time ?? timeLabel(nextHour));
  const [endTime, setEndTime] = useState(e?.endTime ?? plusHour(e?.startTime ?? props.time ?? timeLabel(nextHour)));
  // Moving the start keeps the end after it
  const changeStart = (t: string) => {
    setStartTime(t);
    if (t && endTime <= t) setEndTime(plusHour(t));
  };
  const badTimes = !allDay && (!startTime || !endTime || endTime <= startTime);
  const valid = title.trim() && date && !badTimes;

  const save = async () => {
    if (!valid) return;
    const event: CalendarEvent = {
      id: e?.id ?? crypto.randomUUID(),
      date,
      title: title.trim(),
      type,
      amount: type === 'none' ? 0 : amount,
      note: note.trim() || undefined,
      startTime: allDay ? undefined : startTime,
      endTime: allDay ? undefined : endTime,
      settled: e?.settled,
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
        <div class="cal-allday-toggle">
          <Segmented
            value={allDay ? 'allDay' : 'hours'}
            onChange={v => setAllDay(v === 'allDay')}
            options={[
              ['hours', 'בשעות'],
              ['allDay', 'כל היום'],
            ]}
          />
        </div>
        {!allDay && (
          <div class="cal-times">
            <label class="field">
              <span>משעה</span>
              <input type="time" value={startTime} onChange={ev => changeStart(ev.currentTarget.value)} />
            </label>
            <label class="field">
              <span>עד שעה</span>
              <input type="time" value={endTime} onChange={ev => setEndTime(ev.currentTarget.value)} />
            </label>
          </div>
        )}
        {badTimes && <p class="small warn">שעת הסיום צריכה להיות אחרי שעת ההתחלה</p>}
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
        {type !== 'none' && (
          <p class="muted small">לא נכנס לתקציב וליתרה. כשהאירוע ייגמר, תקפוץ שאלה כמה זה עלה (או הכניס) בפועל, ותוכל לרשום את זה.</p>
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

/* calendar: today's meetings from your calendar's private feed (ICS). The database fetches the
   feed (cockpit_calendar_ics) and the bundled ical.js library reads it, including repeating
   meetings, exceptions and time zones. Events stay on this device; they aren't synced. */
const CAL_KEY = 'dashboard-calendar';
let cal = {};
try {
  cal = JSON.parse(localStorage.getItem(CAL_KEY)) || {};
} catch (e) {}
let calLoading = false;
function loadIcal() {
  if (window.ICAL) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'vendor/ical.min.js';
    s.onload = res;
    s.onerror = rej;
    document.head.appendChild(s);
  });
}
// Events overlapping [from, to), as { title, start, end, allDay } with times in ms.
function eventsBetween(text, from, to) {
  const root = new ICAL.Component(ICAL.parse(text)),
    out = [],
    lo = ICAL.Time.fromJSDate(new Date(from - 864e5)),
    hi = ICAL.Time.fromJSDate(new Date(to));
  root.getAllSubcomponents('vtimezone').forEach(tz => ICAL.TimezoneService.register(new ICAL.Timezone(tz)));
  const byUid = new Map();
  root.getAllSubcomponents('vevent').forEach(ve => {
    const uid = ve.getFirstPropertyValue('uid') || Math.random();
    const g = byUid.get(uid) || { master: null, exceptions: [] };
    if (ve.hasProperty('recurrence-id')) g.exceptions.push(ve);
    else g.master = ve;
    byUid.set(uid, g);
  });
  const add = (item, s, e) => {
    if ((item.component.getFirstPropertyValue('status') || '').toUpperCase() === 'CANCELLED') return;
    const start = s.toJSDate().getTime(),
      end = (e || s).toJSDate().getTime();
    if (end > from && start < to) out.push({ title: item.summary || 'Busy', start, end, allDay: s.isDate });
  };
  byUid.forEach(({ master, exceptions }) => {
    if (!master)
      return exceptions.forEach(x =>
        add(new ICAL.Event(x), new ICAL.Event(x).startDate, new ICAL.Event(x).endDate),
      );
    const ev = new ICAL.Event(master);
    exceptions.forEach(x => ev.relateException(x));
    if (!ev.isRecurring()) return add(ev, ev.startDate, ev.endDate);
    const it = ev.iterator();
    for (let next, i = 0; (next = it.next()) && i < 20000; i++) {
      if (next.compare(hi) >= 0) break;
      if (next.compare(lo) < 0) continue;
      const d = ev.getOccurrenceDetails(next);
      add(d.item, d.startDate, d.endDate);
    }
  });
  return out.sort((a, b) => a.start - b.start);
}
async function loadCalendar(force) {
  if (!sb || !session || calLoading) return;
  if (!force && cal.day === today() && Date.now() - (cal.at || 0) < 15 * 60e3) return;
  calLoading = true;
  try {
    const { data, error } = await sb.rpc('cockpit_calendar_ics');
    if (error) throw error;
    if (!data) cal = { none: true, day: today(), at: Date.now() };
    else {
      await loadIcal();
      const [y, m, d] = today().split('-').map(Number);
      cal = {
        day: today(),
        at: Date.now(),
        events: eventsBetween(data, new Date(y, m - 1, d).getTime(), new Date(y, m - 1, d + 1).getTime()),
      };
    }
  } catch (e) {
    cal = { ...cal, err: String((e && e.message) || e), at: Date.now() };
  } finally {
    calLoading = false;
  }
  try {
    localStorage.setItem(CAL_KEY, JSON.stringify(cal));
  } catch (e) {}
  inBackground(() => {
    renderToday();
    renderHeader();
    if (view === 'account') renderAccount();
  });
}
const hhmm = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const todaysEvents = () => (cal.day === today() && cal.events) || [];
function renderMeetings() {
  const evs = todaysEvents();
  if (!evs.length) return '';
  const now = Date.now();
  let h = '<div class="meet box"><h2>Meetings</h2>';
  evs.forEach(e => {
    h += `<div class="mrow${!e.allDay && e.end <= now ? ' past' : ''}"><span class="mt">${e.allDay ? 'All day' : hhmm(e.start) + '–' + hhmm(e.end)}</span><span>${esc(e.title)}</span></div>`;
  });
  return h + '</div>';
}
// "In a meeting until 11:30" / "Free until 14:00" / "No more meetings", for the header.
function meetingStatus() {
  const evs = todaysEvents().filter(e => !e.allDay);
  if (!evs.length) return '';
  const now = Date.now(),
    cur = evs.filter(e => e.start <= now && now < e.end);
  if (cur.length) {
    // Back-to-back meetings count as one busy stretch.
    let until = Math.max(...cur.map(e => e.end));
    for (const e of evs) if (e.start <= until && e.end > until) until = e.end;
    return 'In a meeting until ' + hhmm(until);
  }
  const next = evs.find(e => e.start > now);
  return next ? 'Free until ' + hhmm(next.start) : 'No more meetings';
}
async function saveCalendarUrl(url) {
  url = url.trim().replace(/^webcal:\/\//i, 'https://');
  if (!/^https:\/\//i.test(url)) return toast('Paste the https:// (or webcal://) link', false, 3000);
  const { error } = await sb.from('cockpit_calendar').upsert({ url }, { onConflict: 'user_id' });
  if (error) return toast("Couldn't save. Run the updated supabase-setup.sql", false, 3000);
  toast('Calendar saved');
  loadCalendar(true);
}
async function removeCalendar() {
  await sb.from('cockpit_calendar').delete().neq('url', '');
  cal = { none: true, day: today(), at: Date.now() };
  try {
    localStorage.setItem(CAL_KEY, JSON.stringify(cal));
  } catch (e) {}
  renderAll();
}
function renderCalendarSettings() {
  let h = '<h2 style="margin-top:26px" id="calsec">Calendar</h2>';
  const status = cal.err
    ? `Couldn't read the calendar: ${esc(cal.err)}`
    : cal.none || !cal.at
      ? 'Paste your calendar\'s private link (ICS) to see meetings on Today. In Outlook: Settings > Calendar > Shared calendars > Publish a calendar ("Can view when I\'m busy" is enough).'
      : `${todaysEvents().length} meeting${todaysEvents().length === 1 ? '' : 's'} today · updated ${hhmm(cal.at)}`;
  h += `<p class="hint" style="margin:0 0 8px">${status}</p><form class="addrow" id="calform"><input id="calin" type="url" placeholder="https://… .ics" aria-label="Calendar link" autocomplete="off"><button class="btn">Save</button></form>`;
  if (cal.at && !cal.none)
    h +=
      '<div class="acts" style="margin-top:0"><button class="btn" id="calnow">Refresh</button><button class="btn" id="caloff">Remove</button></div>';
  return h;
}

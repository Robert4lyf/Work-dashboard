const KEY = 'work-cockpit-v1';
const TAGS = [
  ['Design', 'var(--pink)'],
  ['Meetings', 'var(--blue)'],
  ['Admin', 'var(--orange)'],
  ['Delivery', 'var(--green)'],
];
const PALETTE = ['var(--pink)', 'var(--blue)', 'var(--orange)', 'var(--green)', 'var(--yellow)', '#C2C3C7'];
const TITLE = 'Dashboard';
const $ = s => document.querySelector(s);
const esc = s =>
  String(s).replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const pad = n => String(n).padStart(2, '0');
const fmt = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const today = () => fmt(new Date());
const shift = (ds, n) => {
  const [y, m, d] = ds.split('-').map(Number);
  return fmt(new Date(y, m - 1, d + n));
};
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const niceDate = ds => {
  const [y, m, d] = ds.split('-').map(Number);
  return d + ' ' + MON[m - 1];
};
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEK = [1, 2, 3, 4, 5, 6, 0];
const dayLabel = ds => {
  if (ds === today()) return 'Today';
  if (ds === shift(today(), -1)) return 'Yesterday';
  const [y, m, d] = ds.split('-').map(Number);
  return WD[new Date(y, m - 1, d).getDay()] + ' ' + d + ' ' + MON[m - 1];
};

let S;
function fix(n) {
  n.children = (n.children || []).map(fix);
  n.tag = n.tag || '';
  n.project = n.project || '';
  n.opt = !!n.opt;
  n.notes = n.notes || '';
  n.due = n.due || '';
  n.done = !!n.done;
  return n;
}
function norm(s) {
  S = Object.assign(
    {
      xp: 0,
      day: today(),
      quests: [],
      inbox: [],
      sessions: [],
      templates: [],
      bonusDay: '',
      timer: null,
      tag: 'Design',
      mins: 25,
      focusQ: null,
      log: [],
      tags: null,
      daily: null,
      later: [],
      projects: [],
      pdaily: {},
    },
    s || {},
  );
  delete S.streak;
  S.quests = S.quests.map(fix);
  S.later = S.later.map(fix);
  S.inbox = S.inbox.map(i => (i.node ? Object.assign(i, { node: fix(i.node) }) : i));
  S.templates.forEach(t => {
    if (!Array.isArray(t.days)) t.days = [];
    t.monthDay = t.monthDay || 0;
  });
  if (!Array.isArray(S.tags) || !S.tags.length) S.tags = TAGS.map(([name, color]) => ({ name, color }));
  // Focus totals per day are worked out from the sessions. Older days whose sessions are gone
  // keep their totals in oldDaily/oldPdaily (on first run, whatever the sessions don't explain).
  if (!S.oldDaily) {
    const kept = S.daily || {},
      keptP = S.pdaily || {};
    S.daily = {};
    S.pdaily = {};
    sessionTotals();
    S.oldDaily = minus(kept, S.daily);
    S.oldPdaily = minus(keptP, S.pdaily);
  }
  rebuildTotals();
}
function sessionTotals() {
  S.sessions.forEach(x => {
    const d = fmt(new Date(x.t));
    addDaily(d, x.tag, x.mins);
    addPDaily(d, x.p, x.mins);
  });
}
function minus(a, b) {
  const out = {};
  for (const d in a)
    for (const k in a[d]) {
      const v = a[d][k] - ((b[d] || {})[k] || 0);
      if (v > 0) (out[d] = out[d] || {})[k] = v;
    }
  return out;
}
function rebuildTotals() {
  S.daily = JSON.parse(JSON.stringify(S.oldDaily));
  S.pdaily = JSON.parse(JSON.stringify(S.oldPdaily));
  sessionTotals();
}
function addDaily(d, tag, mins) {
  const o = (S.daily[d] = S.daily[d] || {});
  o[tag] = (o[tag] || 0) + mins;
}
function load() {
  let s = null;
  try {
    s = JSON.parse(localStorage.getItem(KEY));
  } catch (e) {}
  norm(s);
}
function persistLocal() {
  try {
    localStorage.setItem(KEY, JSON.stringify(S));
  } catch (e) {}
}
function save() {
  const cut = Date.now() - 400 * 864e5,
    dcut = shift(today(), -400),
    lcut = shift(today(), -120);
  S.sessions = S.sessions.filter(x => x.t > cut);
  for (const o of [S.oldDaily, S.oldPdaily, S.daily, S.pdaily]) for (const d in o) if (d < dcut) delete o[d];
  S.log = S.log.filter(x => x.d >= lcut);
  S.editedAt = Date.now();
  dropUndo();
  persistLocal();
  markDirty();
  schedulePush();
}
// The daily reset. Every device runs it and makes the same changes (repeat copies get
// date-based ids), so whichever device syncs first, nothing is doubled.
function rollover() {
  if (S.day === today()) return;
  const last = S.day;
  S.quests = S.quests.filter(q => !isDone(q));
  S.day = today();
  // A repeat that fell on a day the app wasn't opened still turns up (looking back up to a month).
  let d = last < shift(today(), -30) ? shift(today(), -30) : shift(last, 1);
  for (; d <= today(); d = shift(d, 1)) {
    const [y, m, dd] = d.split('-').map(Number),
      wd = new Date(y, m - 1, dd).getDay(),
      end = new Date(y, m, 0).getDate();
    S.templates.forEach(t => {
      const hit =
        t.days.includes(wd) || (t.monthDay && (t.monthDay === dd || (t.monthDay > end && dd === end)));
      if (hit && !S.quests.some(q => q.tpl === t.id || q.text === t.text)) {
        const q = inst(t);
        q.tpl = t.id;
        q.id = t.id + '-' + d; // the same on every device, so two devices don't both add it
        S.quests.push(q);
      }
    });
  }
  // Scheduled quests whose day has come join the end of Today's list.
  S.later = S.later.filter(n => {
    if (n.start > today()) return true;
    delete n.start;
    S.quests.push(n);
    return false;
  });
  persistLocal();
  markDirty();
}

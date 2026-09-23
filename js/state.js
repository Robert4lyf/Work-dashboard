const KEY = 'work-cockpit-v1';
const TAGS = [
  ['Design', 'var(--pink)'],
  ['Meetings', 'var(--blue)'],
  ['Admin', 'var(--orange)'],
  ['Delivery', 'var(--green)'],
];
const PALETTE = ['var(--pink)', 'var(--blue)', 'var(--orange)', 'var(--green)', 'var(--yellow)', '#C2C3C7'];
const TITLE = 'Work Cockpit';
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
  if (!S.daily) {
    S.daily = {};
    S.sessions.forEach(x => addDaily(fmt(new Date(x.t)), x.tag, x.mins));
  }
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
  const cut = Date.now() - 60 * 864e5,
    dcut = shift(today(), -400),
    lcut = shift(today(), -120);
  S.sessions = S.sessions.filter(x => x.t > cut);
  for (const d in S.daily) if (d < dcut) delete S.daily[d];
  S.log = S.log.filter(x => x.d >= lcut);
  S.editedAt = Date.now();
  dropUndo();
  persistLocal();
  schedulePush();
}
// The daily reset must not stamp an edit time: otherwise a device that was
// closed yesterday would look newer than the server and overwrite it on sync.
// Every device runs the same reset, so it doesn't need to be pushed.
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
}

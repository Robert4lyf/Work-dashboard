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

// Text as stored: without characters the database can't hold (NUL, or half of a character that
// takes two, as when an emoji is cut in two).
const cleanText = s =>
  String(s)
    .replace(/\u0000/g, '')
    .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '');
let S;
// Ids go into the page inside attributes: characters that could break out of one (only ever
// in a crafted backup or synced row) are dropped.
const cleanId = x => {
  if (x && typeof x.id === 'string') x.id = x.id.replace(/["'<>&\s`]/g, '');
  return x;
};
// Dates go into the page inside attributes too: only a real yyyy-mm-dd, else none.
const cleanDay = v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
// Quests are titles; the waiting is on their subquests. A quest set waiting (before this, or on an
// older copy of the app) gets a step of its own, named for what it's waiting for, that carries it.
// The step's id comes from the quest's, so two devices converting the same quest make the same step.
function waitToStep(q) {
  const w = q.wait;
  if (!w) return null;
  delete q.wait;
  if (q.done && !q.children.length) return null; // (finished: nothing left to wait for)
  let id = q.id + '-w',
    i = 1;
  while (q.children.some(c => c.id === id)) id = q.id + '-w' + ++i;
  const c = fix({ id, text: w.note || 'Hear back' }); // (who from shows on its Waiting tag)
  c.wait = { ...w, note: '' }; // (what for is now the step's name)
  q.children.push(c);
  return c;
}
function fix(n) {
  cleanId(n);
  n.children = (n.children || []).map(fix);
  if (n.start) n.start = cleanDay(n.start);
  if (n.wait) n.wait.due = cleanDay(n.wait.due);
  if (n.since) n.since = cleanDay(n.since);
  n.tag = cleanText(n.tag || ''); // (a tag's name is part of its record's key: see LISTS)
  n.project = n.project || '';
  n.opt = !!n.opt;
  n.notes = n.notes || '';
  n.due = cleanDay(n.due);
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
      interrupts: [],
      alarms: [],
      devices: [],
      notes: '',
      kbcats: [],
      kb: [],
      flows: [],
      noteImgs: [],
      kbimgLoose: [],
    },
    s || {},
  );
  delete S.streak;
  // Alarms and devices come from sync and go into the page as-is: keep only well-formed ones.
  const okId = x => x && typeof x.id === 'string' && /^[\w-]{1,40}$/.test(x.id);
  S.alarms = S.alarms.filter(okId).map(a => ({
    ...a,
    time: /^\d\d:\d\d$/.test(a.time) ? a.time : '09:00',
    device: okId({ id: a.device }) ? a.device : '',
  }));
  S.devices = S.devices.filter(okId);
  // Finished items go into lists as they are: each needs its trail (the steps above it).
  if (!Array.isArray(S.log)) S.log = [];
  S.log = S.log
    .filter(x => x && typeof x === 'object')
    .map(x => (Array.isArray(x.trail) ? x : { ...x, trail: [] }));
  normKnowledge();
  S.noteImgs = (Array.isArray(S.noteImgs) ? S.noteImgs : [])
    .filter(m => okId(m) && okImg(m.src))
    .map(m => ({ id: m.id, src: m.src, at: Number(m.at) || 0 }))
    .sort((a, b) => a.at - b.at);
  // Pictures that arrived before their article (see fromRecords): only sound ones.
  S.kbimgLoose = (Array.isArray(S.kbimgLoose) ? S.kbimgLoose : [])
    .filter(p => okId(p) && okImg(p.src) && typeof p.art === 'string')
    .map(p => ({ id: p.id, art: p.art, src: p.src, at: Number(p.at) || 0 }));
  // Preferences go into the page too (and a bad value would crash Today): only sound ones.
  S.dayEnd = /^\d\d:\d\d$/.test(S.dayEnd) ? S.dayEnd : '';
  S.mins = [15, 25, 45].includes(S.mins) ? S.mins : 25;
  S.quests = S.quests.map(fix);
  S.later = S.later.map(fix);
  S.inbox = S.inbox.map(i => (i.node ? Object.assign(cleanId(i), { node: fix(i.node) }) : cleanId(i)));
  // Waiting details on an Inbox item live on the item (older versions left them on its quest).
  S.inbox.forEach(i => {
    if (i.node && i.node.wait && !i.wait) i.wait = i.node.wait;
    if (i.node) delete i.node.wait;
  });
  S.projects.forEach(cleanId);
  S.templates.forEach(t => {
    cleanId(t);
    if (!Array.isArray(t.days)) t.days = [];
    t.monthDay = t.monthDay || 0;
  });
  // Promises (an earlier feature) become quests: "waiting for" ones set waiting, "I owe" ones
  // plain. Ids come from the promise, so two devices converting the same one don't double it.
  const hadPromises = 'promises' in S;
  (S.promises || [])
    .filter(p => !p.done)
    .forEach(p => {
      const id = 'p-' + p.id;
      if (S.quests.some(q => q.id === id)) return;
      const q = fix({ id, text: p.dir === 'owe' && p.who ? `${p.what} (for ${p.who})` : p.what });
      if (p.dir === 'wait') q.wait = { who: p.who || '', note: '', due: p.due || '', since: today() };
      else q.due = p.due || '';
      S.quests.push(q);
    });
  delete S.promises;
  [...S.quests, ...S.later].forEach(waitToStep);
  if (!Array.isArray(S.tags) || !S.tags.length) S.tags = TAGS.map(([name, color]) => ({ name, color }));
  // Colours go into style attributes: only the palette's, or a plain hex colour.
  S.tags.forEach(t => {
    t.name = cleanText(t.name || '');
    if (!PALETTE.includes(t.color) && !/^#[0-9a-f]{3,8}$/i.test(t.color)) t.color = '#C2C3C7';
  });
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
  if (hadPromises) save(); // store and sync the converted quests
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
// Whole days from one date to another.
const daysBetween = (a, b) => {
  const [y1, m1, d1] = a.split('-').map(Number),
    [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 864e5);
};
// Each quest on Today remembers the day it arrived, so ones carried over for days stand out.
function stampSince() {
  S.quests.forEach(q => {
    if (!q.since) q.since = today();
  });
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
// `pics`: the pictures kept in IndexedDB (see js/pics.js), to fill in what the saved copy left
// out; `json`: the saved copy from there (else it's read from localStorage).
function load(pics = new Map(), json = null) {
  let s = null;
  try {
    s = JSON.parse(json !== null ? json : localStorage.getItem(KEY));
  } catch (e) {}
  if (s) fillPics(s, pics);
  // The saved copy is gone (or unreadable) but the sync bookkeeping isn't: forget that too, so
  // the next sync starts from the server's copy rather than deleting everything it can't see.
  if (!s && typeof sync2 !== 'undefined' && sync2.user) {
    sync2 = { cursor: 0, synced: {}, dirty: {}, snapAt: 0 };
    saveSyncState();
  }
  norm(s);
}
let localSaved = true; // whether the last local save worked (see saveSyncState)
function persistLocal() {
  schedulePics(); // (whatever happens below: pictures move out of this copy, making room)
  if (picDb) {
    // (with the sync bookkeeping, in one go: after a reload the two must still agree)
    writeKV({ state: stateJSON(), sync: JSON.stringify(sync2) });
    return (localSaved = true); // (a failure shows up later: see writeKV)
  }
  try {
    localStorage.setItem(KEY, stateJSON());
    return (localSaved = true);
  } catch (e) {
    return (localSaved = false); // no room (or storage blocked)
  }
}
function save() {
  const cut = Date.now() - 400 * 864e5,
    dcut = shift(today(), -400),
    lcut = shift(today(), -120);
  S.sessions = S.sessions.filter(x => x.t > cut);
  for (const o of [S.oldDaily, S.oldPdaily, S.daily, S.pdaily]) for (const d in o) if (d < dcut) delete o[d];
  S.log = S.log.filter(x => x.d >= lcut);
  S.interrupts = S.interrupts.filter(x => x.t > Date.now() - 120 * 864e5);
  stampSince();
  S.editedAt = Date.now();
  dropUndo();
  // Not saved here: not marked as synced either, or after a reload the old copy would look
  // like a newer edit and go over the server's.
  if (!persistLocal()) {
    // (with pictures still to move to IndexedDB it's saved again once they have: no toast yet)
    if (!picTimer) toast("Couldn't save: this device is out of storage", false, 4000);
    return;
  }
  markDirty();
  schedulePush();
}
// The daily reset. Every device runs it and makes the same changes (repeat copies get
// date-based ids), so whichever device syncs first, nothing is doubled.
// (Alarms need no reset here: one on for a past day simply isn't on any more; see alarmOn.
// Writing a reset could overwrite a newer switch-on synced from another device.)
// Where the day's changes are worked out. Signed in and online, the server's copy comes first
// (see sync): yesterday's edits from another device mustn't be undone by a reset run on stale
// data. Otherwise (or if the sync fails) it runs here.
function rolloverLocal() {
  if (typeof sb !== 'undefined' && sb && session && navigator.onLine) {
    sync();
    return true; // (one is under way)
  }
  // Before the first auth event nothing is known yet: give it a few minutes before a local reset.
  if (typeof deferStart !== 'undefined' && deferStart && !authSeen && Date.now() - startedAt < 3 * 60e3)
    return false;
  rollover();
  return false;
}
let authSeen = false;
const startedAt = Date.now();
function rollover() {
  if (S.day === today()) return;
  dropUndo(); // (an undo from yesterday would bring back yesterday, and its reset again)
  const last = S.day;
  // (not one finished today on another device, whose reset came first: it's done today)
  S.quests = S.quests.filter(q => !isDone(q) || S.log.some(x => x.id === q.id && x.d === today()));
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
      const gone = sync2.gone && sync2.gone['quest:' + t.id + '-' + d]; // done and cleared elsewhere
      const has = // (a copy moved to Upcoming or the Inbox still counts, or it would come back doubled)
        S.quests.some(q => q.tpl === t.id || q.text === t.text) ||
        S.later.some(q => q.tpl === t.id) ||
        S.inbox.some(i => i.node && i.node.tpl === t.id);
      if (hit && !gone && !has) {
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
  stampSince();
  // Cleared copies older than the look-back are of no further use.
  for (const k in sync2.gone || {}) if (k.slice(-10) < shift(today(), -31)) delete sync2.gone[k];
  persistLocal();
  // As of midnight: any real edit made today on another device wins over this tidy-up.
  markDirty(new Date(new Date().setHours(0, 0, 0, 0)).getTime());
}

const KEY = 'work-cockpit-v1';
const SUMMARY_MAX = 600;
const RESUME_MAX = 400; // a saved place's note
const LINKS_MAX = 20; // resources linked to a task
const TOP3_MAX = 3;
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
const okRef = v => typeof v === 'string' && /^[\w-]{1,40}$/.test(v);
// A web link behind a tap: only http(s). A synced row or a backup mustn't be able to put a
// javascript: (or any other) address behind one.
const okUrl = v => typeof v === 'string' && v.length <= 2000 && /^https?:\/\/[^\s<>"'`\\]+$/i.test(v);
// A task's resources: Knowledge articles and flows by id (never copied, so a renamed article
// stays linked and a deleted one is simply gone), web links by address. Only well-formed ones.
function cleanLinks(ls) {
  if (!Array.isArray(ls)) return [];
  const out = [],
    seen = new Set();
  for (const l of ls) {
    if (!l || typeof l !== 'object' || !okRef(l.id) || seen.has(l.id)) continue;
    let x = null;
    if ((l.kind === 'kb' || l.kind === 'flow') && okRef(l.ref)) x = { id: l.id, kind: l.kind, ref: l.ref };
    else if (l.kind === 'url' && okUrl(l.url))
      x = {
        id: l.id,
        kind: 'url',
        url: l.url,
        label: cleanText(typeof l.label === 'string' ? l.label : '')
          .trim()
          .slice(0, 80),
      };
    if (!x) continue;
    seen.add(l.id);
    out.push(x);
    if (out.length >= LINKS_MAX) break;
  }
  return out;
}
// Where work on a task stopped: a note (what was found, what to do next), when, and the step
// it was on. One per task; only kept while it says something.
function cleanResume(r) {
  if (!r || typeof r !== 'object') return null;
  const note = cleanText(typeof r.note === 'string' ? r.note : '')
      .trim()
      .slice(0, RESUME_MAX),
    at = Number(r.at),
    step = okRef(r.step) ? r.step : '';
  if ((!note && !step) || !Number.isFinite(at) || at <= 0) return null;
  return { note, at, step };
}
// Tasks are titles; the waiting is on their steps. A task set waiting (before this, or on an
// older copy of the app) gets a step of its own, named for what it's waiting for, that carries it.
// The step's id comes from the task's, so two devices converting the same task make the same step.
// Record keys changed by a conversion in norm, not by an edit: see markDirty.
const converted = new Set();
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
// Waiting details (on a step, or on an Inbox item): only sound values, keys as they are (a record
// from before mustn't change shape). `who` and `note` go into attributes and text; a number or
// an object in their place (a crafted row) would throw or slip through unescaped.
function cleanWait(n) {
  if (!n.wait || typeof n.wait !== 'object') {
    if ('wait' in n) delete n.wait;
    return;
  }
  const w = n.wait;
  if ('who' in w) w.who = typeof w.who === 'string' ? cleanText(w.who).slice(0, 60) : '';
  if ('note' in w) w.note = typeof w.note === 'string' ? cleanText(w.note).slice(0, 160) : '';
  w.due = cleanDay(w.due);
  if ('since' in w) w.since = cleanDay(w.since);
  // (Release B: when a reply was promised, and the latest follow-up; only kept when set)
  ['expect', 'last'].forEach(k => {
    const v = cleanDay(w[k]);
    if (v) w[k] = v;
    else delete w[k];
  });
}
// A task has steps; a step doesn't (before, steps could have steps of their own). Steps under a
// step move up beside it, named with it ("Contract: Draft"); a step that only grouped them goes.
// One with anything of its own (waiting, notes) stays, as a step, finished if its steps were.
// An optional group's steps are optional, and they take its deadline if they have none. Ids and
// ticks are kept, so every device flattens the same way.
const doneOf = n => {
  const k = n.children || [];
  if (!k.length) return !!n.done;
  const req = k.filter(c => !c.opt);
  return (req.length ? req : k).every(doneOf);
};
function flatSteps(ns) {
  const out = [];
  (function w(list, pre, opt, due) {
    list.forEach(c => {
      const name = pre ? pre + ': ' + c.text : c.text,
        kids = c.children || [],
        o = !!(c.opt || opt),
        d = c.due || due || '';
      if (!kids.length || c.wait || c.notes)
        out.push(Object.assign(c, { text: name, children: [], opt: o, due: d, done: doneOf(c) }));
      w(kids, name, o, d);
    });
  })(ns || [], '', false, '');
  return out;
}
function fix(n) {
  cleanId(n);
  n.children = (n.children || []).map(fix);
  if (n.start) n.start = cleanDay(n.start);
  cleanWait(n);
  cleanEst(n);
  if (n.since) n.since = cleanDay(n.since);
  n.tag = cleanText(n.tag || ''); // (a tag's name is part of its record's key: see LISTS)
  n.project = n.project || '';
  n.opt = !!n.opt;
  n.notes = n.notes || '';
  // A task's summary: where it's at, shown under its name. (Only kept when there is one, so
  // tasks without one, and copies from before, stay as they were.)
  if (n.summary && typeof n.summary === 'string') n.summary = cleanText(n.summary).slice(0, SUMMARY_MAX);
  else delete n.summary;
  n.due = cleanDay(n.due);
  n.done = !!n.done;
  // A scheduled time (Release E): only a real day (and time); tasks without one stay as they were.
  const sc = cleanSched(n.scheduled);
  if (sc) n.scheduled = sc;
  else delete n.scheduled;
  // Resources and a saved place: only kept when there are any, so tasks without stay as they
  // were (and copies from before this version read the same).
  const links = cleanLinks(n.links);
  if (links.length) n.links = links;
  else delete n.links;
  const rs = cleanResume(n.resume);
  if (rs) n.resume = rs;
  else delete n.resume;
  return n;
}
// Today's top 3: up to three of Today's tasks, by id, for one calendar day. (Its own synced
// record: see toRecords. Shown only on its day; the tasks themselves aren't changed.)
function cleanTop3(t) {
  if (!t || typeof t !== 'object') return null;
  const day = cleanDay(t.day),
    ids = (Array.isArray(t.ids) ? t.ids : []).filter(okRef).filter((x, i, a) => a.indexOf(x) === i);
  return day && ids.length ? { day, ids: ids.slice(0, TOP3_MAX) } : null;
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
      follows: [],
      runs: [],
      execs: [],
      workflows: [],
      wruns: [],
      rules: [],
      rlog: [],
      pins: [],
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
  // Follow-ups on waiting items (Release B): append-only records, only well-formed ones.
  S.follows = (Array.isArray(S.follows) ? S.follows : [])
    .filter(f => okId(f) && okRef(f.n) && FOLLOW_KINDS.includes(f.k) && Number.isFinite(+f.t))
    .map(f => ({
      id: f.id,
      n: f.n,
      t: +f.t,
      d: cleanDay(f.d) || fmt(new Date(+f.t)),
      k: f.k,
      note: cleanText(typeof f.note === 'string' ? f.note : '').slice(0, FOLLOW_MAX),
    }));
  normRuns();
  normExecs();
  normWorkflows();
  normRules();
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
  S.top3 = cleanTop3(S.top3);
  S.cap = cleanCap(S.cap);
  S.pins = cleanPins(S.pins);
  S.quests = S.quests.map(fix);
  S.later = S.later.map(fix);
  // (only objects, with a task behind them only if that's an object too: a synced row or a
  // backup could hold anything)
  S.inbox = S.inbox
    .filter(i => i && typeof i === 'object')
    .map(i => {
      if (i.node && typeof i.node === 'object') return Object.assign(cleanId(i), { node: fix(i.node) });
      delete i.node;
      return cleanId(i);
    });
  // Waiting details on an Inbox item live on the item (older versions left them on its task).
  S.inbox.forEach(cleanWait);
  S.inbox.forEach(i => {
    if (i.node && i.node.wait && !i.wait) i.wait = i.node.wait;
    if (i.node) delete i.node.wait;
  });
  S.projects.forEach(cleanId);
  S.templates.forEach(t => {
    cleanId(t);
    if (!Array.isArray(t.days)) t.days = [];
    t.monthDay = t.monthDay || 0;
    const links = cleanLinks(t.links);
    if (links.length) t.links = links;
    else delete t.links;
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
  // Records changed only by these conversions (see converted, in records.js): a real edit made
  // elsewhere meanwhile must still win over them.
  const conv = (k, q, done) => done && converted.add(k + ':' + q.id);
  S.quests.forEach(q => conv('quest', q, waitToStep(q)));
  S.later.forEach(q => conv('later', q, waitToStep(q)));
  const nested = q => q && q.children && q.children.some(c => c.children && c.children.length),
    flat = (k, rec, q) => nested(q) && ((q.children = flatSteps(q.children)), conv(k, rec, true));
  S.quests.forEach(q => flat('quest', q, q));
  S.later.forEach(q => flat('later', q, q));
  S.inbox.forEach(i => flat('inbox', i, i.node));
  S.templates.forEach(t => flat('template', t, t));
  // Before, ticking a task's last step finished it. One finished that way (it's in the log) is
  // marked finished, as finishing it now does; one never finished asks what's next. (Not one this
  // version has already asked about, marked asked: its log entry is from an earlier finish.)
  S.quests.forEach(q =>
    conv(
      'quest',
      q,
      !q.asked &&
        q.children.length &&
        !q.done &&
        stepsDone(q) &&
        S.log.some(x => x.id === q.id) &&
        (q.done = true),
    ),
  );
  // Saved templates (a removed feature) go; only repeating tasks' templates stay. Everywhere
  // alike, so their removal is a conversion too (a repeat set up elsewhere meanwhile still wins).
  S.templates = S.templates.filter(t => {
    if (t.days.length || t.monthDay) return true;
    conv('template', t, true);
    return false;
  });
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
  if (hadPromises) save(); // store and sync the converted tasks
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
// Each task on Today remembers the day it arrived, so ones carried over for days stand out.
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
  S.follows = S.follows.filter(x => x.t > Date.now() - 180 * 864e5);
  pruneRuns();
  pruneExecs();
  pruneRuns2();
  pruneRlog();
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
  // (not one finished today on another device, whose reset came first: it's done today)
  S.quests = S.quests.filter(q => !isDone(q) || S.log.some(x => x.id === q.id && x.d === today()));
  // A repeating task is on Today only on the day it's for: one from an earlier day goes, finished
  // or not (today's copy, made by another device's reset first, stays).
  // (one scheduled and not yet recorded stays: its outcome is still to be recorded)
  S.quests = S.quests.filter(
    q => !repeats(tplFor(q)) || q.id === q.tpl + '-' + today() || (q.scheduled && !isDone(q)),
  );
  S.day = today();
  // Yesterday's top 3 is over: today's is chosen afresh. (Back-dated to midnight like the rest
  // of the reset, so a choice already made today on another device wins over this.)
  if (S.top3 && S.top3.day !== today()) S.top3 = null;
  // Today's copies of repeating tasks. (Days the app wasn't opened aren't caught up: their
  // day has gone.)
  {
    const d = today(),
      [y, m, dd] = d.split('-').map(Number),
      wd = new Date(y, m - 1, dd).getDay(),
      end = new Date(y, m, 0).getDate();
    S.templates.forEach(t => {
      const hit =
        t.days.includes(wd) || (t.monthDay && (t.monthDay === dd || (t.monthDay > end && dd === end)));
      const gone = sync2.gone && sync2.gone['quest:' + t.id + '-' + d]; // done and cleared elsewhere
      // (an earlier day's scheduled copy, kept to be marked done, isn't today's)
      const kept = q => q.scheduled && q.scheduled.date < d && q.id !== t.id + '-' + d;
      const has = // (a copy moved to Upcoming or the Inbox still counts, or it would come back doubled)
        S.quests.some(q => (q.tpl === t.id || q.text === t.text) && !kept(q)) ||
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
  // A recurring workflow's run for today, ready to start (the same id on every device).
  rolloverWorkflows(today());
  rolloverRules(today());
  // Scheduled tasks whose day has come join the end of Today's list.
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

/* per-item sync records. The app works on one in-memory state (S); for syncing, that state is
   seen as a set of records ("quest:<id>", "inbox:<id>", ...), one database row each. Each save
   compares the records with what was last synced and marks the changed ones dirty, with the
   time of the change; sync sends dirty records and takes in rows changed on other devices.
   When the same record changed on both sides, the newer edit wins. */
const LISTS = {
  quest: ['quests', x => x.id],
  inbox: ['inbox', x => x.id],
  later: ['later', x => x.id],
  template: ['templates', x => x.id],
  project: ['projects', x => x.id],
  tag: ['tags', x => x.name],
  log: ['log', x => x.id + '|' + x.d],
  session: ['sessions', x => x.t + '|' + (x.q || '')],
  interrupt: ['interrupts', x => x.id],
};
function toRecords(s) {
  const m = new Map();
  for (const [kind, [prop, key]] of Object.entries(LISTS))
    s[prop].forEach(x => m.set(kind + ':' + key(x), x));
  m.set('meta:order', {
    quests: s.quests.map(x => x.id),
    inbox: s.inbox.map(x => x.id),
    templates: s.templates.map(x => x.id),
    projects: s.projects.map(x => x.id),
    tags: s.tags.map(x => x.name),
  });
  m.set('meta:prefs', {
    mins: s.mins,
    tag: s.tag,
    focusQ: s.focusQ,
    pushKey: s.pushKey || '',
    reviewed: s.reviewed || '',
    dayEnd: s.dayEnd || '',
  });
  m.set('meta:timer', { timer: s.timer });
  m.set('meta:score', { xp: s.xp, bonusDay: s.bonusDay });
  m.set('meta:legacy', { daily: s.oldDaily, pdaily: s.oldPdaily });
  return m;
}
// Rebuild a state from records. Items missing from the saved order (added elsewhere) go at the
// end, except inbox items, which go first like new captures.
function fromRecords(m, day) {
  const by = {};
  m.forEach((v, k) => (by[k.slice(0, k.indexOf(':'))] = by[k.slice(0, k.indexOf(':'))] || []).push(v));
  const order = m.get('meta:order') || {};
  const ordered = (list = [], ids = [], key = x => x.id, newFirst = false) => {
    const pos = new Map(ids.map((id, i) => [id, i])),
      known = list.filter(x => pos.has(key(x))).sort((a, b) => pos.get(key(a)) - pos.get(key(b))),
      extra = list.filter(x => !pos.has(key(x)));
    return newFirst ? [...extra, ...known] : [...known, ...extra];
  };
  const s = {
    quests: ordered(by.quest, order.quests),
    inbox: ordered(by.inbox, order.inbox, x => x.id, true),
    later: (by.later || []).sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0)),
    templates: ordered(by.template, order.templates),
    projects: ordered(by.project, order.projects),
    tags: ordered(by.tag, order.tags, x => x.name),
    log: (by.log || []).sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0)),
    sessions: (by.session || []).sort((a, b) => a.t - b.t),
    interrupts: (by.interrupt || []).sort((a, b) => a.t - b.t),
    ...(m.get('meta:prefs') || {}),
    ...(m.get('meta:score') || {}),
    timer: (m.get('meta:timer') || {}).timer || null,
    day,
  };
  const legacy = m.get('meta:legacy') || {};
  s.oldDaily = legacy.daily || {};
  s.oldPdaily = legacy.pdaily || {};
  return s;
}

// A short fingerprint of a record, to tell whether it changed. Keys are sorted first: the
// database stores JSON with its own key order, and that must not count as a change.
function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (!v || typeof v !== 'object') return v;
  const o = {};
  Object.keys(v)
    .sort()
    .forEach(k => (o[k] = canon(v[k])));
  return o;
}
function hashOf(v) {
  const str = JSON.stringify(canon(v === undefined ? null : v));
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36) + str.length.toString(36);
}

// Sync bookkeeping, kept per device: the seq of the newest row seen, the fingerprint of each
// record as last synced, and the dirty records (fingerprint + when it changed; null = deleted).
const SYNC_KEY = KEY + '-sync';
let sync2 = { cursor: 0, synced: {}, dirty: {}, snapAt: 0 };
try {
  sync2 = Object.assign(sync2, JSON.parse(localStorage.getItem(SYNC_KEY)) || {});
} catch (e) {}
function saveSyncState() {
  try {
    localStorage.setItem(SYNC_KEY, JSON.stringify(sync2));
  } catch (e) {}
}
function markDirty() {
  const now = Date.now(),
    recs = toRecords(S),
    seen = new Set();
  recs.forEach((v, k) => {
    seen.add(k);
    const h = hashOf(v);
    if (sync2.synced[k] === h) delete sync2.dirty[k];
    else if (!sync2.dirty[k] || sync2.dirty[k].h !== h) sync2.dirty[k] = { h, at: now };
  });
  for (const k in sync2.synced)
    if (!seen.has(k) && (!sync2.dirty[k] || sync2.dirty[k].h !== null)) sync2.dirty[k] = { h: null, at: now };
  saveSyncState();
}

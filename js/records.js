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
  session: ['sessions', x => (x.tid || x.t) + '|' + (x.q || '')],
  interrupt: ['interrupts', x => x.id],
  alarm: ['alarms', x => x.id],
  device: ['devices', x => x.id],
  kbcat: ['kbcats', x => x.id],
  kb: ['kb', x => x.id],
  flow: ['flows', x => x.id],
  noteimg: ['noteImgs', x => x.id],
};
function toRecords(s) {
  const m = new Map();
  for (const [kind, [prop, key]] of Object.entries(LISTS))
    (s[prop] || []).forEach(x => m.set(kind + ':' + key(x), x));
  // Only once there are notes: a device that never had any mustn't send an empty copy that
  // could win over real notes from another device. (Clearing them deletes the record.)
  if (s.notes) m.set('meta:notes', { text: s.notes });
  // An article's pictures are records of their own, so editing its text doesn't send them again.
  // (The article keeps an empty list in their place: that's how a device from before this reads
  // it, so the two don't keep rewriting it back and forth.)
  (s.kb || []).forEach(a => {
    const { imgs, ...rest } = a;
    m.set('kb:' + a.id, { ...rest, imgs: [] });
    (imgs || []).forEach(p => m.set('kbimg:' + p.id, { id: p.id, art: a.id, src: p.src, at: p.at }));
  });
  // Pictures whose article isn't here (yet): kept as they are, or they'd be deleted everywhere.
  (s.kbimgLoose || []).forEach(p => m.has('kbimg:' + p.id) || m.set('kbimg:' + p.id, p));
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
  // Its own record too, so a prefs change on a device that hadn't yet heard of new keys can't
  // bring the old ones back. (Still in prefs for older versions.)
  if (s.pushKey) m.set('meta:pushkey', { key: s.pushKey });
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
    alarms: by.alarm || [],
    devices: by.device || [],
    kbcats: by.kbcat || [],
    // Pictures of their own. Older copies kept them in the article: those count only until the
    // account has any pictures of their own (after that, an older device still sending them
    // mustn't bring back one that was removed).
    kb: (by.kb || []).map(a => {
      const own = (by.kbimg || []).filter(p => p.art === a.id).sort((x, y) => (x.at || 0) - (y.at || 0));
      return (by.kbimg || []).length || !a.imgs ? { ...a, imgs: own.map(({ art, ...p }) => p) } : a;
    }),
    kbimgLoose: (by.kbimg || []).filter(p => !(by.kb || []).some(a => a.id === p.art)),
    flows: by.flow || [],
    noteImgs: by.noteimg || [],
    notes: (m.get('meta:notes') || {}).text || '',
    ...(m.get('meta:prefs') || {}),
    ...(m.get('meta:score') || {}),
    timer: (m.get('meta:timer') || {}).timer || null,
    day,
  };
  if (m.get('meta:pushkey')) s.pushKey = m.get('meta:pushkey').key || '';
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
  // Not while the local copy couldn't be saved: after a reload the two must still agree, or
  // the old copy would look like a newer edit and go over the server's.
  if (!localSaved) return;
  try {
    localStorage.setItem(SYNC_KEY, JSON.stringify(sync2));
  } catch (e) {}
}
// Record kinds this version knows. Rows of other kinds (from a newer version on another
// device) are left alone, never deleted for being missing here.
const META_KEYS = ['notes', 'order', 'prefs', 'pushkey', 'timer', 'score', 'legacy'];
const knownKey = k =>
  k.slice(0, k.indexOf(':')) in LISTS ||
  k.startsWith('kbimg:') ||
  (k.startsWith('meta:') && META_KEYS.includes(k.slice(5)));
// `now`: when the change counts as made (the daily reset back-dates its changes to midnight).
function markDirty(now = Date.now()) {
  const recs = toRecords(S),
    seen = new Set(),
    // A record already waiting to be sent keeps its time if later: back-dating the daily reset
    // mustn't make an edit made just before it (in the minute after midnight) count as older.
    at = k => Math.max(now, (sync2.dirty[k] && sync2.dirty[k].at) || 0);
  recs.forEach((v, k) => {
    seen.add(k);
    const h = hashOf(v);
    if (sync2.synced[k] === h) delete sync2.dirty[k];
    else if (!sync2.dirty[k] || sync2.dirty[k].h !== h) sync2.dirty[k] = { h, at: at(k) };
  });
  for (const k in sync2.synced)
    if (!seen.has(k) && knownKey(k) && (!sync2.dirty[k] || sync2.dirty[k].h !== null))
      sync2.dirty[k] = { h: null, at: at(k) };
  // Added and removed again before it was ever sent: nothing to send.
  for (const k in sync2.dirty) if (!seen.has(k) && !(k in sync2.synced)) delete sync2.dirty[k];
  saveSyncState();
}

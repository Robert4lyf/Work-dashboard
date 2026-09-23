/* sync merge: when this device and the server have both changed since they last agreed (the
   "base"), combine them item by item instead of letting the newer copy overwrite the other. */
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// One value changed on one side only: take that side. Changed on both: the newer side wins.
const pick3 = (b, m, t, mineNewer) => (same(m, b) ? t : same(t, b) ? m : mineNewer ? m : t);

// Merge keyed lists (quests, inbox items, tags...). Items added on either side are kept; an item
// deleted on one side stays deleted unless the other side edited it; order follows the newer side.
function mergeList(base = [], mine = [], theirs = [], key, mineNewer) {
  const B = new Map(base.map(x => [key(x), x])),
    M = new Map(mine.map(x => [key(x), x])),
    T = new Map(theirs.map(x => [key(x), x]));
  const pick = k => {
    const b = B.get(k),
      m = M.get(k),
      t = T.get(k);
    if (!b) return m && t ? (mineNewer ? m : t) : m || t;
    if (!m) return !t || same(t, b) ? null : t;
    if (!t) return same(m, b) ? null : m;
    return pick3(b, m, t, mineNewer);
  };
  const out = [],
    seen = new Set();
  for (const x of mineNewer ? [...mine, ...theirs] : [...theirs, ...mine]) {
    const k = key(x);
    if (seen.has(k)) continue;
    seen.add(k);
    const v = pick(k);
    if (v) out.push(v);
  }
  return out;
}

const LISTS = {
  quests: x => x.id,
  inbox: x => x.id,
  later: x => x.id,
  templates: x => x.id,
  tags: x => x.name,
  log: x => x.id + '|' + x.d,
  sessions: x => x.t + '|' + (x.q || ''),
};

function mergeState(base, mine, theirs) {
  const mineNewer = (mine.editedAt || 0) >= (theirs.editedAt || 0),
    out = {};
  for (const k of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
    if (k in LISTS) out[k] = mergeList(base[k], mine[k], theirs[k], LISTS[k], mineNewer);
    else if (k !== 'daily')
      out[k] = JSON.parse(JSON.stringify(pick3(base[k], mine[k], theirs[k], mineNewer) ?? null));
  }
  out.sessions = (out.sessions || []).sort((a, b) => a.t - b.t);
  // Focus totals per day: take the side that changed; if both did, rebuild the day from sessions.
  const bd = base.daily || {},
    md = mine.daily || {},
    td = theirs.daily || {};
  out.daily = {};
  for (const d of new Set([...Object.keys(md), ...Object.keys(td)])) {
    let v = same(md[d], bd[d]) ? td[d] : same(td[d], bd[d]) ? md[d] : null;
    if (!v) {
      v = {};
      out.sessions.forEach(s => {
        if (fmt(new Date(s.t)) === d) v[s.tag] = (v[s.tag] || 0) + s.mins;
      });
      if (!Object.keys(v).length) v = mineNewer ? md[d] : td[d];
    }
    if (v) out.daily[d] = v;
  }
  return out;
}

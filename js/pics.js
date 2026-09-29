/* pictures (the notes' and the articles'), kept in IndexedDB. The main saved copy (localStorage,
   small and rewritten on every save) leaves out each picture's data once it's safely here; the
   app loads them from here before it starts. IndexedDB has room for far more than localStorage,
   and a save no longer rewrites every picture. */
const PIC_DB = 'dashboard-pics';
let picDb = null,
  picStored = new Set(), // ids of pictures whose data is safely in IndexedDB
  picTimer = null;
// Every picture in the state, wherever it is.
function allPics(s = S) {
  return [
    ...((s && s.noteImgs) || []),
    ...((s && s.kb) || []).flatMap(a => (a && Array.isArray(a.imgs) ? a.imgs : [])),
    ...((s && s.kbimgLoose) || []),
  ].filter(p => p && typeof p === 'object');
}
function openPics() {
  return new Promise(ok => {
    try {
      const r = indexedDB.open(PIC_DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore('pics');
      r.onsuccess = () => ok(r.result);
      r.onerror = r.onblocked = () => ok(null);
    } catch (e) {
      ok(null); // (no IndexedDB here: pictures stay in the main copy, as before)
    }
  });
}
// All stored pictures, id → data.
function readPics(db) {
  return new Promise(ok => {
    const out = new Map();
    if (!db) return ok(out);
    try {
      const c = db.transaction('pics').objectStore('pics').openCursor();
      c.onsuccess = () => {
        const cur = c.result;
        if (!cur) return ok(out);
        if (typeof cur.value === 'string') out.set(cur.key, cur.value);
        cur.continue();
      };
      c.onerror = () => ok(out);
    } catch (e) {
      ok(out);
    }
  });
}
// Fills in the data of pictures the saved copy left out. One whose data is missing (site data
// partly cleared, say) is left for the server to send again: it's forgotten as synced (so it
// isn't taken for deleted) and the next pull fetches it.
function fillPics(s, pics) {
  const missing = [];
  allPics(s).forEach(p => {
    if (typeof p.src === 'string') return;
    if (pics.has(p.id)) p.src = pics.get(p.id);
    else missing.push(p.id);
  });
  if (missing.length && typeof sync2 !== 'undefined') {
    missing.forEach(id =>
      ['noteimg:', 'kbimg:'].forEach(k => {
        delete sync2.synced[k + id];
        delete sync2.dirty[k + id];
        if (sync2.at) delete sync2.at[k + id];
      }),
    );
    sync2.kbimg = 0; // (the catch-up lists every row and fetches the ones not taken in)
    saveSyncState();
  }
}
// The main copy's JSON: pictures already in IndexedDB without their data.
function stateJSON() {
  if (!picStored.size) return JSON.stringify(S);
  return JSON.stringify(S, function (k, v) {
    return k === 'src' && typeof v === 'string' && this && picStored.has(this.id) ? undefined : v;
  });
}
// Pictures not yet in IndexedDB go there (soon after a save); ones no longer in the state go.
function schedulePics() {
  if (!picDb || picTimer) return;
  if (allPics().every(p => picStored.has(p.id))) return;
  picTimer = setTimeout(storePics, 300);
}
function storePics() {
  picTimer = null;
  if (!picDb) return;
  const want = allPics().filter(p => typeof p.src === 'string' && okImg(p.src) && !picStored.has(p.id));
  if (!want.length) return;
  try {
    const tx = picDb.transaction('pics', 'readwrite'),
      st = tx.objectStore('pics');
    want.forEach(p => st.put(p.src, p.id));
    tx.oncomplete = () => {
      want.forEach(p => picStored.add(p.id));
      persistLocal(); // (now without their data)
    };
  } catch (e) {}
}
// Pictures deleted (and past any undo) are removed from IndexedDB; run now and then.
function prunePics() {
  if (!picDb || undoSnap) return; // (an undo could still bring one back)
  const keep = new Set(allPics().map(p => p.id));
  const gone = [...picStored].filter(id => !keep.has(id));
  if (!gone.length) return;
  try {
    const tx = picDb.transaction('pics', 'readwrite'),
      st = tx.objectStore('pics');
    gone.forEach(id => st.delete(id));
    tx.oncomplete = () => gone.forEach(id => picStored.delete(id));
  } catch (e) {}
}
// A saved record's fingerprint, remembered for pictures (they don't change, and fingerprinting
// megabytes of them on every save was most of a save's time).
const picHashes = new Map();
function recHash(k, v) {
  if (!v || typeof v.src !== 'string' || !/^(noteimg|kbimg):/.test(k)) return hashOf(v);
  const rest = JSON.stringify({ ...v, src: '' }),
    c = picHashes.get(k);
  if (c && c.src === v.src && c.rest === rest) return c.h;
  const h = hashOf(v);
  picHashes.set(k, { src: v.src, rest, h });
  return h;
}

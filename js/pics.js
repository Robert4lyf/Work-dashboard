/* the app's store: IndexedDB, with room for far more than localStorage. Pictures (the notes' and
   the articles') are kept one by one ('pics'), so a save doesn't rewrite them; the saved copy of
   everything else and the sync bookkeeping are kept together ('kv', written in one transaction so
   the two always agree). The app reads it all before it starts. Without IndexedDB (an old or odd
   browser) everything stays in localStorage, as it was. */
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
      const r = indexedDB.open(PIC_DB, 2);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('pics')) db.createObjectStore('pics');
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      };
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
// The saved copy and the sync bookkeeping, as JSON strings (null: not there).
function readKV(db) {
  return new Promise(ok => {
    const out = { state: null, sync: null };
    if (!db) return ok(out);
    try {
      const st = db.transaction('kv').objectStore('kv'),
        a = st.get('state'),
        b = st.get('sync');
      a.onsuccess = () => (out.state = typeof a.result === 'string' ? a.result : null);
      b.onsuccess = () => (out.sync = typeof b.result === 'string' ? b.result : null);
      st.transaction.oncomplete = () => ok(out);
      st.transaction.onerror = st.transaction.onabort = () => ok(out);
    } catch (e) {
      ok(out);
    }
  });
}
// Writes (a save, the sync bookkeeping) go one after another; storeDone() waits for them all.
let storeTail = Promise.resolve(),
  storeWarned = false;
function writeKV(entries) {
  const done = new Promise(ok => {
    if (!picDb) return ok(false);
    try {
      const tx = picDb.transaction('kv', 'readwrite'),
        st = tx.objectStore('kv');
      for (const k in entries) st.put(entries[k], k);
      tx.oncomplete = () => ok(true);
      tx.onerror = tx.onabort = () => {
        localSaved = false;
        if (!storeWarned) toast("Couldn't save: this device is out of storage", false, 4000);
        storeWarned = true;
        ok(false);
      };
    } catch (e) {
      localSaved = false;
      ok(false);
    }
  });
  storeTail = storeTail.then(() => done);
  return done;
}
const storeDone = () => storeTail;
// The saved copy as stored (for checks): from IndexedDB, else localStorage.
async function readSaved() {
  if (picDb) return JSON.parse((await readKV(picDb)).state || 'null');
  return JSON.parse(localStorage.getItem(KEY) || 'null');
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
// Pictures not yet in IndexedDB go there, straight after a save (soon after: several saves in a
// row store once). The saved copy in localStorage then no longer needs their data: with many of
// them (a new device's first sync, say) it can't hold it, so that copy is written again once
// they're stored, and the save is then done in full (see save) if it couldn't be before.
function schedulePics() {
  if (!picDb || picTimer) return;
  if (allPics().every(p => picStored.has(p.id))) return;
  picTimer = setTimeout(storePics, 0);
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
      if (localSaved)
        persistLocal(); // (now without their data)
      else save(); // (couldn't be saved with it: now it can, in full)
    };
    tx.onerror = tx.onabort = () => {}; // (no room there either: they stay in the saved copy)
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

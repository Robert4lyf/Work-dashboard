/* More than one tab or window of the app open at once (on a computer: the installed app and a
   browser tab, say). Each holds everything in memory and saves it whole, so the tab that saved
   last used to wipe out what another had just saved. Now:
   - a tab that saves tells the others, and they take in the saved copy, as they would a sync from
     another device: a redraw in the background that keeps typed words, open panels and the place
     on the page;
   - what the app saves by itself (the sync's bookkeeping, rows a sync took in, the day's reset)
     gives way to a newer copy saved by another tab, rather than going over it (see writeKV);
   - only one tab syncs at a time, each starting from the newest saved copy.
   What's left: something done in one tab in the moment before another tab's save reaches it (a
   few milliseconds; a sync's length when that tab is mid-sync) is saved over that save. One
   person can't be in two tabs at once, and signed in the server puts it right at the next sync. */
const TAB_STAMP_KEY = KEY + '-stamp';
let tabChannel = null,
  tabSeen = '', // the stamp of the saved copy this tab last took in (or started from)
  tabTaking = null,
  tabAgain = false,
  tabPending = false; // (told of a save before this tab had started)
try {
  tabChannel = new BroadcastChannel('dashboard-tabs');
  tabChannel.onmessage = e => {
    if (e.data && e.data.saved) takeSavedSoon();
  };
} catch (e) {
  tabChannel = null; // (no BroadcastChannel here: the storage event and coming back to the tab still tell)
}
// The stamp of the last write is kept in localStorage too, where it can be read at once (the
// store itself answers later): see tabStale. Another tab hears of it as a storage event, which
// arrives once what was written can be read there (a message alone can arrive first).
window.addEventListener('storage', e => {
  if (e.key === TAB_STAMP_KEY) takeSavedSoon();
});
// Called after each write to the store (see writeKV).
function tabSaved(stamp) {
  try {
    localStorage.setItem(TAB_STAMP_KEY, stamp);
  } catch (e) {}
  if (!tabChannel) return;
  try {
    tabChannel.postMessage({ saved: stamp });
  } catch (e) {}
}
// Without IndexedDB everything is in localStorage: stamped there the same way.
function tabSavedLocal() {
  tabExpect = TAB_ID + ':' + ++tabWrites;
  tabSaved(tabExpect);
}
const tabMine = stamp => !stamp || stamp.startsWith(TAB_ID + ':');
// Whether another tab has saved something this tab hasn't taken in yet. Known at once.
function tabStale() {
  let stamp = '';
  try {
    stamp = localStorage.getItem(TAB_STAMP_KEY) || '';
  } catch (e) {}
  return !tabMine(stamp) && stamp !== tabSeen;
}
// (without IndexedDB) A save the app makes by itself gives way to another tab's newer copy:
// true when it must, and that copy is then taken in.
function tabYield() {
  if (!tabStale()) return false;
  takeSavedSoon();
  return true;
}
// Starting: what the store held when this tab read it is what it holds.
function tabStart(stamp) {
  if (!stamp && !picDb)
    try {
      stamp = localStorage.getItem(TAB_STAMP_KEY) || '';
    } catch (e) {}
  tabSeen = tabExpect = stamp || '';
}
function tabReady() {
  if (tabPending || tabStale()) takeSavedSoon();
  tabPending = false;
}
// The saved copy, the sync bookkeeping and the stamp of the last write, read together.
async function readStore() {
  if (picDb) return readKV(picDb);
  const get = k => {
    try {
      return localStorage.getItem(k);
    } catch (e) {
      return null;
    }
  };
  return { state: get(KEY), sync: get(SYNC_KEY), stamp: get(TAB_STAMP_KEY) || '' };
}
// Another tab saved: take its copy in, once this tab's own sync and writes have finished (a sync
// works from this tab's copy all the way through, and takes the newest in itself before it starts).
function takeSavedSoon() {
  if (!window.appReady) {
    tabPending = true; // (starting reads the store itself; anything saved after that read is taken then)
    return Promise.resolve();
  }
  if (tabTaking) {
    tabAgain = true;
    return tabTaking;
  }
  tabTaking = (async () => {
    do {
      tabAgain = false;
      try {
        await syncDone();
        if (!(await takeSavedNow(true))) tabAgain = true;
      } catch (e) {
        console.warn('taking in another tab’s changes failed', e);
      }
    } while (tabAgain);
  })().finally(() => (tabTaking = null));
  return tabTaking;
}
// Reads the store and takes its copy in if another tab wrote it. False when it couldn't be done
// cleanly this time (this tab wrote, or began a sync, while the store was being read): the
// caller tries again. `idle`: not from within a sync.
async function takeSavedNow(idle) {
  await storeDone();
  const n = tabWrites,
    kv = await readStore();
  if (n !== tabWrites || (idle && syncing)) return false;
  if (!kv.state || kv.stamp === tabSeen || tabMine(kv.stamp)) return true;
  return takeSaved(kv, n, idle);
}
const tabNoPics = (k, v) => (k === 'src' ? undefined : v);
async function takeSaved(kv, n, idle) {
  let s = null;
  try {
    s = JSON.parse(kv.state);
  } catch (e) {}
  if (!s || typeof s !== 'object') return true;
  // Pictures: the saved copy leaves out the data of those kept in IndexedDB. What this tab holds
  // already is used; the rest (added in the other tab) is read from there.
  const have = new Map(
      allPics()
        .filter(p => typeof p.src === 'string')
        .map(p => [p.id, p.src]),
    ),
    bare = allPics(s).filter(p => typeof p.src !== 'string');
  let stored = new Map();
  if (bare.some(p => !have.has(p.id))) {
    stored = await readPics(picDb);
    // (saved again while the pictures were read, here or in another tab, or a sync began: the
    // copy read is no longer the one to take)
    const now = await readStore();
    if (now.stamp !== kv.stamp || n !== tabWrites || (idle && syncing)) return false;
  }
  bare.forEach(p => {
    if (have.has(p.id)) p.src = have.get(p.id);
    else if (stored.has(p.id)) p.src = stored.get(p.id);
    // (left out of the saved copy because the tab that saved it had put it in IndexedDB)
    if (typeof p.src === 'string') picStored.add(p.id);
  });
  tabSeen = tabExpect = kv.stamp;
  if (kv.sync)
    try {
      sync2 = Object.assign({ cursor: 0, synced: {}, dirty: {}, snapAt: 0 }, JSON.parse(kv.sync));
    } catch (e) {}
  // Only the sync bookkeeping moved (a push finished there): nothing to draw again.
  // (compared without the pictures' data, which one copy may carry and the other leave out)
  if (JSON.stringify(s, tabNoPics) === JSON.stringify(S, tabNoPics)) return true;
  const open = path.length ? path[path.length - 1] : '';
  dropUndo(); // (an undo here would put back this tab's older copy of everything)
  norm(s);
  inBackground(renderAll);
  if (open && !find(open)) toast('The task you had open was removed in another tab', false, 4000);
  return true;
}
// One tab syncs at a time (where the browser can arrange it), each from the newest saved copy:
// two tabs hearing of the same change no longer both send, and both take in, the same rows.
async function tabTurn(run) {
  const go = async () => {
    try {
      await takeSavedNow(false);
    } catch (e) {}
    return run();
  };
  if (!navigator.locks || !navigator.locks.request) return go();
  return navigator.locks.request('dashboard-sync', go);
}
// Coming back to a tab: a message can be missed while the browser has it frozen.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) takeSavedSoon();
});
window.addEventListener('focus', () => takeSavedSoon());

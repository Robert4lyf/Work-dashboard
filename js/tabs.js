/* More than one tab or window of the app open at once (on a computer: the installed app and a
   browser tab, say). Each holds everything in memory and saves it whole, so the tab that saved
   last used to wipe out what another had just saved. Now a tab that saves tells the others, and
   they take in the saved copy, as they would a sync from another device: a redraw in the
   background that keeps typed words, open panels and the place on the page.
   (Two changes made in different tabs within the same instant can still cross: one person can't
   be in two tabs at once, and the app's own background changes are the same in each.) */
const TAB_STAMP_KEY = KEY + '-stamp';
let tabChannel = null,
  tabSeen = '', // the stamp of the saved copy this tab last took in
  tabTaking = null,
  tabAgain = false;
try {
  tabChannel = new BroadcastChannel('dashboard-tabs');
  tabChannel.onmessage = e => {
    if (e.data && e.data.saved) takeSavedSoon();
  };
} catch (e) {
  tabChannel = null; // (no BroadcastChannel here: the check on coming back to the tab still runs)
}
// Called after each write to the store (see writeKV).
function tabSaved(stamp) {
  if (!tabChannel) return;
  try {
    tabChannel.postMessage({ saved: stamp });
  } catch (e) {}
}
// Without IndexedDB everything is in localStorage: stamped there the same way.
function tabSavedLocal() {
  const stamp = TAB_ID + ':' + ++tabWrites;
  try {
    localStorage.setItem(TAB_STAMP_KEY, stamp);
  } catch (e) {}
  tabSaved(stamp);
}
const tabMine = stamp => !stamp || stamp.startsWith(TAB_ID + ':');
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
// works from this tab's copy all the way through).
function takeSavedSoon() {
  if (!window.appReady) return Promise.resolve(); // (not started yet: starting reads the store itself)
  if (tabTaking) {
    tabAgain = true;
    return tabTaking;
  }
  tabTaking = (async () => {
    do {
      tabAgain = false;
      try {
        await syncDone();
        await storeDone();
        const kv = await readStore();
        if (kv.state && kv.stamp !== tabSeen && !tabMine(kv.stamp)) {
          tabSeen = kv.stamp;
          await takeSaved(kv);
        }
      } catch (e) {
        console.warn('taking in another tab’s changes failed', e);
      }
    } while (tabAgain);
  })().finally(() => (tabTaking = null));
  return tabTaking;
}
async function takeSaved(kv) {
  let s = null;
  try {
    s = JSON.parse(kv.state);
  } catch (e) {}
  if (!s || typeof s !== 'object') return;
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
    // (saved again while the pictures were read: by another tab, so that newer copy is taken
    // instead; or by this one, whose save the other tabs take in)
    const now = await readStore();
    if (now.stamp !== kv.stamp) {
      tabAgain = !tabMine(now.stamp);
      return;
    }
  }
  bare.forEach(p => {
    if (have.has(p.id)) p.src = have.get(p.id);
    else if (stored.has(p.id)) p.src = stored.get(p.id);
    if (stored.has(p.id)) picStored.add(p.id); // (the other tab put it there)
  });
  if (kv.sync)
    try {
      sync2 = Object.assign({ cursor: 0, synced: {}, dirty: {}, snapAt: 0 }, JSON.parse(kv.sync));
    } catch (e) {}
  // Only the sync bookkeeping moved (a push finished there): nothing to draw again.
  if (kv.state === stateJSON()) return;
  const open = path.length && find(path[path.length - 1]);
  dropUndo(); // (an undo here would put back this tab's older copy of everything)
  norm(s);
  inBackground(renderAll);
  if (open && !find(path[path.length - 1]))
    toast('The task you had open was removed in another tab', false, 4000);
}
// Coming back to a tab: a message can be missed while the browser has it frozen.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) takeSavedSoon();
});
window.addEventListener('focus', () => takeSavedSoon());

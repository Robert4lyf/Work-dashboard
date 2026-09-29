/* sync (Supabase) */
const CFG = self.COCKPIT_CONFIG || {};
let sb = null,
  session = null,
  syncStatus = '',
  lastSync = 0,
  pushT = null,
  authMsg = '',
  syncing = false,
  again = false;
try {
  if (CFG.supabaseUrl && CFG.supabaseAnonKey && window.supabase)
    sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
} catch (e) {
  sb = null;
}
function setSync(s) {
  syncStatus = s;
  renderSyncBadge();
  if (view === 'account') inBackground(renderAccount); // keeps what's being typed in Settings
}
function badgeText() {
  if (!sb) return 'Sync off';
  if (!session) return 'Sign in to sync';
  return (
    { syncing: 'Syncing', ok: 'Synced', offline: 'Offline', error: 'Sync error' }[syncStatus] || 'Synced'
  );
}
function renderSyncBadge() {
  const b = $('#syncBtn');
  if (!b) return;
  b.textContent = badgeText();
  b.dataset.state = !sb || !session ? 'off' : syncStatus;
}
function schedulePush() {
  if (!sb || !session) return;
  clearTimeout(pushT);
  pushT = setTimeout(sync, 1200);
}

/* sync v2: one row per record in cockpit_items (see js/records.js and supabase-setup.sql) */
const OVERLAP = 200; // re-read a few recent rows in case a write committed out of order
// How long each sync took and how much it moved (shown in Settings). Sizes are the JSON sent or
// received, a close guide to what goes over the network.
let tally = null,
  syncStats = []; // the last few, newest last
const sizeOf = v => {
  try {
    return JSON.stringify(v).length;
  } catch (e) {
    return 0;
  }
};
const FULL = 'key,data,deleted,edited_at,seq',
  LIGHT = 'key,deleted,edited_at,seq'; // (no data: just enough to tell what's new)
async function pullRows(since, cols = FULL) {
  const rows = [];
  for (;;) {
    const { data, error } = await sb
      .from('cockpit_items')
      .select(cols)
      .gt('seq', since)
      .order('seq')
      .limit(1000);
    if (error) throw error;
    rows.push(...data);
    if (tally) {
      tally.down += sizeOf(data);
      if (cols === FULL) tally.got += data.length;
    }
    if (data.length < 1000) return rows;
    since = data[data.length - 1].seq;
  }
}
// What changed on the server since the last sync. The list comes first, without the data; the
// data is then fetched only for rows this device hasn't got in that version (sync2.at holds, per
// record, the seq of the version last read or sent from here). So the recent rows read again
// in case of out-of-order writes, and this device's own writes, don't come back down in full:
// with pictures among them, that was most of each sync.
// (A device from before articles' pictures were rows of their own passed over those rows as a
// kind it didn't know: the first pull after updating lists everything once, to fetch them.)
async function pullChanges() {
  const from = Math.max(0, sync2.cursor - OVERLAP),
    catchUp = !sync2.kbimg,
    light = await pullRows(catchUp ? 0 : from, LIGHT),
    at = sync2.at || (sync2.at = {}),
    // (in the catch-up, older rows only if this device never took them in: those of kinds it
    // didn't know then)
    want = light
      .filter(r => knownKey(r.key) && at[r.key] !== Number(r.seq))
      .filter(r => Number(r.seq) > from || (!r.deleted && !(r.key in sync2.synced)))
      .map(r => r.key),
    full = [];
  for (let i = 0; i < want.length; i += 100) {
    const { data, error } = await sb
      .from('cockpit_items')
      .select(FULL)
      .in('key', want.slice(i, i + 100));
    if (error) throw error;
    full.push(...data);
    if (tally) {
      tally.down += sizeOf(data);
      tally.got += data.length;
    }
  }
  // A row written again since it was listed comes back newer than listed: it's taken as it is
  // now (so an article and its pictures arrive together), but the cursor moves only as far as
  // the list went, or rows written around it that were never listed would be passed over.
  applyRows(
    full.sort((a, b) => a.seq - b.seq),
    false,
    null,
    true,
  );
  sync2.kbimg = 1;
  light.forEach(r => {
    sync2.cursor = Math.max(sync2.cursor, Number(r.seq));
    sync2.serverAt = Math.max(sync2.serverAt || 0, Number(r.edited_at) || 0);
  });
  saveSyncState();
}
// Take in rows from the server. A record changed here and not yet sent keeps the local version
// only if its edit is newer than the server's.
// `holdCursor`: the caller moves the cursor (see pullChanges).
function applyRows(rows, firstSync, keep, holdCursor) {
  const recs = firstSync ? keep || new Map() : toRecords(S);
  let changed = firstSync;
  for (const r of rows) {
    if (!holdCursor) sync2.cursor = Math.max(sync2.cursor, Number(r.seq));
    sync2.serverAt = Math.max(sync2.serverAt || 0, Number(r.edited_at) || 0); // (newest change anywhere)
    // A kind from a newer version: nothing here to change (and not a reason to reload).
    if (!knownKey(r.key)) continue;
    // A repeat's copy for a day (id <template>-<date>) cleared by another device's reset:
    // remembered, so this device's look-back doesn't make it again.
    if (r.deleted && /^quest:.+-\d{4}-\d\d-\d\d$/.test(r.key)) (sync2.gone = sync2.gone || {})[r.key] = 1;
    const h = r.deleted ? null : hashOf(r.data),
      mine = sync2.dirty[r.key];
    if (mine && mine.at > Number(r.edited_at)) continue; // (not taken in: fetched again next time)
    (sync2.at = sync2.at || {})[r.key] = Number(r.seq); // (this version is here now)
    (sync2.et = sync2.et || {})[r.key] = Number(r.edited_at) || 0; // (and when it was made)
    delete sync2.dirty[r.key];
    if (h === null) delete sync2.synced[r.key];
    else sync2.synced[r.key] = h;
    if (h === null ? recs.has(r.key) : hashOf(recs.get(r.key)) !== h) {
      if (h === null) recs.delete(r.key);
      else recs.set(r.key, r.data);
      changed = true;
    }
  }
  if (changed) {
    dropUndo();
    norm(Object.assign(fromRecords(recs, S.day), { editedAt: S.editedAt }));
    // The quest on screen went (in the rows, not through the day's reset or a chosen replace).
    const open = !firstSync && path.length && !find(path[path.length - 1]);
    if (!persistLocal()) toast("Couldn't save: this device is out of storage", false, 4000);
    rollover();
    markDirty(); // tidying on load (defaults, rollover) becomes an ordinary change
    inBackground(renderAll);
    if (open) toast('The quest you had open was removed on another device', false, 4000);
  }
  saveSyncState();
}
// First sync on a device: if the server already has rows, they are the truth. Otherwise this
// device moves your data over, taking the old single-row copy if it is newer.
async function firstSync() {
  const rows = await pullRows(0);
  if (rows.length) {
    // This device already has things of its own: they can join the account's, or go.
    // (asked only when signing in; a sync that starts on its own keeps them, which is safe)
    // (everything of its own counts, not just quests: notes, Knowledge, pictures, alarms...)
    const n =
      S.quests.length +
      S.inbox.length +
      S.later.length +
      S.kb.length +
      S.kbcats.length +
      S.flows.length +
      S.noteImgs.length +
      S.alarms.length +
      (S.notes ? 1 : 0);
    const keep =
      n &&
      (!askMerge ||
        confirm(
          `This account already has data. Add this device's ${plural(n, 'item')} to it as well? (Cancel replaces them.)`,
        ));
    askMerge = false;
    applyRows(rows, true, keep ? toRecords(S) : null);
    return;
  }
  const { data, error } = await sb
    .from('cockpit_state')
    .select('data,edited_at')
    .eq('user_id', session.user.id)
    .maybeSingle();
  if (error) throw error;
  if (data && Number(data.edited_at) > (S.editedAt || 0)) {
    dropUndo();
    norm(data.data);
    persistLocal();
    rollover();
    inBackground(renderAll);
  }
  markDirty();
}
async function pushDirty() {
  const keys = Object.keys(sync2.dirty);
  if (!keys.length) return;
  const uid_ = session.user.id;
  for (let i = 0; i < keys.length; i += 500) {
    // Read now, with the dirty marks: edits made while an earlier batch was sending are in both.
    const recs = toRecords(S),
      batch = keys
        .slice(i, i + 500)
        .map(k => ({ k, d: sync2.dirty[k] }))
        .filter(x => {
          if (!x.d) return false;
          if (x.d.h === null || recs.has(x.k)) return true;
          delete sync2.dirty[x.k]; // (added and removed again before it was ever sent)
          return false;
        });
    if (!batch.length) continue;
    const rows = batch.map(({ k, d }) => ({
      user_id: uid_,
      key: k,
      kind: k.slice(0, k.indexOf(':')),
      data: d.h === null ? null : recs.get(k),
      deleted: d.h === null,
      edited_at: d.at,
    }));
    if (tally) {
      tally.up += sizeOf(rows);
      tally.sent += rows.length;
    }
    const sent = rows.map(clean);
    const { data: wrote, error } = await sb
      .from('cockpit_items')
      .upsert(sent, { onConflict: 'user_id,key' })
      .select('key,seq');
    if (error) throw error;
    // The versions just written are this device's own: never read back down (see pullChanges).
    // A row the server kept its own newer version of (see cockpit_items_stamp) isn't among
    // them: this device takes that version instead, now, rather than counting its own as sent.
    const took = Array.isArray(wrote) ? new Set(wrote.map(r => r.key)) : null,
      lost = [];
    (wrote || []).forEach(r => ((sync2.at = sync2.at || {})[r.key] = Number(r.seq)));
    // (one stored cleaned is read back, so this device has it as stored)
    sent.forEach((r, j) => r !== rows[j] && delete sync2.at[r.key]);
    batch.forEach(({ k, d }) => {
      // Only clear it if it wasn't edited again while sending.
      const again = sync2.dirty[k] !== d;
      if (took && !took.has(k)) {
        lost.push(k);
        delete sync2.at[k];
        if (!again) delete sync2.dirty[k];
        return;
      }
      if (d.h === null) delete sync2.synced[k];
      else sync2.synced[k] = d.h;
      (sync2.et = sync2.et || {})[k] = d.at;
      if (!again) delete sync2.dirty[k];
    });
    saveSyncState();
    for (let j = 0; j < lost.length; j += 100) {
      const { data, error: e2 } = await sb
        .from('cockpit_items')
        .select(FULL)
        .in('key', lost.slice(j, j + 100));
      if (e2) throw e2;
      applyRows(
        data.sort((a, b) => a.seq - b.seq),
        false,
        null,
        true,
      );
    }
  }
}
// The database can't store a NUL character, or half of a character that takes two (an emoji
// cut in two, say): a row holding one would fail the whole batch, every sync. They're dropped
// from what's sent (and this device then takes in the row as stored).
function clean(row) {
  if (row.data == null) return row;
  // (JSON writes both as \uXXXX escapes; an escaped backslash before one is left alone)
  const j = JSON.stringify(row.data),
    c = j.replace(/(?<!\\)((?:\\\\)*)\\u(?:0000|d[89a-f][0-9a-f]{2})/gi, '$1');
  return c === j ? row : { ...row, data: JSON.parse(c) };
}
// A few times a day, keep a whole-state copy in cockpit_state; its history trigger is what
// Settings > Previous versions lists.
async function saveSnapshot() {
  if (Date.now() - sync2.snapAt < 6 * 3600e3) return;
  const { error } = await sb.from('cockpit_state').upsert({
    user_id: session.user.id,
    // (pictures are big: kept in their own rows only)
    data: {
      ...S,
      noteImgs: undefined,
      kbimgLoose: undefined,
      kb: S.kb.map(a => ({ ...a, imgs: undefined })),
    },
    edited_at: Date.now(),
    updated_at: new Date().toISOString(),
  });
  if (!error) {
    sync2.snapAt = Date.now();
    saveSyncState();
  }
}
// Waits for any sync under way, then runs one: whether everything here reached the server.
async function syncSettled() {
  await syncDone();
  await sync();
  return !syncing && !Object.keys(sync2.dirty).length;
}
// Waits for any sync under way (and one queued behind it).
async function syncDone() {
  for (let i = 0; (syncing || again) && i < 150; i++) await new Promise(r => setTimeout(r, 100));
}
async function sync() {
  if (!sb || !session) return;
  if (syncing) {
    again = true;
    return;
  }
  if (!navigator.onLine) {
    setSync('offline');
    return;
  }
  syncing = true;
  const t0 = performance.now();
  tally = { down: 0, up: 0, got: 0, sent: 0 };
  setSync('syncing');
  try {
    if (sync2.user !== session.user.id) {
      // Another account was signed in here before: its data mustn't move into this one.
      if (sync2.user) {
        // (dirty marks from the day's reset alone aren't the user's edits)
        if (Object.values(sync2.dirty).some(d => d.at > new Date().setHours(0, 0, 0, 0)))
          toast(
            "This device's unsent changes belonged to the other account and were left behind",
            false,
            5000,
          );
        dropUndo();
        norm(null);
        persistLocal();
        // (nothing of the other account's left open: an article being written, a search...)
        kbEdit = kbArt = kbMoving = kbImgShown = imgShown = null;
        searchQ = kbQuery = '';
        syncStats = [];
        inBackground(renderAll);
      }
      // New device, or a different account: start from the server's copy.
      // The account is noted once that's done: if it fails part-way, it starts over next time.
      sync2 = { cursor: 0, synced: {}, dirty: {}, snapAt: 0 };
      await firstSync();
      sync2.user = session.user.id;
      sync2.kbimg = 1; // (a first sync reads every row)
      saveSyncState();
    } else await pullChanges();
    // The day's reset, now that the server's copy is in (applyRows ran it if anything came).
    if (S.day !== today()) {
      rollover();
      inBackground(renderAll);
    }
    await pushDirty();
    await saveSnapshot();
    await syncNotices();
    lastSync = Date.now();
    syncStats = [...syncStats, { ...tally, ms: Math.round(performance.now() - t0), at: lastSync }].slice(-10);
    askMerge = false; // (only the sync straight after a sign-in may ask)
    setSync('ok');
    // After the first sync, so a new device never writes before it has the server's copy.
    registerDevice();
  } catch (e) {
    console.warn('sync failed', e);
    setSync(navigator.onLine ? 'error' : 'offline');
    // Couldn't hear from the server: the new day still starts, on what's here.
    if (S.day !== today()) {
      rollover();
      inBackground(renderAll);
    }
  } finally {
    syncing = false;
    if (again) {
      again = false;
      sync();
    }
  }
}
// Live updates: another device's change arrives within a second instead of at the next poll.
let live = null,
  liveFor = '',
  askMerge = false;
function listen() {
  if (!sb || !session || !sb.channel) return;
  if (live && liveFor === session.user.id) return;
  unlisten(); // a different account: the old channel would listen for the wrong rows
  liveFor = session.user.id;
  live = sb
    .channel('items')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'cockpit_items', filter: 'user_id=eq.' + session.user.id },
      () => {
        clearTimeout(pushT);
        pushT = setTimeout(sync, 300);
      },
    )
    .subscribe(s => (liveStatus = s));
}
function unlisten() {
  if (live && sb.removeChannel) sb.removeChannel(live);
  live = null;
  liveStatus = '';
}
async function signIn() {
  const email = $('#aemail').value.trim(),
    password = $('#apass').value;
  if (!email || !password) return;
  authMsg = 'Signing in...';
  renderAccount();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  authMsg = error ? error.message : '';
  renderAccount();
}
async function signUp() {
  const email = $('#aemail').value.trim(),
    password = $('#apass').value;
  if (!email || password.length < 6) {
    authMsg = 'Enter your email and a password of at least 6 characters.';
    renderAccount();
    return;
  }
  authMsg = 'Creating account...';
  renderAccount();
  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: location.href.split('#')[0] },
  });
  authMsg = error
    ? error.message
    : data.session
      ? ''
      : 'Account created. Confirm it from the email Supabase sent you, then sign in here.';
  renderAccount();
}
function syncLine() {
  if (syncStatus === 'offline')
    return 'Offline. Changes are saved on this device and will sync when you reconnect.';
  if (syncStatus === 'error') return 'The last sync failed. Tap Sync now to retry.';
  if (syncStatus === 'syncing') return 'Syncing...';
  return lastSync
    ? 'Last synced at ' +
        new Date(lastSync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) +
        '.'
    : 'Not synced yet.';
}
const fmtSize = n =>
  n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
const secs = ms => (ms < 1000 ? ms + ' ms' : (ms / 1000).toFixed(1) + ' s');
// The last sync's time and traffic, and the last few together (this session only).
function syncStatsLine() {
  const s = syncStats[syncStats.length - 1];
  if (!s) return '';
  let h = `Last sync: ${secs(s.ms)}, ${fmtSize(s.down)} down (${plural(s.got, 'item')} fetched), ${fmtSize(s.up)} up (${plural(s.sent, 'item')} sent).`;
  if (syncStats.length > 1) {
    const avg = Math.round(syncStats.reduce((t, x) => t + x.ms, 0) / syncStats.length),
      slow = Math.max(...syncStats.map(x => x.ms));
    h += ` Last ${syncStats.length}: ${secs(avg)} on average, slowest ${secs(slow)}, ${fmtSize(syncStats.reduce((t, x) => t + x.down, 0))} down in all.`;
  }
  return `<p class="hint" id="syncstats" style="margin:6px 0 0">${h}</p>`;
}
let versions = null; // null: not loaded, 'loading', 'none' (table missing), or rows
async function loadHistory() {
  versions = 'loading';
  renderAccount();
  const { data, error } = await sb
    .from('cockpit_history')
    .select('id,data,saved_at')
    .order('id', { ascending: false })
    .limit(20);
  versions = error ? 'none' : data;
  renderAccount();
}
function renderHistory() {
  if (versions === null) return '<button class="linkbtn" id="hist">Show previous versions</button>';
  if (versions === 'loading') return '<p class="hint">Loading...</p>';
  if (versions === 'none')
    return '<p class="hint">Server history isn\'t set up. Run the updated supabase-setup.sql (see the README).</p>';
  if (!versions.length) return '<p class="hint">No previous versions yet.</p>';
  // (they hold everything as it was, notes included: they can be cleared)
  let h =
    '<p class="hint">A copy is kept every few hours. <button class="linkbtn" id="histclear">Delete them all</button></p>';
  versions.forEach(r => {
    const d = r.data || {},
      when = new Date(r.saved_at).toLocaleString([], {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
    h += `<div class="soonrow" style="cursor:default"><span>${esc(when)}<br><small class="hint">${(d.quests || []).length} quests, ${(d.inbox || []).length} inbox</small></span><button class="btn" data-hist="${r.id}" style="padding:6px 10px">Restore</button></div>`;
  });
  return h;
}
async function clearHistory() {
  const { error } = await sb.from('cockpit_history').delete().eq('user_id', session.user.id);
  if (error) return toast("Couldn't delete them. Run the updated supabase-setup.sql", false, 4000);
  versions = [];
  renderAccount();
}
// Per-device appearance, kept out of synced data (a phone and laptop can differ).
const LOOK_KEY = 'dashboard-look';
let look = {};
try {
  look = JSON.parse(localStorage.getItem(LOOK_KEY)) || {};
} catch (e) {}
function setLook(k, v) {
  if (v) look[k] = v;
  else delete look[k];
  try {
    localStorage.setItem(LOOK_KEY, JSON.stringify(look));
  } catch (e) {}
  const root = document.documentElement.dataset;
  if (v) root[k] = v;
  else delete root[k];
}
function renderAccount() {
  let h = '<h2>Sync</h2>';
  if (!sb) {
    h +=
      CFG.supabaseUrl && !window.supabase
        ? '<p class="hint">The sync library didn\'t load (offline, or blocked). Reload once online.</p>'
        : '<p class="hint">Sync isn\'t set up (see the README). Data is saved on this device only.</p>';
  } else if (!session) {
    h += `<form id="authform"><label class="f" for="aemail">Email</label><input class="fld" id="aemail" type="email" autocomplete="email" required><label class="f" for="apass">Password</label><input class="fld" id="apass" type="password" autocomplete="current-password" required><div class="acts"><button class="btn green">Sign in</button><button class="btn" type="button" id="signup">Create account</button></div></form>${authMsg ? `<p class="msg">${esc(authMsg)}</p>` : ''}`;
  } else {
    h += `<div class="node box"><p style="margin:0 0 6px">Signed in as <b>${esc(session.user.email || '')}</b></p><p class="hint" style="margin:0">${syncLine()}</p>${syncStatsLine()}<div class="acts"><button class="btn blue" id="syncNow">Sync now</button><button class="btn" id="signout">Sign out</button></div></div><h2 style="margin-top:26px">Previous versions</h2>${renderHistory()}${renderCapture()}${renderNotifySettings()}`;
  }
  h += renderHealth();
  if (pending)
    h += `<div class="banner box"><p>Replace everything with this backup? It has ${plural(pending.quests.length, 'quest')} and ${plural((pending.inbox || []).length, 'inbox item')}. Your current data${session ? ' on every synced device' : ''} will be replaced (notification keys and device names are kept).</p><div class="acts"><button class="btn pink" id="doRestore">Replace</button><button class="btn" id="noRestore">Cancel</button></div></div>`;
  const opt = (k, v, label) =>
    `<button class="chip" data-look="${k}" data-val="${v}" aria-pressed="${(look[k] || '') === v}">${label}</button>`;
  h += `<h2 style="margin-top:26px">Appearance</h2><p class="hint" style="margin:0 0 6px">This device only.</p>
    <div class="chips">${opt('font', '', 'Pixel font')}${opt('font', 'plain', 'Plain font')}</div>
    <div class="chips">${opt('theme', '', 'Match system')}${opt('theme', 'light', 'Light')}${opt('theme', 'dark', 'Dark')}</div>
    <label class="f" for="dayend">Workday ends (for "free" time on Today)</label><input class="fld" type="time" id="dayend" value="${esc(S.dayEnd || '17:30')}" style="max-width:10em">
    <label class="f" for="devname">This device's name (to choose where an alarm rings)</label><input class="fld" id="devname" value="${esc(thisDevice.name)}" maxlength="40" style="max-width:20em">${renderDevices()}`;
  h += renderTalkSettings();
  h += '<h2 style="margin-top:26px" id="tagsec">Tags</h2>';
  S.tags.forEach(
    (t, i) =>
      (h += `<div class="tagrow"><span class="sw" style="background:${t.color}"></span><input class="fld" data-tagname="${i}" value="${esc(t.name)}" maxlength="20" aria-label="Tag name"><button class="x" data-deltag="${i}" aria-label="Delete tag ${esc(t.name)}">×</button></div>`),
  );
  h +=
    '<form class="addrow" id="tagform" style="margin-top:12px"><input id="tagin" maxlength="20" placeholder="New tag" aria-label="New tag" autocomplete="off"><button class="btn">Add</button></form>';
  h +=
    '<h2 style="margin-top:26px">Backup</h2><div class="acts"><button class="btn" id="exp">Save backup</button><button class="btn" id="impbtn">Restore backup</button><input type="file" id="imp" accept=".json,application/json" hidden aria-hidden="true"></div>';
  setHTML($('#v-account'), h);
}

/* backup */
function exportData() {
  const json = JSON.stringify(S),
    name = 'dashboard-backup-' + today() + '.json';
  try {
    const file = new File([json], name, { type: 'application/json' });
    if (
      matchMedia('(pointer:coarse)').matches &&
      navigator.canShare &&
      navigator.canShare({ files: [file] })
    ) {
      navigator.share({ files: [file] }).catch(() => {});
      return;
    }
  } catch (e) {}
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}
function importFile(file) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const o = JSON.parse(r.result);
      if (!o || !Array.isArray(o.quests)) throw 0;
      pending = o;
      renderAccount();
      window.scrollTo(0, 0);
    } catch (e) {
      toast("That file isn't a Dashboard backup");
    }
  };
  r.readAsText(file);
}

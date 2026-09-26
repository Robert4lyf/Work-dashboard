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
  if (view === 'account') renderAccount();
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
async function pullRows(since) {
  const rows = [];
  for (;;) {
    const { data, error } = await sb
      .from('cockpit_items')
      .select('key,data,deleted,edited_at,seq')
      .gt('seq', since)
      .order('seq')
      .limit(1000);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
    since = data[data.length - 1].seq;
  }
}
// Take in rows from the server. A record changed here and not yet sent keeps the local version
// only if its edit is newer than the server's.
function applyRows(rows, firstSync) {
  const recs = firstSync ? new Map() : toRecords(S);
  let changed = firstSync;
  for (const r of rows) {
    sync2.cursor = Math.max(sync2.cursor, Number(r.seq));
    const h = r.deleted ? null : hashOf(r.data),
      mine = sync2.dirty[r.key];
    if (mine && mine.at > Number(r.edited_at)) continue;
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
    norm(fromRecords(recs, S.day));
    persistLocal();
    rollover();
    markDirty(); // tidying on load (defaults, rollover) becomes an ordinary change
    inBackground(renderAll);
  }
  saveSyncState();
}
// First sync on a device: if the server already has rows, they are the truth. Otherwise this
// device moves your data over, taking the old single-row copy if it is newer.
async function firstSync() {
  const rows = await pullRows(0);
  if (rows.length) return applyRows(rows, true);
  const { data, error } = await sb
    .from('cockpit_state')
    .select('data,edited_at')
    .eq('user_id', session.user.id)
    .maybeSingle();
  if (error) throw error;
  if (data && Number(data.edited_at) > (S.editedAt || 0)) {
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
  const recs = toRecords(S),
    uid_ = session.user.id;
  for (let i = 0; i < keys.length; i += 500) {
    const batch = keys.slice(i, i + 500).map(k => ({ k, d: sync2.dirty[k] }));
    const { error } = await sb.from('cockpit_items').upsert(
      batch.map(({ k, d }) => ({
        user_id: uid_,
        key: k,
        kind: k.slice(0, k.indexOf(':')),
        data: d.h === null ? null : recs.get(k),
        deleted: d.h === null,
        edited_at: d.at,
      })),
      { onConflict: 'user_id,key' },
    );
    if (error) throw error;
    batch.forEach(({ k, d }) => {
      if (d.h === null) delete sync2.synced[k];
      else sync2.synced[k] = d.h;
      // Only clear it if it wasn't edited again while sending.
      if (sync2.dirty[k] === d) delete sync2.dirty[k];
    });
    saveSyncState();
  }
}
// A few times a day, keep a whole-state copy in cockpit_state; its history trigger is what
// Settings > Previous versions lists.
async function saveSnapshot() {
  if (Date.now() - sync2.snapAt < 6 * 3600e3) return;
  const { error } = await sb.from('cockpit_state').upsert({
    user_id: session.user.id,
    data: S,
    edited_at: Date.now(),
    updated_at: new Date().toISOString(),
  });
  if (!error) {
    sync2.snapAt = Date.now();
    saveSyncState();
  }
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
  setSync('syncing');
  try {
    if (sync2.user !== session.user.id) {
      // New device, or a different account: start from the server's copy.
      sync2 = { cursor: 0, synced: {}, dirty: {}, snapAt: 0, user: session.user.id };
      await firstSync();
    } else applyRows(await pullRows(Math.max(0, sync2.cursor - OVERLAP)), false);
    await pushDirty();
    await saveSnapshot();
    await syncNotices();
    lastSync = Date.now();
    setSync('ok');
  } catch (e) {
    console.warn('sync failed', e);
    setSync(navigator.onLine ? 'error' : 'offline');
  } finally {
    syncing = false;
    if (again) {
      again = false;
      sync();
    }
  }
}
// Live updates: another device's change arrives within a second instead of at the next poll.
let live = null;
function listen() {
  if (!sb || !session || live || !sb.channel) return;
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
  let h = '';
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
    h += '<p class="hint">Sync isn\'t set up (see the README). Data is saved on this device only.</p>';
  } else if (!session) {
    h += `<form id="authform"><label class="f" for="aemail">Email</label><input class="fld" id="aemail" type="email" autocomplete="email" required><label class="f" for="apass">Password</label><input class="fld" id="apass" type="password" autocomplete="current-password" required><div class="acts"><button class="btn green">Sign in</button><button class="btn" type="button" id="signup">Create account</button></div></form>${authMsg ? `<p class="msg">${esc(authMsg)}</p>` : ''}`;
  } else {
    h += `<div class="node box"><p style="margin:0 0 6px">Signed in as <b>${esc(session.user.email || '')}</b></p><p class="hint" style="margin:0">${syncLine()}</p><div class="acts"><button class="btn blue" id="syncNow">Sync now</button><button class="btn" id="signout">Sign out</button></div></div><h2 style="margin-top:26px">Previous versions</h2>${renderHistory()}${renderCapture()}${renderNotifySettings()}`;
  }
  h += renderHealth();
  if (pending)
    h += `<div class="banner box"><p>Replace everything with this backup? It has ${pending.quests.length} quests and ${(pending.inbox || []).length} inbox items. Your current data${session ? ' on every synced device' : ''} will be replaced.</p><div class="acts"><button class="btn pink" id="doRestore">Replace</button><button class="btn" id="noRestore">Cancel</button></div></div>`;
  const opt = (k, v, label) =>
    `<button class="chip" data-look="${k}" data-val="${v}" aria-pressed="${(look[k] || '') === v}">${label}</button>`;
  h += `<h2 style="margin-top:26px">Appearance</h2><p class="hint" style="margin:0 0 6px">This device only.</p>
    <div class="chips">${opt('font', '', 'Pixel font')}${opt('font', 'plain', 'Plain font')}</div>
    <div class="chips">${opt('theme', '', 'Match system')}${opt('theme', 'light', 'Light')}${opt('theme', 'dark', 'Dark')}</div>
    <label class="f" for="dayend">Workday ends (for "free" time on Today)</label><input class="fld" type="time" id="dayend" value="${S.dayEnd || '17:30'}" style="max-width:10em">`;
  h += renderTalkSettings();
  h += '<h2 style="margin-top:26px" id="tagsec">Tags</h2>';
  S.tags.forEach(
    (t, i) =>
      (h += `<div class="tagrow"><span class="sw" style="background:${t.color}"></span><input class="fld" data-tagname="${i}" value="${esc(t.name)}" maxlength="20" aria-label="Tag name"><button class="x" data-deltag="${i}" aria-label="Delete tag ${esc(t.name)}">×</button></div>`),
  );
  h +=
    '<form class="addrow" id="tagform" style="margin-top:12px"><input id="tagin" maxlength="20" placeholder="New tag" aria-label="New tag" autocomplete="off"><button class="btn">Add</button></form>';
  h +=
    '<h2 style="margin-top:26px">Backup</h2><div class="acts"><button class="btn" id="exp">Save backup</button><label class="btn">Restore backup<input type="file" id="imp" accept=".json,application/json" hidden></label></div>';
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

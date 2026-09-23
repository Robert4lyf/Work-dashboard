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
    const uid_ = session.user.id;
    const { data, error } = await sb
      .from('cockpit_state')
      .select('data,edited_at')
      .eq('user_id', uid_)
      .maybeSingle();
    if (error) throw error;
    const remoteAt = data ? Number(data.edited_at) : 0,
      localAt = S.editedAt || 0;
    if (data && remoteAt > localAt) {
      dropUndo();
      norm(data.data);
      S.editedAt = remoteAt;
      persistLocal();
      rollover();
      renderAll();
    } else if (localAt > remoteAt || !data) {
      const { error: e2 } = await sb
        .from('cockpit_state')
        .upsert({ user_id: uid_, data: S, edited_at: localAt, updated_at: new Date().toISOString() });
      if (e2) throw e2;
    }
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
let history = null; // null: not loaded, 'loading', 'none' (table missing), or rows
async function loadHistory() {
  history = 'loading';
  renderAccount();
  const { data, error } = await sb
    .from('cockpit_history')
    .select('id,data,saved_at')
    .order('id', { ascending: false })
    .limit(20);
  history = error ? 'none' : data;
  renderAccount();
}
function renderHistory() {
  if (history === null) return '<button class="linkbtn" id="hist">Show previous versions</button>';
  if (history === 'loading') return '<p class="hint">Loading...</p>';
  if (history === 'none')
    return '<p class="hint">Server history isn\'t set up. Run the updated supabase-setup.sql (see the README).</p>';
  if (!history.length) return '<p class="hint">No previous versions yet.</p>';
  let h = '';
  history.forEach(r => {
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
function renderAccount() {
  let h = '<h2>Sync</h2>';
  if (!sb) {
    h += '<p class="hint">Sync isn\'t set up (see the README). Data is saved on this device only.</p>';
  } else if (!session) {
    h += `<form id="authform"><label class="f" for="aemail">Email</label><input class="fld" id="aemail" type="email" autocomplete="email" required><label class="f" for="apass">Password</label><input class="fld" id="apass" type="password" autocomplete="current-password" required><div class="acts"><button class="btn green">Sign in</button><button class="btn" type="button" id="signup">Create account</button></div></form>${authMsg ? `<p class="msg">${esc(authMsg)}</p>` : ''}`;
  } else {
    h += `<div class="node box"><p style="margin:0 0 6px">Signed in as <b>${esc(session.user.email || '')}</b></p><p class="hint" style="margin:0">${syncLine()}</p><div class="acts"><button class="btn blue" id="syncNow">Sync now</button><button class="btn" id="signout">Sign out</button></div></div><h2 style="margin-top:26px">Previous versions</h2>${renderHistory()}`;
  }
  if (pending)
    h += `<div class="banner box"><p>Replace everything with this backup? It has ${pending.quests.length} quests and ${(pending.inbox || []).length} inbox items. Your current data${session ? ' on every synced device' : ''} will be replaced.</p><div class="acts"><button class="btn pink" id="doRestore">Replace</button><button class="btn" id="noRestore">Cancel</button></div></div>`;
  h += '<h2 style="margin-top:26px" id="tagsec">Tags</h2>';
  S.tags.forEach(
    (t, i) =>
      (h += `<div class="tagrow"><span class="sw" style="background:${t.color}"></span><input class="fld" data-tagname="${i}" value="${esc(t.name)}" maxlength="20" aria-label="Tag name"><button class="x" data-deltag="${i}" aria-label="Delete tag ${esc(t.name)}">×</button></div>`),
  );
  h +=
    '<form class="addrow" id="tagform" style="margin-top:12px"><input id="tagin" maxlength="20" placeholder="New tag" aria-label="New tag" autocomplete="off"><button class="btn">Add</button></form>';
  h +=
    '<h2 style="margin-top:26px">Backup</h2><div class="acts"><button class="btn" id="exp">Save backup</button><label class="btn">Restore backup<input type="file" id="imp" accept=".json,application/json" hidden></label></div>';
  $('#v-account').innerHTML = h;
}

/* backup */
function exportData() {
  const json = JSON.stringify(S),
    name = 'work-cockpit-backup-' + today() + '.json';
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
      toast("That file isn't a Work Cockpit backup");
    }
  };
  r.readAsText(file);
}

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
  b.innerHTML = `<span class="sr">${badgeText()}</span>`; // (a dot; the words for screen readers)
  b.title = badgeText();
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
  const recs = firstSync ? keep || new Map() : toRecords(S),
    tookRuns = [];
  let changed = firstSync;
  for (const r of rows) {
    if (!holdCursor) sync2.cursor = Math.max(sync2.cursor, Number(r.seq));
    sync2.serverAt = Math.max(sync2.serverAt || 0, Number(r.edited_at) || 0); // (newest change anywhere)
    // A kind from a newer version: nothing here to change (and not a reason to reload).
    if (!knownKey(r.key)) continue;
    // A repeat's copy for a day (id <template>-<date>) cleared by another device's reset:
    // remembered, so this device's look-back doesn't make it again.
    if (r.deleted && /^(quest|wrun):.+-\d{4}-\d\d-\d\d$/.test(r.key))
      (sync2.gone = sync2.gone || {})[r.key] = 1;
    const h = r.deleted ? null : recHash(r.key, r.data),
      mine = sync2.dirty[r.key];
    // A process run changed here and not yet taken by the server isn't replaced by what it has:
    // the server decides between the two (see pushRuns), unless its check isn't installed.
    if (mine && isWrunKey(r.key) && !wrunCasOff()) continue;
    if (mine && mine.at > Number(r.edited_at)) continue; // (not taken in: fetched again next time)
    (sync2.at = sync2.at || {})[r.key] = Number(r.seq); // (this version is here now)
    (sync2.et = sync2.et || {})[r.key] = Number(r.edited_at) || 0; // (and when it was made)
    delete sync2.dirty[r.key];
    if (h === null) delete sync2.synced[r.key];
    else sync2.synced[r.key] = h;
    // (a run's revision as stored, the base of the next change made here; what was noted for a
    // version replaced is of no further use)
    if (isWrunKey(r.key)) {
      tookRunRow(r);
      tookRuns.push(r.key);
    }
    if (h === null ? recs.has(r.key) : recHash(r.key, recs.get(r.key)) !== h) {
      if (h === null) recs.delete(r.key);
      else recs.set(r.key, r.data);
      changed = true;
    }
  }
  if (changed) {
    dropUndo();
    // (with this device's own refused run changes, which aren't records: see wfConflict)
    norm(Object.assign(fromRecords(recs, S.day), { editedAt: S.editedAt, wconflicts: S.wconflicts }));
    settleTop3();
    // (a run taken in, as cleaned here, is explained: not a change of this device's, see wrunSeen)
    tookRuns.forEach(k => {
      const w = wrunById(k.slice(5));
      if (w) (sync2.wjh = sync2.wjh || {})[w.id] = recHash(k, w);
    });
    // The task on screen went (in the rows, not through the day's reset or a chosen replace).
    const open = !firstSync && path.length && !find(path[path.length - 1]);
    if (!persistLocal()) toast("Couldn't save: this device is out of storage", false, 4000);
    rollover();
    markDirty(); // tidying on load (defaults, rollover) becomes an ordinary change
    inBackground(renderAll);
    if (open) toast('The task you had open was removed on another device', false, 4000);
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
      S.templates.length +
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
  let keys = Object.keys(sync2.dirty);
  if (!keys.length) return;
  // Process runs first, each through the server's check (or, without it, with the rest).
  if (!wrunCasOff()) keys = await pushRuns(keys);
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
      lost = [],
      lostRun = {}; // (a run's change that didn't go in: what it was, and when made)
    (wrote || []).forEach(r => ((sync2.at = sync2.at || {})[r.key] = Number(r.seq)));
    // (one stored cleaned is read back, so this device has it as stored)
    sent.forEach((r, j) => r !== rows[j] && delete sync2.at[r.key]);
    batch.forEach(({ k, d }) => {
      // Only clear it if it wasn't edited again while sending.
      const again = sync2.dirty[k] !== d;
      if (took && !took.has(k)) {
        lost.push(k);
        if (isWrunKey(k))
          lostRun[k] = { at: d.at, mine: d.h === null ? null : JSON.parse(JSON.stringify(recs.get(k))) };
        delete sync2.at[k];
        if (!again) delete sync2.dirty[k];
        return;
      }
      if (d.h === null) delete sync2.synced[k];
      else sync2.synced[k] = d.h;
      (sync2.et = sync2.et || {})[k] = d.at;
      if (!again) delete sync2.dirty[k];
      // (newer edit wins: nothing to replay, and a change still waiting to be sent through the
      // function is older than this one)
      if (isWrunKey(k)) tookRunRow({ key: k, data: d.h === null ? null : recs.get(k) });
    });
    saveSyncState();
    for (let j = 0; j < lost.length; j += 100) {
      const { data, error: e2 } = await sb
        .from('cockpit_items')
        .select(FULL)
        .in('key', lost.slice(j, j + 100));
      if (e2) throw e2;
      // A run's change refused although no newer edit was there (a server with the run guard but
      // without the function: see supabase/release-g-runs.sql): kept as a conflict, not dropped.
      data.forEach(row => {
        const l = lostRun[row.key];
        if (l && Number(row.edited_at) <= l.at)
          wfConflict(
            row.key.slice(5),
            l.mine,
            row.deleted ? null : row.data,
            baseRev(row.key),
            rowRev(row.data),
            (sync2.wjour || {})[row.key.slice(5)] || [],
          );
      });
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
/* Release G: process runs go through cockpit_put_wrun (supabase/release-g-runs.sql). A change to
   a run is sent with the revision it was made to (its base): the server takes it only if that is
   still the revision it has, and the run is then one revision higher, so two devices can't write
   over each other's changes. Each change sent has an id (sync2.wop, kept until it's answered), so
   one sent again after its answer was lost is applied once. Refused: the server's run is taken
   here, and this device's version kept as a conflict to decide on (see wfConflict). Without the
   function on the server, runs sync like everything else (the newer edit wins) and the health
   check says so; it's asked again every half hour. Nothing here ever launches anything. */
let wrunCas = { on: null, at: 0 }; // the server has the function: true, false (when last asked), or null (not known yet)
const isWrunKey = k => k.startsWith('wrun:');
const wrunCasOff = () => wrunCas.on === false && Date.now() - wrunCas.at < 30 * 60e3;
// (PostgREST: no such function. A 404 is that too, from older versions.)
const fnMissing = (error, status) => status === 404 || ['PGRST202', '42883'].includes(error && error.code);
const rowRev = d => (d && Number.isInteger(d.rev) && d.rev > 0 && d.rev < 999999999 ? d.rev : 0);
// What the server counts a run's size by: its text as PostgreSQL writes jsonb (", " and ": "),
// in UTF-8 bytes. The limit is the function's.
const WRUN_BYTES = 262144;
function jsonbText(v) {
  if (Array.isArray(v)) return '[' + v.map(jsonbText).join(', ') + ']';
  if (v && typeof v === 'object')
    return (
      '{' +
      Object.keys(v)
        .filter(k => v[k] !== undefined)
        .map(k => JSON.stringify(k) + ': ' + jsonbText(v[k]))
        .join(', ') +
      '}'
    );
  return v === undefined ? 'null' : JSON.stringify(v);
}
const jsonbBytes = v => new TextEncoder().encode(jsonbText(v)).length;
// A run the server refused for what it is (too large, malformed): kept here, said on its page, and
// not sent again until it changes, so it doesn't hold up the rest. (sync2.wbad: why, and the
// version refused)
const wrunParked = k => {
  const b = sync2.wbad && sync2.wbad[k],
    d = sync2.dirty[k];
  return b && d && b.h === d.h ? b : null;
};
// The revision this device's version of a run was changed from: the server's, as last taken in
// or accepted here (else the run's own, from before this bookkeeping).
function baseRev(k) {
  if (sync2.wrev && k in sync2.wrev) return sync2.wrev[k];
  return rowRev(wrunById(k.slice(5)));
}
// A run's row taken in (pulled, or the server's answer): its revision is the base from now on,
// and what was noted or being sent for the version it replaces is of no further use.
function tookRunRow(row) {
  (sync2.wrev = sync2.wrev || {})[row.key] = rowRev(row.data);
  if (sync2.wjour) delete sync2.wjour[row.key.slice(5)];
  if (sync2.wop) delete sync2.wop[row.key];
}
// Sends the dirty runs among `keys`; returns the keys left for the ordinary upsert (all the runs
// not yet sent too, if the server hasn't got the function).
async function pushRuns(keys) {
  const runs = keys.filter(isWrunKey),
    rest = keys.filter(k => !isWrunKey(k)),
    open = view === 'knowledge' && wfOpen && wrunById(wfOpen),
    was = open ? wsyncState(open) : '';
  let left = rest;
  try {
    for (let i = 0; i < runs.length; i++) {
      if (wrunParked(runs[i])) continue;
      const got = await putRun(runs[i]);
      if (got === 'missing') {
        left = [...rest, ...runs.slice(i)];
        break;
      }
      if (got === 'later') break; // (too many changes this hour: the runs wait, the rest goes)
    }
    for (const id in sync2.wjour || {}) if (!wrunById(id)) delete sync2.wjour[id];
    for (const k in sync2.wbad || {}) if (!sync2.dirty[k]) delete sync2.wbad[k];
  } finally {
    // (the revisions taken, saved with the bookkeeping: after a reload the two agree)
    if (runs.length && persistLocal()) saveSyncState();
  }
  const now = open && wrunById(open.id);
  if (now && wsyncState(now) !== was) inBackground(renderKnowledge);
  return left;
}
async function putRun(k) {
  const id = k.slice(5);
  for (let pass = 0; pass < 4; pass++) {
    const d = sync2.dirty[k];
    if (!d) return;
    const wop = (sync2.wop = sync2.wop || {}),
      base = baseRev(k);
    let p = wop[k];
    // One change, frozen as first sent: sent again as it was until it's answered.
    if (!p || p.base !== base) {
      const r = wrunById(id),
        j = (sync2.wjour || {})[id] || [],
        data = r ? clean({ data: { ...JSON.parse(JSON.stringify(r)), rev: base + 1 } }).data : null;
      if (data && jsonbBytes(data) > WRUN_BYTES) {
        park(k, `too large to sync (${Math.ceil(jsonbBytes(data) / 1024)} KB; at most 256 KB)`);
        return;
      }
      p = wop[k] = {
        op: uid() + Math.random().toString(36).slice(2, 10),
        base,
        data,
        upto: j.length ? j[j.length - 1].q || 0 : 0, // (the journal's changes it holds: up to this one)
      };
      saveSyncState(); // (before it goes: if the answer is lost, the same op is asked again)
    }
    if (tally) {
      tally.up += sizeOf(p.data);
      tally.sent++;
    }
    const {
      data: out,
      error,
      status,
    } = await sb.rpc('cockpit_put_wrun', { p_key: k, p_base_rev: p.base, p_data: p.data, p_op: p.op });
    if (error && !fnMissing(error, status)) {
      // Refused for what this run is: kept and said on its page; the rest of the sync goes on.
      // (A connection or sign-in problem stops the sync, to try again later.)
      if (error.code === '22023' || status === 400 || status === 413) {
        delete wop[k];
        park(k, error.message || 'refused by the server');
        return;
      }
      if (error.code === '54000') return 'later';
      throw error;
    }
    // (no such function, or an answer it can't have given: as before the function, for now)
    if (error || !out || typeof out !== 'object' || !out.status) {
      wrunCas = { on: false, at: Date.now() };
      return 'missing';
    }
    wrunCas = { on: true, at: Date.now() };
    const row = {
      key: k,
      data: out.data || null,
      deleted: !!out.deleted,
      edited_at: Number(out.edited_at) || 0,
      seq: Number(out.seq) || 0,
    };
    if (out.status === 'accepted' || out.status === 'duplicate') {
      // (a duplicate: taken before, its answer lost; changed again since by another device, the
      // run as it is now comes here too)
      const later = out.status === 'duplicate' && out.cur_rev !== out.rev;
      acceptedRun(k, p, Number(out.rev), later ? null : row);
      if (later && !sync2.dirty[k] && row.seq) applyRows([row], false, null, true);
      continue;
    }
    if (out.status !== 'conflict') throw new Error('cockpit_put_wrun: ' + out.status);
    delete wop[k];
    // The server has no such run, or exactly the version last taken in here: only this
    // device's note of the revision was out of date. Sent again from the right one.
    if ((!row.data && !row.deleted) || (!row.deleted && sync2.synced[k] === recHash(k, row.data))) {
      (sync2.wrev = sync2.wrev || {})[k] = rowRev(row.data);
      continue;
    }
    const r = wrunById(id),
      notes = wfConflict(
        id,
        r ? JSON.parse(JSON.stringify(r)) : null,
        row.deleted ? null : row.data,
        p.base,
        rowRev(row.data),
        (sync2.wjour || {})[id] || [],
      );
    delete sync2.dirty[k];
    applyRows([row], false, null, true); // (the server's run, here now)
    const r2 = wrunById(id);
    if (r2 && notes.length) {
      notes.forEach(e => noteRun(r2, e.k || 'note', e.m || ''));
      persistLocal();
      markDirty();
    }
  }
}
function park(k, msg) {
  (sync2.wbad = sync2.wbad || {})[k] = {
    h: sync2.dirty[k].h,
    msg: String(msg).slice(0, 200),
    at: Date.now(),
  };
  saveSyncState();
}
// The change `p` was taken as revision `rev` (`row`: the row as stored, when it's the one sent).
function acceptedRun(k, p, rev, row) {
  const id = k.slice(5),
    j = sync2.wjour && sync2.wjour[id];
  delete sync2.wop[k];
  (sync2.wrev = sync2.wrev || {})[k] = rev;
  if (j) {
    // (by number, however the journal was trimmed meanwhile; an op from before numbers: by count)
    const left = p.upto !== undefined ? j.filter(e => (e.q || 0) > p.upto) : j.slice(p.n || 0);
    if (left.length) sync2.wjour[id] = left;
    else delete sync2.wjour[id];
  }
  const h = p.data ? recHash(k, p.data) : null;
  if (h === null) delete sync2.synced[k];
  else sync2.synced[k] = h;
  if (row && row.seq) {
    (sync2.at = sync2.at || {})[k] = row.seq; // (this device's own write: not read back down)
    (sync2.et = sync2.et || {})[k] = row.edited_at;
  } else if (sync2.at) delete sync2.at[k];
  // This device's copy is that revision now; changed again since it went, it's sent next.
  // (and changed back meanwhile, to what was synced before, it's still sent: the server has the
  // change now, and this device's copy hasn't)
  const r = wrunById(id),
    before = r ? recHash(k, r) : null;
  if (r) r.rev = rev;
  const now = r ? recHash(k, r) : null;
  if (r && sync2.wjh && sync2.wjh[id] === before) sync2.wjh[id] = now; // (the revision: explained)
  if (now === h) delete sync2.dirty[k];
  else sync2.dirty[k] = { h: now, at: Math.max(Date.now(), (sync2.dirty[k] && sync2.dirty[k].at) || 0) };
  saveSyncState();
}
// "Use the server's" for a run the server refused (see park): this device's version is dropped,
// what it held written into the run's history, and the server's run taken in.
async function wrunTakeServer(k) {
  const id = k.slice(5),
    bad = sync2.wbad && sync2.wbad[k],
    r0 = wrunById(id),
    what = r0 ? jourSummary({ jour: (sync2.wjour || {})[id] || [], mine: r0 }) : '';
  if (!sb || !session || !navigator.onLine) return toast('Needs a connection', false, 3000);
  const { data, error } = await sb.from('cockpit_items').select(FULL).in('key', [k]);
  if (error || !Array.isArray(data)) return toast("Couldn't reach the server", false, 3000);
  if (!data.length) return toast('The server has no copy of this run', false, 3000);
  delete sync2.dirty[k];
  if (sync2.wbad) delete sync2.wbad[k];
  if (sync2.wop) delete sync2.wop[k];
  applyRows(data, false, null, true);
  const r = wrunById(id);
  if (r) {
    noteRun(r, 'conflict', 'not synced from this device (' + (bad ? bad.msg : 'refused') + '): ' + what);
    save();
  }
  inBackground(renderKnowledge);
}
// For the health check: whether the server checks run changes (its function refuses an empty key).
async function wrunHealth(add) {
  const name = 'Process run checks';
  let res;
  try {
    res = await sb.rpc('cockpit_put_wrun', { p_key: '', p_base_rev: 0, p_data: null, p_op: '' });
  } catch (e) {
    return add(name, null, 'Unknown');
  }
  const { error, status } = res || {};
  if (error && fnMissing(error, status)) {
    wrunCas = { on: false, at: Date.now() };
    return add(
      name,
      false,
      'Not installed: the newer edit wins',
      'Run supabase/release-g-runs.sql in the SQL Editor (README > How sync behaves).',
    );
  }
  if (!error || error.code === '22023' || /key must be/.test(error.message || '')) {
    wrunCas = { on: true, at: Date.now() };
    return add(name, true, 'On');
  }
  add(name, null, 'Unknown');
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
        kbEdit = kbArt = kbMoving = kbImgShown = imgShown = triage = kbRun = wfOpen = wfEdit = wfView = null;
        execToken = '';
        try {
          localStorage.removeItem(EXEC_KEY);
        } catch (e) {}
        kbReturn = false;
        resQuery = '';
        notesDirty = false;
        notesBase = null;
        clearKbDraft();
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
    await pullExecEvents();
    lastSync = Date.now();
    syncStats = [...syncStats, { ...tally, ms: Math.round(performance.now() - t0), at: lastSync }].slice(-10);
    retryRoute(); // (a deep link whose target wasn't here before this sync)
    askMerge = false; // (only the sync straight after a sign-in may ask)
    setSync('ok');
    // After the first sync, so a new device never writes before it has the server's copy.
    registerDevice();
  } catch (e) {
    console.warn('sync failed', e);
    setSync(navigator.onLine ? 'error' : 'offline');
    retryRoute(true); // (a deep link waiting on this sync: as far as it can be followed)
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
  liveExec = null,
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
    // (a flow's report too: its result shows within a second)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'cockpit_exec_events',
        filter: 'user_id=eq.' + session.user.id,
      },
      () => {
        clearTimeout(pushT);
        pushT = setTimeout(sync, 300);
      },
    )
    .subscribe(s => (liveStatus = s));
}
function unlisten() {
  if (live && sb.removeChannel) sb.removeChannel(live);
  if (liveExec && sb.removeChannel) sb.removeChannel(liveExec);
  live = liveExec = null;
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
    h += `<div class="soonrow" style="cursor:default"><span>${esc(when)}<br><small class="hint">${(d.quests || []).length} tasks, ${(d.inbox || []).length} inbox</small></span><button class="btn" data-hist="${r.id}" style="padding:6px 10px">Restore</button></div>`;
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
// (Release D: one typeface; the old pixel/plain font choice is read as Standard text, and only
// Larger is kept as a font setting)
let look = {};
try {
  look = JSON.parse(localStorage.getItem(LOOK_KEY)) || {};
} catch (e) {}
if (look.font && look.font !== 'large') delete look.font;
function setLook(k, v) {
  if (v) look[k] = v;
  else delete look[k];
  try {
    localStorage.setItem(LOOK_KEY, JSON.stringify(look));
  } catch (e) {}
  const root = document.documentElement.dataset;
  if (v) root[k] = v;
  else delete root[k];
  if (k === 'theme') themeBar();
}
/* Settings: an index of a few groups, each opened as a page of its own (‹ and Android back go to
   the index). Links from elsewhere open the group that holds what they point at (openSettings).
   Nothing moves between devices or changes by being grouped: the same controls, sorted. */
let setSub = null; // the group open, or null for the index
const SET_GROUPS = [
  ['sync', 'Sync and account'],
  ['look', 'Appearance and this device'],
  ['tags', 'Tags'],
  ['rules', 'Rules'],
  ['auto', 'Automations and integrations'],
  ['backup', 'Backup and restore'],
  ['health', 'Health check'],
];
// Which group a section's id is in (for links that name a section).
const SET_SEC = {
  syncsec: 'sync',
  looksec: 'look',
  tagsec: 'tags',
  rulesec: 'rules',
  execsec: 'auto',
  capsec: 'auto',
  notifsec: 'auto',
  shortsec: 'auto',
  backupsec: 'backup',
  healthsec: 'health',
};
function openSettings(group, sec) {
  if (view !== 'account') go('account');
  setSub = SET_GROUPS.some(g => g[0] === group) ? group : null;
  renderAccount();
  window.scrollTo(0, 0);
  const el = sec && document.getElementById(sec);
  if (el && sec !== 'rulesec' && sec !== 'healthsec') el.scrollIntoView({ block: 'start' });
}
// One line under each group in the index: what's there, or its state now.
function setGroupLine(k) {
  if (k === 'sync')
    return !sb
      ? CFG.supabaseUrl && !window.supabase
        ? 'The sync library didn’t load'
        : 'Not set up: saved on this device only'
      : !session
        ? 'Not signed in'
        : 'Signed in as ' + (session.user.email || '');
  if (k === 'look')
    return `${{ '': 'Colours match the system', light: 'Light', dark: 'Dark' }[look.theme || ''] || 'Light'} · ${look.font === 'large' ? 'larger text' : 'standard text'} · ${thisDevice.name || 'this device'}`;
  if (k === 'tags') return S.tags.map(x => x.name).join(', ') || 'None yet';
  if (k === 'rules') {
    const on = S.rules.filter(r => r.enabled).length;
    return S.rules.length
      ? `${plural(S.rules.length, 'rule')}, ${on} on`
      : 'When something happens, do one thing';
  }
  if (k === 'auto')
    return `Result tracking ${sb && session ? (S.track ? 'on' : 'off') : 'needs signing in'} · shortcuts and deep links${sb && session ? ' · notifications · capture link' : ''}`;
  if (k === 'backup') return 'Save everything to a file, or restore from one';
  if (k === 'health') return 'Check the app, sync and notifications';
  return '';
}
function renderAccount() {
  if (!SET_GROUPS.some(g => g[0] === setSub)) setSub = null;
  let h = '';
  // A restore waiting for its answer shows wherever Settings is.
  if (pending)
    h += `<div class="banner box"><p>Replace everything with this backup? It has ${plural(pending.quests.length, 'task')} and ${plural((pending.inbox || []).length, 'inbox item')}. Your current data${session ? ' on every synced device' : ''} will be replaced (notification keys and device names are kept).</p><div class="acts"><button class="btn pink" id="doRestore">Replace</button><button class="btn" id="noRestore">Cancel</button></div></div>`;
  if (!setSub) {
    h += `<h2 class="kbtitle">Settings</h2><div class="list box setlist">${SET_GROUPS.map(
      ([k, label]) =>
        `<div class="row"><button class="open" data-setgo="${k}"><span>${label}</span><small>${esc(setGroupLine(k))}</small></button><span class="chev" aria-hidden="true">${chevron}</span></div>`,
    ).join('')}</div>`;
    setHTML($('#v-account'), h);
    return;
  }
  const title = SET_GROUPS.find(g => g[0] === setSub)[1];
  h += `<button class="linkbtn" data-setback="1">‹ Settings</button>`;
  // (Rules and Health check are one section each: their own heading is the page's)
  if (setSub !== 'rules' && setSub !== 'health') h += `<h2 class="kbtitle">${title}</h2>`;
  if (setSub === 'sync') {
    h += '<span id="syncsec"></span>';
    if (!sb) {
      h +=
        CFG.supabaseUrl && !window.supabase
          ? '<p class="hint">The sync library didn\'t load (offline, or blocked). Reload once online.</p>'
          : '<p class="hint">Sync isn\'t set up (see the README). Data is saved on this device only.</p>';
    } else if (!session) {
      h += `<form id="authform"><label class="f" for="aemail">Email</label><input class="fld" id="aemail" type="email" autocomplete="email" required><label class="f" for="apass">Password</label><input class="fld" id="apass" type="password" autocomplete="current-password" required><div class="acts"><button class="btn green">Sign in</button><button class="btn" type="button" id="signup">Create account</button></div></form>${authMsg ? `<p class="msg">${esc(authMsg)}</p>` : ''}`;
    } else {
      h += `<div class="node box"><p style="margin:0 0 6px">Signed in as <b>${esc(session.user.email || '')}</b></p><p class="hint" style="margin:0">${syncLine()}</p>${syncStatsLine()}<div class="acts"><button class="btn blue" id="syncNow">Sync now</button><button class="btn" id="signout">Sign out</button></div></div><h2 style="margin-top:26px">Previous versions</h2>${renderHistory()}`;
    }
  }
  const opt = (k, v, label) =>
    `<button class="chip" data-look="${k}" data-val="${v}" aria-pressed="${(look[k] || '') === v}">${label}</button>`;
  if (setSub === 'look')
    h += `<p class="hint" id="looksec" style="margin:0 0 6px">This device only.</p>
    <p class="f" id="lookthemel">Colours</p><div class="chips" role="group" aria-labelledby="lookthemel">${opt('theme', '', 'Match system')}${opt('theme', 'light', 'Light')}${opt('theme', 'dark', 'Dark')}</div>
    <p class="f" id="looksizel">Text size</p><div class="chips" role="group" aria-labelledby="looksizel">${opt('font', '', 'Standard')}${opt('font', 'large', 'Larger')}</div>

    <label class="f" for="devname">This device's name (to choose where an alarm rings)</label><input class="fld" id="devname" value="${esc(thisDevice.name)}" maxlength="40" style="max-width:20em">${renderDevices()}`;
  if (setSub === 'tags') {
    h += '<p class="hint" id="tagsec">Tags group tasks by kind of work; a task has one at most.</p>';
    S.tags.forEach(
      (t, i) =>
        (h += `<div class="tagrow"><span class="sw" style="background:${t.color}"></span><input class="fld" data-tagname="${i}" value="${esc(t.name)}" maxlength="20" aria-label="Tag name"><button class="x" data-deltag="${i}" aria-label="Delete tag ${esc(t.name)}">×</button></div>`),
    );
    h +=
      '<form class="addrow" id="tagform" style="margin-top:12px"><input id="tagin" maxlength="20" placeholder="New tag" aria-label="New tag" autocomplete="off"><button class="btn">Add</button></form>';
  }
  if (setSub === 'backup')
    h +=
      '<p class="hint" id="backupsec">A backup is one file with everything. Restoring replaces tasks, inbox, notes, alarms and history, and asks first.</p><div class="acts"><button class="btn" id="exp">Save backup</button><button class="btn" id="impbtn">Restore backup</button><input type="file" id="imp" accept=".json,application/json" hidden aria-hidden="true"></div>';
  if (setSub === 'rules') h += renderRuleSettings().replace(/^<h2 style="margin-top:26px"/, '<h2');
  if (setSub === 'auto') {
    if (sb && session) h += renderExecSettings();
    else
      h +=
        '<h2 id="execsec">Automation result tracking</h2><p class="hint">Sign in (Sync and account) to let your automations report their results.</p>';
    if (sb && session) h += renderNotifySettings() + renderCapture();
    h += `<span id="shortsec"></span>${renderShortcuts()}`;
  }
  if (setSub === 'health') h += renderHealth().replace(/^<h2 style="margin-top:26px"/, '<h2');
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

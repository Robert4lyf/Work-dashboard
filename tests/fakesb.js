// A stand-in for Supabase shared by several "devices" (browser contexts), as in sync.spec.js, with
// Release G's server side too: cockpit_put_wrun (supabase/release-g-runs.sql) with the same rules,
// checked revision, op ids applied once, the same answers, and the guard on ordinary upserts of
// 'wrun:' rows, and release-h.sql's report pairing and probe (cockpit_sync_checks; `srv.checksFn
// = false`: release-h.sql not run). `srv.wrunFn = false` is a project without the migration (PostgREST's "no such
// function", and no guard; `srv.guard = true` with it: the guard without the function, as a stale
// schema cache or a partial rollback leaves it). `srv.dropAnswers = n`: the next n accepted
// changes are applied but their answers lost, as on a connection that drops. `srv.beforeAnswer`:
// an async function run after a change is applied and before its answer goes back (the page
// waiting on it can act meanwhile).
const { expect } = require('@playwright/test');

function fakeSupabase() {
  const query = table => {
    const q = { table, filters: {} };
    const api = {
      select(cols) {
        q.cols = cols;
        return api;
      },
      in(k, vals) {
        q.keys = vals;
        return api;
      },
      eq(k, v) {
        q.filters[k] = v;
        return api;
      },
      gt(k, v) {
        q.gt = v;
        return api;
      },
      not() {
        return api;
      },
      is() {
        return api;
      },
      lt() {
        return api;
      },
      order() {
        return api;
      },
      limit(n) {
        q.limit = n;
        return api;
      },
      maybeSingle: async () => ({ data: await window.srvState(), error: null }),
      upsert: rows => {
        const done =
          table === 'cockpit_state'
            ? window.srvSnapshot(rows).then(() => [])
            : window.srvUpsert(Array.isArray(rows) ? rows : [rows]);
        return {
          select: async () => ({ data: await done, error: null }),
          then: (a, b) => done.then(() => ({ error: null })).then(a, b),
        };
      },
      then(res, rej) {
        if (table === 'cockpit_exec_events')
          return window
            .srvExecRows(q.gt || 0)
            .then(data => ({ data, error: null }))
            .then(res, rej);
        if (table !== 'cockpit_items') return Promise.resolve({ data: [], error: null }).then(res, rej);
        return window
          .srvRows(q.gt || 0, q.limit || 1000, q.cols || '', q.keys || null)
          .then(data => ({ data, error: null }))
          .then(res, rej);
      },
    };
    return api;
  };
  window.supabase = {
    createClient: () => ({
      auth: {
        onAuthStateChange(cb) {
          setTimeout(() => cb('INITIAL_SESSION', { user: { id: 'u1', email: 'me@example.com' } }), 0);
          return { data: { subscription: { unsubscribe() {} } } };
        },
        signOut: async () => ({}),
      },
      from: query,
      channel() {
        const ch = {
          on(_type, _filter, cb) {
            window.__live = cb;
            return ch;
          },
          subscribe(cb) {
            if (cb) cb('SUBSCRIBED');
            return ch;
          },
        };
        return ch;
      },
      removeChannel() {},
      // (answers as supabase-js gives them: data, error, status)
      rpc: async (name, args) => {
        if (!navigator.onLine)
          return { data: null, error: { message: 'TypeError: Failed to fetch', code: '' }, status: 0 };
        const r = await window.srvRpc(name, args || null);
        if (r && r.missing)
          return {
            data: null,
            error: {
              code: 'PGRST202',
              message: `Could not find the function public.${name} in the schema cache`,
            },
            status: 404,
          };
        if (r && r.lost)
          return { data: null, error: { message: 'TypeError: Failed to fetch', code: '' }, status: 0 };
        return r && r.error
          ? { data: null, error: { message: r.error, code: r.code || '' }, status: r.status || 400 }
          : { data: r, error: null, status: 200 };
      },
    }),
  };
}

function execReport(srv, a) {
  if (!a || a.token !== srv.xtoken) return { error: 'unknown execution token' };
  if (!/^[\w-]{1,40}$/.test(a.flow || '')) return { error: "flow must be the flow's id" };
  if (!['running', 'succeeded', 'failed', 'cancelled'].includes(a.status))
    return { error: 'status must be running, succeeded, failed or cancelled' };
  srv.events = srv.events || [];
  let x = a.execution || '';
  // (as supabase-setup.sql since Release H: a named execution only if it is that flow's; else the
  // run_ref's; else, naming none, the launch waiting to hear only when exactly ONE is, set aside or
  // not; with none or several, unpaired)
  const named = !!x,
    row = named && srv.rows.get('exec:' + x);
  if (named && (!row || row.deleted || !row.data || row.data.id !== x || row.data.flow !== a.flow)) x = '';
  if (!x && a.run_ref) {
    const first = srv.events.find(e => e.flow === a.flow && e.run_ref === a.run_ref);
    if (first) x = first.execution || 'u' + first.id;
  }
  if (!x && !named) {
    const done = new Set(
      srv.events.filter(e => ['succeeded', 'failed', 'cancelled'].includes(e.status)).map(e => e.execution),
    );
    const open = [...srv.rows.values()].filter(
      r =>
        r.key.startsWith('exec:') &&
        !r.deleted &&
        r.data.flow === a.flow &&
        ['requested', 'running'].includes(r.data.status) &&
        r.data.at > Date.now() - 864e5 &&
        !done.has(r.data.id),
    );
    x = open.length === 1 ? open[0].data.id : '';
  }
  const ev = {
    id: ++srv.seq,
    execution: x,
    flow: a.flow,
    status: a.status,
    message: String(a.message || '').slice(0, 300),
    run_ref: a.run_ref || '',
    reported_at: a.at || new Date().toISOString(),
  };
  srv.events.push(ev);
  live(srv, null);
  return { execution: x, event: ev.id };
}
// Postgres jsonb does not keep key order: it stores shorter keys first, then sorts by bytes.
function jsonb(v) {
  if (Array.isArray(v)) return v.map(jsonb);
  if (!v || typeof v !== 'object') return v;
  const o = {};
  Object.keys(v)
    .sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0))
    .forEach(k => (o[k] = jsonb(v[k])));
  return o;
}
const revOf = d => (d && Number.isInteger(d.rev) && d.rev > 0 && d.rev < 1e9 ? d.rev : 0);
function jsonbText(v) {
  if (Array.isArray(v)) return '[' + v.map(jsonbText).join(', ') + ']';
  if (v && typeof v === 'object')
    return (
      '{' +
      Object.keys(v)
        .map(k => JSON.stringify(k) + ': ' + jsonbText(v[k]))
        .join(', ') +
      '}'
    );
  return JSON.stringify(v);
}
// Tell the other devices, like Supabase Realtime would.
function live(srv, page) {
  srv.devices
    .filter(d => d.page !== page)
    .forEach(d => d.page.evaluate(() => window.__live && window.__live()).catch(() => {}));
}
// What cockpit_put_wrun does (see supabase/release-g-runs.sql).
async function putWrun(srv, a, page) {
  if (!srv.wrunFn) return { missing: true };
  srv.puts.push({ ...a });
  const bad = m => ({ error: m, code: '22023', status: 400 });
  if (!a || !/^wrun:[\w-]{1,40}$/.test(a.p_key || '')) return bad('key must be wrun:<run id>');
  if (!/^[\w-]{8,64}$/.test(a.p_op || '')) return bad('op must be 8 to 64 letters, digits, _ or -');
  if (!Number.isInteger(a.p_base_rev) || a.p_base_rev < 0 || a.p_base_rev >= 999999999)
    return bad('base revision out of range');
  const id = a.p_key.slice(5),
    rev = a.p_base_rev + 1,
    d = a.p_data;
  if (d !== null) {
    if (!d || typeof d !== 'object' || Array.isArray(d)) return bad('data must be an object');
    // (PostgreSQL measures the jsonb text, ", " and ": " between, in bytes)
    if (Buffer.byteLength(jsonbText(d)) > 262144) return bad('run too large (at most 256 KB)');
    if (d.id !== id) return bad("data must keep the run's id");
    if (d.rev !== rev) return bad('rev must be the base revision + 1');
  }
  const cur = srv.rows.get(a.p_key),
    stored = {
      data: cur ? cur.data : null,
      deleted: cur ? cur.deleted : false,
      seq: cur ? cur.seq : null,
      edited_at: cur ? cur.edited_at : null,
    },
    crev = revOf(stored.data),
    done = srv.ops.get(a.p_op);
  if (done) {
    if (done.key !== a.p_key) return bad('that op id was used for another run');
    return { status: 'duplicate', rev: done.rev, cur_rev: crev, ...stored };
  }
  if (crev !== a.p_base_rev) return { status: 'conflict', rev: crev, ...stored };
  const edited_at = Math.max(Date.now(), ((cur && cur.edited_at) || 0) + 1);
  srv.rows.set(a.p_key, {
    key: a.p_key,
    kind: 'wrun',
    data: jsonb(d || { id, rev }),
    deleted: d === null,
    edited_at,
    seq: ++srv.seq,
  });
  srv.ops.set(a.p_op, { key: a.p_key, rev });
  srv.writes++;
  live(srv, page);
  if (srv.beforeAnswer) {
    const f = srv.beforeAnswer;
    srv.beforeAnswer = null;
    await f(page);
  }
  if (srv.dropAnswers > 0) {
    srv.dropAnswers--;
    return { lost: true };
  }
  return { status: 'accepted', rev, seq: srv.seq, edited_at };
}
function server() {
  return {
    rows: new Map(),
    seq: 0,
    state: null,
    devices: [],
    snapshots: 0,
    writes: 0,
    ops: new Map(),
    puts: [],
    wrunFn: true,
    dropAnswers: 0,
    refused: [],
  };
}
async function device(browser, srv, seed, opts = {}) {
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route(
    u => !u.href.startsWith('http://localhost'),
    r => r.abort(),
  );
  await page.exposeFunction('srvRows', (gt, limit, cols, keys) => {
    const rows = [...srv.rows.values()]
      .filter(r => (keys ? keys.includes(r.key) : r.seq > gt))
      .sort((a, b) => a.seq - b.seq)
      .slice(0, limit);
    if (cols && !cols.split(',').includes('data')) return rows.map(({ data, ...r }) => r);
    return rows;
  });
  await page.exposeFunction('srvUpsert', rows => {
    srv.writes += rows.length;
    const wrote = [];
    rows.forEach(r => {
      const old = srv.rows.get(r.key);
      // (as the server's trigger does: an older edit arriving later is dropped)
      if (old && r.edited_at < old.edited_at) return;
      // (and, with Release G's SQL, a run can't be written back to an older revision)
      // (the next revision only; a finished run tidied away keeps the next one in its tombstone)
      let data = r.data;
      if ((srv.guard !== undefined ? srv.guard : srv.wrunFn) && old && r.key.startsWith('wrun:')) {
        const o = revOf(old.data),
          tidy = r.deleted && !old.deleted && ['succeeded', 'cancelled'].includes((old.data || {}).status);
        if (tidy) data = { id: old.data.id, rev: o + 1 };
        else if (revOf(r.data) !== o + 1) return srv.refused.push(r.key);
      }
      srv.rows.set(r.key, { ...r, data: jsonb(data), seq: ++srv.seq });
      wrote.push({ key: r.key, seq: srv.seq });
    });
    live(srv, page);
    return wrote;
  });
  await page.exposeFunction('srvState', () => srv.state);
  await page.exposeFunction('srvRpc', (name, args) => {
    if (name === 'cockpit_new_exec_token') return (srv.xtoken = 'xtok' + ++srv.seq);
    if (name === 'cockpit_exec_report') return execReport(srv, args);
    if (name === 'cockpit_put_wrun') return putWrun(srv, args, page);
    // (release-h.sql's probe; `srv.checksFn = false`: a project without release-h.sql)
    if (name === 'cockpit_sync_checks') {
      srv.probes = (srv.probes || 0) + 1;
      if (srv.checksFn === false) return { missing: true };
      const guard = srv.guard !== undefined ? srv.guard : srv.wrunFn;
      return { release: 'h', put_wrun: !!srv.wrunFn, guard: !!guard, guard_fn: !!guard };
    }
    return null;
  });
  await page.exposeFunction('srvExecRows', gt => (srv.events || []).filter(e => e.id > gt));
  await page.exposeFunction('srvSnapshot', row => {
    srv.state = { data: row.data, edited_at: row.edited_at };
    srv.snapshots++;
  });
  if (seed) await page.addInitScript(s => localStorage.setItem('work-cockpit-v1', s), JSON.stringify(seed));
  await page.addInitScript(fakeSupabase);
  // (a flow's link would hand the page to another app: the tap is still seen by the app)
  await page.addInitScript(() =>
    addEventListener('click', e => {
      const a = e.target.closest && e.target.closest('a[href^="ms-powerautomate:"]');
      if (a) e.preventDefault();
    }),
  );
  // Every toast, to check what was said (and how often).
  await page.addInitScript(() => {
    window.__toasts = [];
    addEventListener('DOMContentLoaded', () => {
      const t = window.toast;
      if (typeof t === 'function')
        window.toast = (...a) => {
          window.__toasts.push(String(a[0]));
          return t(...a);
        };
    });
  });
  const reload = page.reload.bind(page);
  page.reload = async (...a) => {
    await page.evaluate(() => (typeof storeDone === 'function' ? storeDone() : null)).catch(() => {});
    const r = await reload(...a);
    await page.waitForFunction(() => window.appReady === true);
    return r;
  };
  await page.goto('/');
  await expect(page.locator('#syncBtn')).toHaveText('Synced');
  const d = {
    page,
    ctx,
    errors,
    state: () => page.evaluate(() => JSON.parse(JSON.stringify(S))),
    run: id => page.evaluate(id => JSON.parse(JSON.stringify(wrunById(id))), id),
    sync: () =>
      page.evaluate(async () => {
        await sync();
        while (syncing || again) await new Promise(r => setTimeout(r, 20));
      }),
    offline: v => ctx.setOffline(v),
    toasts: () => page.evaluate(() => window.__toasts.slice()),
  };
  srv.devices.push(d);
  return d;
}
const settle = async (...ds) => {
  for (let i = 0; i < 2; i++) for (const d of ds) await d.sync();
};
const report = (d, args) => d.page.evaluate(a => sb.rpc('cockpit_exec_report', a), args);

module.exports = { server, device, settle, report, jsonb, revOf, jsonbText };

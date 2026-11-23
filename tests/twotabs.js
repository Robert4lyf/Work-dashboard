// Two (or more) tabs of one device: pages in the SAME browser context, each with the fake
// Supabase, one shared session. Also other "devices" (other contexts) on the same fake server.
const { expect } = require('@playwright/test');

function fakeSupabase() {
  const user = () => {
    let u = 'u1';
    try {
      const v = localStorage.getItem('zz-user');
      if (v !== null) u = v;
    } catch (e) {}
    return u;
  };
  window.__uid = user;
  const sess = () => (user() ? { user: { id: user(), email: user() + '@example.com' } } : null);
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
      not: () => api,
      is: () => api,
      lt: () => api,
      order: () => api,
      delete: () => api,
      limit(n) {
        q.limit = n;
        return api;
      },
      maybeSingle: async () => ({ data: await window.srvState(user()), error: null }),
      upsert: rows => {
        const fail = () => ({ data: null, error: { message: 'TypeError: Failed to fetch' } });
        const done =
          table === 'cockpit_state'
            ? window.srvSnapshot(user(), rows).then(() => [])
            : window.srvUpsert(user(), Array.isArray(rows) ? rows : [rows]);
        return {
          select: async () => {
            const d = await done;
            return d === 'FAIL' ? fail() : { data: d, error: null };
          },
          then: (a, b) => done.then(d => (d === 'FAIL' ? fail() : { error: null })).then(a, b),
        };
      },
      then(res, rej) {
        if (table === 'cockpit_exec_events') return Promise.resolve({ data: [], error: null }).then(res, rej);
        if (table !== 'cockpit_items') return Promise.resolve({ data: [], error: null }).then(res, rej);
        return window
          .srvRows(user(), q.gt || 0, q.limit || 1000, q.cols || '', q.keys || null)
          .then(data =>
            data === 'FAIL'
              ? { data: null, error: { message: 'TypeError: Failed to fetch' } }
              : { data, error: null },
          )
          .then(res, rej);
      },
    };
    return api;
  };
  window.supabase = {
    createClient: () => ({
      auth: {
        onAuthStateChange(cb) {
          window.__auth = cb;
          setTimeout(() => cb('INITIAL_SESSION', sess()), 0);
          return { data: { subscription: { unsubscribe() {} } } };
        },
        signOut: async () => {
          localStorage.setItem('zz-user', '');
          window.__auth && window.__auth('SIGNED_OUT', null);
          return {};
        },
        signInWithPassword: async ({ email }) => {
          localStorage.setItem('zz-user', email.split('@')[0]);
          window.__auth && window.__auth('SIGNED_IN', sess());
          return { error: null };
        },
      },
      from: query,
      channel() {
        const ch = {
          on(_t, _f, cb) {
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
      rpc: async name => {
        if (name === 'cockpit_sync_checks')
          return { data: { release: 'h', put_wrun: false, guard: false }, error: null, status: 200 };
        return {
          data: null,
          error: { code: 'PGRST202', message: 'no such function ' + name },
          status: 404,
        };
      },
    }),
  };
}
function jsonb(v) {
  if (Array.isArray(v)) return v.map(jsonb);
  if (!v || typeof v !== 'object') return v;
  const o = {};
  Object.keys(v)
    .sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0))
    .forEach(k => (o[k] = jsonb(v[k])));
  return o;
}
// srv.rows: Map "<uid>|<key>" -> row. srv.upserts: every row sent, with the tab that sent it.
// srv.delay: ms each request takes; srv.fail: requests fail (server down); srv.gate: a promise
// each upsert waits on.
function server() {
  return { rows: new Map(), seq: 0, state: null, tabs: [], upserts: [], pulls: 0, delay: 0, fail: false };
}
const rowsOf = (srv, uid = 'u1') => [...srv.rows.values()].filter(r => r.user_id === uid);
const live = (srv, page, uid) =>
  srv.tabs
    .filter(t => t.page !== page && !t.page.isClosed())
    .forEach(t =>
      t.page.evaluate(u => window.__live && window.__uid() === u && window.__live(), uid).catch(() => {}),
    );
const wait = ms => new Promise(r => setTimeout(r, ms));
async function context(browser, srv, opts = {}) {
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  await ctx.route(
    u => !u.href.startsWith('http://localhost'),
    r => r.abort(),
  );
  const tabOf = page => srv.tabs.find(t => t.page === page);
  await ctx.exposeBinding('srvRows', async ({ page }, uid, gt, limit, cols, keys) => {
    if (srv.delay) await wait(srv.delay);
    if (srv.fail) return 'FAIL';
    srv.pulls++;
    const rows = rowsOf(srv, uid)
      .filter(r => (keys ? keys.includes(r.key) : r.seq > gt))
      .sort((a, b) => a.seq - b.seq)
      .slice(0, limit);
    if (cols && !cols.split(',').includes('data')) return rows.map(({ data, ...r }) => r);
    return rows;
  });
  await ctx.exposeBinding('srvUpsert', async ({ page }, uid, rows) => {
    if (srv.delay) await wait(srv.delay);
    if (srv.gate) await srv.gate;
    if (srv.fail) return 'FAIL';
    const wrote = [];
    const t = tabOf(page);
    rows.forEach(r => {
      srv.upserts.push({
        tab: t ? t.name : '?',
        uid,
        user_id: r.user_id,
        key: r.key,
        deleted: r.deleted,
        edited_at: r.edited_at,
        data: r.data,
      });
      const id = r.user_id + '|' + r.key,
        old = srv.rows.get(id);
      if (old && r.edited_at < old.edited_at) return;
      srv.rows.set(id, { ...r, data: jsonb(r.data), seq: ++srv.seq });
      wrote.push({ key: r.key, seq: srv.seq });
    });
    live(srv, page, uid);
    return wrote;
  });
  await ctx.exposeBinding('srvState', ({}, uid) => (srv.states || {})[uid] || null);
  await ctx.exposeBinding('srvSnapshot', ({}, uid, row) => {
    (srv.states = srv.states || {})[uid] = { data: row.data, edited_at: row.edited_at };
  });
  if (opts.seed)
    await ctx.addInitScript(s => {
      if (!localStorage.getItem('zz-seeded')) {
        localStorage.setItem('work-cockpit-v1', s);
        localStorage.setItem('zz-seeded', '1');
      }
    }, JSON.stringify(opts.seed));
  if (opts.noIdb)
    await ctx.addInitScript(() => {
      Object.defineProperty(window, 'indexedDB', {
        get() {
          throw new Error('no idb');
        },
      });
    });
  if (opts.syncOff) await ctx.addInitScript(() => (window.supabase = undefined));
  else await ctx.addInitScript(fakeSupabase);
  await ctx.addInitScript(() => {
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
  ctx.__srv = srv;
  ctx.__opts = opts;
  return ctx;
}
// A tab in that context. `name` labels its upserts in srv.upserts.
async function tab(ctx, name, o = {}) {
  const srv = ctx.__srv,
    page = await ctx.newPage(),
    errors = [];
  page.on('pageerror', e => errors.push(e.message));
  if (o.clock) await page.clock.install({ time: o.clock });
  const t = {
    name,
    page,
    ctx,
    errors,
    state: () => page.evaluate(() => JSON.parse(JSON.stringify(S))),
    sync2: () => page.evaluate(() => JSON.parse(JSON.stringify(sync2))),
    sync: () =>
      page.evaluate(async () => {
        await sync();
        while (syncing || again) await new Promise(r => setTimeout(r, 20));
      }),
    // nothing syncing, nothing being written, nothing being taken in from another tab
    idle: () =>
      page.evaluate(async () => {
        for (let i = 0; i < 400; i++) {
          if (!syncing && !again && !tabTaking) {
            await storeDone();
            await new Promise(r => setTimeout(r, 30));
            if (!syncing && !again && !tabTaking) return true;
          }
          await new Promise(r => setTimeout(r, 25));
        }
        return false;
      }),
    toasts: () => page.evaluate(() => window.__toasts.slice()),
    inbox: () => page.evaluate(() => S.inbox.map(i => i.text)),
    add: text =>
      page.evaluate(t => {
        S.inbox.unshift({ id: uid(), text: t });
        save();
        renderAll();
      }, text),
  };
  srv.tabs.push(t);
  await page.goto(o.url || '/');
  await page.waitForFunction(() => window.appReady === true);
  if (!ctx.__opts.syncOff && o.synced !== false) await expect(page.locator('#syncBtn')).toHaveText('Synced');
  return t;
}
// Everything settles: each tab's pending push (1.2s debounce) and realtime-triggered sync (0.3s).
async function quiet(srv, ...tabs) {
  let last = -1;
  for (let i = 0; i < 40; i++) {
    await wait(700);
    for (const t of tabs) if (!t.page.isClosed()) await t.idle();
    const sig = srv.seq + ':' + srv.upserts.length + ':' + srv.pulls;
    if (sig === last && i > 2) return;
    last = sig;
  }
}
const pushes = (srv, pred = () => true) => {
  const m = {};
  srv.upserts.filter(pred).forEach(u => (m[u.key] = (m[u.key] || 0) + 1));
  return m;
};
module.exports = { server, context, tab, quiet, pushes, rowsOf, wait, expect };

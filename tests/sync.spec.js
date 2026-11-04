const { test, expect } = require('@playwright/test');
const { unfold } = require('./fixtures');

// A stand-in for Supabase, shared by several "devices" (browser contexts): the cockpit_items rows
// live in the test, and each page reaches them through exposed functions. Supports the calls the
// app makes, plus live-update notifications to every other device after a write.
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
      // (like the real client: awaited as is, or with .select() for the rows written)
      upsert: (rows, opts) => {
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
      rpc: async (name, args) => {
        const r = await window.srvRpc(name, args || null);
        return r && r.error ? { data: null, error: { message: r.error } } : { data: r, error: null };
      },
    }),
  };
}

// What cockpit_exec_report does (see supabase-setup.sql): checks the token, pairs the report
// with an execution (the caller's, the run_ref's, or the newest open launch of the flow), and
// keeps it as a row other devices hear about.
function execReport(srv, a, from) {
  if (!a || a.token !== srv.xtoken) return { error: 'unknown execution token' };
  if (!/^[\w-]{1,40}$/.test(a.flow || '')) return { error: "flow must be the flow's id" };
  if (!['running', 'succeeded', 'failed', 'cancelled'].includes(a.status))
    return { error: 'status must be running, succeeded, failed or cancelled' };
  srv.events = srv.events || [];
  let x = a.execution || '';
  if (!x && a.run_ref) {
    const first = srv.events.find(e => e.flow === a.flow && e.run_ref === a.run_ref);
    if (first) x = first.execution || 'u' + first.id;
  }
  if (!x) {
    const open = [...srv.rows.values()]
      .filter(
        r =>
          r.key.startsWith('exec:') &&
          !r.deleted &&
          r.data.flow === a.flow &&
          ['requested', 'running'].includes(r.data.status),
      )
      .sort((p, q) => q.data.at - p.data.at)[0];
    x = open ? open.data.id : '';
  }
  const ev = {
    id: ++srv.seq,
    execution: x,
    flow: a.flow,
    status: a.status,
    message: String(a.message || '').slice(0, 300),
    run_ref: a.run_ref || '',
    reported_at: new Date().toISOString(),
  };
  srv.events.push(ev);
  srv.devices.forEach(d => d.page.evaluate(() => window.__live && window.__live()).catch(() => {}));
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
function server() {
  return { rows: new Map(), seq: 0, state: null, devices: [], snapshots: 0, writes: 0 };
}
// Service workers are blocked: the app's worker would fetch and cache the real Supabase library,
// which bypasses page.route and would replace the fake after a reload.
async function device(browser, srv, seed, opts = {}) {
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route(
    u => !u.href.startsWith('http://localhost'),
    r => r.abort(),
  );
  // (what's asked for: by key or after a seq; without the data unless it's selected, and the
  // data sent counted, to check what a sync downloads)
  await page.exposeFunction('srvRows', (gt, limit, cols, keys) => {
    // (a test can have other writes land between a sync's list and its fetch)
    if (keys && srv.onFetch) {
      const f = srv.onFetch;
      srv.onFetch = null;
      f();
    }
    const rows = [...srv.rows.values()]
      .filter(r => (keys ? keys.includes(r.key) : r.seq > gt))
      .sort((a, b) => a.seq - b.seq)
      .slice(0, limit);
    if (cols && !cols.split(',').includes('data')) return rows.map(({ data, ...r }) => r);
    srv.dataRead = (srv.dataRead || 0) + rows.filter(r => r.data).length;
    srv.readKeys = [...(srv.readKeys || []), ...rows.filter(r => r.data).map(r => r.key)];
    return rows;
  });
  await page.exposeFunction('srvUpsert', rows => {
    srv.writes += rows.length;
    const wrote = [];
    rows.forEach(r => {
      // (as the server's trigger does: an older edit arriving later is dropped)
      const old = srv.rows.get(r.key);
      if (old && r.edited_at < old.edited_at) return;
      srv.rows.set(r.key, { ...r, data: jsonb(r.data), seq: ++srv.seq });
      wrote.push({ key: r.key, seq: srv.seq });
    });
    // Tell the other devices, like Supabase Realtime would.
    srv.devices
      .filter(d => d.page !== page)
      .forEach(d => d.page.evaluate(() => window.__live && window.__live()));
    return wrote;
  });
  await page.exposeFunction('srvState', () => srv.state);
  await page.exposeFunction('srvRpc', (name, args) => {
    if (name === 'cockpit_new_capture_token') return (srv.token = 'tok123');
    if (name === 'cockpit_new_exec_token') return (srv.xtoken = 'xtok' + ++srv.seq);
    if (name === 'cockpit_revoke_exec_token') return ((srv.xtoken = ''), true);
    if (name === 'cockpit_exec_report') return execReport(srv, args, page);
    return null;
  });
  await page.exposeFunction('srvExecRows', gt => (srv.events || []).filter(e => e.id > gt));
  // The capture endpoint, doing what the cockpit_capture database function does.
  await page.route('**/rest/v1/rpc/cockpit_capture', async r => {
    const body = r.request().postDataJSON();
    if (body.token !== srv.token) return r.fulfill({ status: 400, body: '{}' });
    const id = 'cap' + ++srv.seq;
    srv.rows.set('inbox:' + id, {
      key: 'inbox:' + id,
      data: { id, text: body.text },
      deleted: false,
      edited_at: Date.now(),
      seq: ++srv.seq,
    });
    r.fulfill({ status: 200, contentType: 'application/json', body: 'true' });
  });
  // The alert endpoint, doing what cockpit_alert does for to = 'inbox'.
  await page.route('**/rest/v1/rpc/cockpit_alert', async r => {
    const body = r.request().postDataJSON();
    if (body.token !== srv.token) return r.fulfill({ status: 400, body: '{}' });
    const id = 'alert' + ++srv.seq;
    srv.alerts = [...(srv.alerts || []), body];
    srv.rows.set('inbox:' + id, {
      key: 'inbox:' + id,
      data: { id, text: body.title },
      deleted: false,
      edited_at: Date.now(),
      seq: ++srv.seq,
    });
    r.fulfill({ status: 200, contentType: 'application/json', body: 'true' });
  });
  await page.exposeFunction('srvSnapshot', row => {
    srv.state = { data: row.data, edited_at: row.edited_at };
    srv.snapshots++;
  });
  if (opts.dialogs) page.on('dialog', d => (srv.asked = [...(srv.asked || []), d.message()]) && d.accept());
  if (opts.clockBehind)
    await page.addInitScript(ms => {
      const real = Date.now;
      Date.now = () => real() - ms;
    }, opts.clockBehind);
  if (seed) await page.addInitScript(s => localStorage.setItem('work-cockpit-v1', s), JSON.stringify(seed));
  await page.addInitScript(fakeSupabase);
  // (a reload waits for writes to the store, then for the app to have started)
  const reload = page.reload.bind(page);
  page.reload = async (...a) => {
    await page.evaluate(() => (window.storeDone ? storeDone() : null)).catch(() => {});
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
    state: () => page.evaluate(() => S),
    // Sync, then wait for any sync already running (or queued behind it) to finish.
    sync: () =>
      page.evaluate(async () => {
        await sync();
        while (syncing || again) await new Promise(r => setTimeout(r, 20));
      }),
    add: async text => {
      await page.click('nav [data-v=inbox]');
      await page.fill('#iin', text);
      await page.press('#iin', 'Enter');
      await page.click('#v-inbox [data-promote] >> nth=0');
      await page.click('nav [data-v=today]');
    },
  };
  srv.devices.push(d);
  return d;
}
const texts = s => s.quests.map(q => q.text).sort();
const settle = async (...ds) => {
  for (let i = 0; i < 2; i++) for (const d of ds) await d.sync();
};

test('each item is its own row, and changes reach the other device live', async ({ browser }) => {
  const srv = server();
  const a = await device(browser, srv);
  await a.add('Report');
  await a.sync();
  expect([...srv.rows.keys()].filter(k => k.startsWith('quest:'))).toHaveLength(1);
  const b = await device(browser, srv);
  expect(texts(await b.state())).toEqual(['Report']);

  // A change on A reaches B without B polling (live update, then a short debounce).
  await a.add('Email');
  await a.sync();
  await expect.poll(async () => texts(await b.state())).toEqual(['Email', 'Report']);
  // Only the changed rows travel: adding one task writes the task, the list order and the
  // inbox item it came from.
  const before = srv.seq;
  await a.add('Third');
  await a.sync();
  expect(srv.seq - before).toBeLessThanOrEqual(4);
  for (const d of [a, b]) expect(d.errors).toEqual([]);
});

test('once caught up, syncing sends nothing (the server may reorder JSON keys)', async ({ browser }) => {
  const srv = server();
  const a = await device(browser, srv);
  await a.add('Report');
  await a.page.evaluate(() => go('focus'));
  const b = await device(browser, srv);
  await settle(a, b);
  const before = srv.writes;
  await a.page.waitForTimeout(1500); // room for live updates and debounced syncs to loop
  await settle(a, b);
  expect(srv.writes - before).toBe(0);
  for (const d of [a, b]) await expect(d.page.locator('#syncBtn')).toHaveText('Synced');
});

test('offline edits to different items on two devices are all kept', async ({ browser }) => {
  const srv = server();
  const a = await device(browser, srv);
  await a.add('Shared');
  await a.sync();
  const b = await device(browser, srv);
  await a.ctx.setOffline(true);
  await b.ctx.setOffline(true);
  await a.add('From A');
  await b.add('From B');
  await b.page.click('[aria-label="Mark done: Shared"]');
  await a.ctx.setOffline(false);
  await b.ctx.setOffline(false);
  await settle(a, b);
  for (const d of [a, b]) {
    const s = await d.state();
    expect(texts(s)).toEqual(['From A', 'From B', 'Shared']);
    expect(s.quests.find(q => q.text === 'Shared').done).toBe(true);
  }
});

test('the same item edited on both devices: the newer edit wins', async ({ browser }) => {
  const srv = server();
  const a = await device(browser, srv);
  await a.add('Draft');
  await a.sync();
  const b = await device(browser, srv);
  await a.ctx.setOffline(true);
  await b.ctx.setOffline(true);
  const rename = (d, t) =>
    d.page.evaluate(t => {
      S.quests[0].text = t;
      save();
    }, t);
  await rename(a, 'Older edit');
  await a.page.waitForTimeout(20);
  await rename(b, 'Newer edit');
  await b.ctx.setOffline(false);
  await b.sync();
  await a.ctx.setOffline(false);
  await settle(a, b);
  for (const d of [a, b]) expect(texts(await d.state())).toEqual(['Newer edit']);
});

test('deletions reach other devices', async ({ browser }) => {
  const srv = server();
  const a = await device(browser, srv);
  await a.add('Keep');
  await a.add('Remove me');
  await a.sync();
  const b = await device(browser, srv);
  await a.page.click('[aria-label="Actions: Remove me"]');
  await a.page.click('#sheet [data-delnow]');
  await settle(a, b);
  expect(texts(await b.state())).toEqual(['Keep']);
  expect(srv.rows.get([...srv.rows.keys()].find(k => srv.rows.get(k).deleted)).deleted).toBe(true);
});

test('focus time from two devices on the same day adds up', async ({ browser }) => {
  const srv = server();
  const a = await device(browser, srv);
  const b = await device(browser, srv);
  const log = (d, mins, t) => d.page.evaluate(([m, t]) => (logSession('', m, t, null), save()), [mins, t]);
  const t = new Date(2026, 8, 23, 10).getTime();
  await log(a, 10, t);
  await log(b, 5, t + 3600e3);
  await settle(a, b);
  for (const d of [a, b]) expect((await d.state()).daily['2026-09-23']['']).toBe(15);
});

test('the first device to update moves the old single-copy data over', async ({ browser }) => {
  const srv = server();
  srv.state = {
    edited_at: 5,
    data: {
      quests: [{ id: 'q1', text: 'From old sync', children: [] }],
      daily: { '2026-01-02': { Design: 30 } },
    },
  };
  const a = await device(browser, srv);
  const s = await a.state();
  expect(texts(s)).toEqual(['From old sync']);
  // Older focus totals without sessions are kept.
  expect(s.daily['2026-01-02'].Design).toBe(30);
  expect(srv.rows.has('quest:q1')).toBe(true);
  expect(srv.snapshots).toBeGreaterThan(0);
  // A second device takes the rows, not its own stale local copy.
  const b = await device(browser, srv, { quests: [{ id: 'old', text: 'Stale local', children: [] }] });
  expect(texts(await b.state())).toEqual(['From old sync']);
});

test('daily repeats created on two devices are not doubled', async ({ browser }) => {
  const srv = server();
  const a = await device(browser, srv);
  await a.add('Standup');
  await a.page.click('.open >> text=Standup');
  await a.page.click('#mored > summary');
  await a.page.click('#rptd summary');
  await a.page.click('[data-rpreset="daily"]');
  await a.page.click('[aria-label="Mark done: Standup"]');
  await a.sync();
  // All that happened yesterday (the daily reset's changes count as of midnight).
  srv.rows.forEach(r => (r.edited_at = Number(r.edited_at) - 86400e3));
  const b = await device(browser, srv);
  // Next morning both devices run the daily reset before hearing from each other.
  for (const d of [a, b])
    await d.page.evaluate(() => {
      S.day = shift(today(), -1);
      rollover();
    });
  await settle(a, b);
  for (const d of [a, b]) expect(texts(await d.state())).toEqual(['Standup']);
});

test('capture: create a link, and items sent to it land in the inbox', async ({ browser }) => {
  const srv = server();
  const a = await device(browser, srv);
  await a.page.click('nav [data-v=account]');
  await a.page.evaluate(() => (document.querySelector('#advd').open = true)); // (Advanced, idempotent)
  await a.page.click('#capnew');
  await expect(a.page.locator('#capsetup .caprow code').nth(3)).toHaveText('tok123');
  await a.page.click('#captest');
  await expect
    .poll(async () => (await a.state()).inbox.map(i => i.text))
    .toEqual(['Test capture from Settings']);
  // Test alert: what a script would send, landing in the inbox too.
  await a.page.click('#alerttest');
  await expect
    .poll(async () => (await a.state()).inbox.map(i => i.text))
    .toEqual(['Test alert', 'Test capture from Settings']);
  expect(srv.alerts).toEqual([
    { token: 'tok123', title: 'Test alert', body: 'Sent from Settings', to: 'inbox' },
  ]);
  // The details survive a reload on this device, folded away until opened.
  await a.page.reload();
  await a.page.click('nav [data-v=account]');
  await a.page.evaluate(() => (document.querySelector('#advd').open = true)); // (Advanced, idempotent)
  await expect(a.page.locator('#capsetup .caprow').first()).toBeHidden();
  await a.page.click('#capsetup summary');
  await expect(a.page.locator('#capsetup .caprow code').nth(3)).toHaveText('tok123');
  expect(a.errors).toEqual([]);
});

test('health check, signed in: sync, live updates and optional parts', async ({ browser }) => {
  const srv = server();
  const a = await device(browser, srv);
  await a.page.click('nav [data-v=account]');
  await a.page.evaluate(() => (document.querySelector('#advd').open = true)); // (Advanced, idempotent)
  await a.page.click('#healthrun');
  const row = name => a.page.locator('.health .hrow2', { hasText: name });
  await expect(row('Signed in')).toHaveClass(/ok/);
  await expect(row('Sync table')).toHaveClass(/ok/);
  await expect(row('Last sync')).toHaveClass(/ok/);
  await expect(row('Live updates')).toContainText('Connected');
  expect(a.errors).toEqual([]);
});

test('the daily reset waits for the server: a task reopened elsewhere yesterday survives', async ({
  browser,
}) => {
  const srv = server();
  const a = await device(browser, srv);
  await a.add('Report');
  await a.page.click('[aria-label="Mark done: Report"]');
  await a.sync();
  const b = await device(browser, srv);
  // B adds a step to it later that day, so it's no longer done.
  await b.page.evaluate(() => {
    S.quests[0].children.push(fix({ id: 'c1', text: 'Proofread' }));
    S.quests[0].done = false;
    save();
  });
  await b.sync();
  srv.rows.forEach(r => (r.edited_at = Number(r.edited_at) - 86400e3)); // all of that was yesterday
  // Next morning A opens first, on yesterday's copy (B's change not yet pulled).
  await a.page.evaluate(() => {
    S.day = shift(today(), -1);
    persistLocal();
  });
  await a.page.evaluate(() => rolloverLocal());
  await settle(a, b);
  for (const d of [a, b]) expect(texts(await d.state())).toEqual(['Report']);
  expect((await b.state()).quests[0].children.length).toBe(1);
});

test('a repeat finished and cleared on one device isn’t brought back by another’s look-back', async ({
  browser,
}) => {
  const srv = server();
  const a = await device(browser, srv);
  const yday = await a.page.evaluate(() => shift(today(), -1));
  // A: yesterday's copy of a daily repeat, done and synced; then the reset clears it.
  await a.page.evaluate(y => {
    S.templates.push({ id: 'tpl1', text: 'Standup', days: [0, 1, 2, 3, 4, 5, 6], monthDay: 0, children: [] });
    S.quests.push(Object.assign(inst(S.templates[0]), { id: 'tpl1-' + y, tpl: 'tpl1', done: true }));
    save();
  }, yday);
  await a.sync();
  srv.rows.forEach(r => (r.edited_at = Number(r.edited_at) - 2 * 86400e3)); // (done two days ago)
  await a.page.evaluate(y => {
    S.day = y;
    rollover();
  }, yday);
  await a.sync();
  // All of which happened yesterday.
  srv.rows.forEach(r => (r.edited_at = Number(r.edited_at) - 86400e3));
  const b = await device(browser, srv);
  // B, last opened two days ago, walks the missed days.
  await b.page.evaluate(y => {
    S.quests = S.quests.filter(q => q.tpl !== 'tpl1');
    S.day = shift(y, -1);
    rollover();
  }, yday);
  await settle(a, b);
  const ids = (await b.state()).quests.map(q => q.id);
  expect(ids).not.toContain('tpl1-' + yday);
});

test('a sync downloads only what it hasn’t got: not its own writes, nor rows read before', async ({
  browser,
}) => {
  const srv = server();
  const a = await device(browser, srv);
  const b = await device(browser, srv);
  // An article with two pictures, written on A.
  const pic = 'data:image/png;base64,' + 'A'.repeat(4000);
  await a.page.evaluate(pic => {
    S.kbcats = [{ id: 'c', name: 'Processes', parent: '' }];
    S.kb = [
      {
        id: 'art',
        cat: 'c',
        title: 'Guide',
        body: 'Text',
        edited: 1,
        imgs: [
          { id: 'p1', src: pic, at: 1 },
          { id: 'p2', src: pic, at: 2 },
        ],
      },
    ];
    save();
  }, pic);
  await a.sync();
  // Each picture is a row of its own; the article's row has none in it.
  expect(srv.rows.get('kb:art').data.imgs).toEqual([]);
  expect(srv.rows.has('kbimg:p1') && srv.rows.has('kbimg:p2')).toBe(true);

  // A doesn't download what it just sent; B downloads it once, then nothing more.
  srv.dataRead = 0;
  await a.sync();
  expect(srv.dataRead).toBe(0);
  await b.sync();
  expect(srv.dataRead).toBeGreaterThan(0);
  expect((await b.state()).kb[0].imgs.map(p => p.id)).toEqual(['p1', 'p2']);
  await settle(a, b); // (B's first sync also registers it as a device, which A then reads)
  srv.readKeys = [];
  await settle(a, b);
  expect(srv.readKeys).toEqual([]);

  // Editing the article's text sends the article, not its pictures.
  const before = new Set([...srv.rows.values()].map(r => r.key + r.seq));
  await a.page.evaluate(() => {
    S.kb[0].body = 'Text, edited';
    save();
  });
  await a.sync();
  const sent = [...srv.rows.values()].filter(r => !before.has(r.key + r.seq)).map(r => r.key);
  expect(sent).toEqual(['kb:art']);
  await b.sync();
  const kb = (await b.state()).kb[0];
  expect(kb.body).toBe('Text, edited');
  expect(kb.imgs).toHaveLength(2);

  // Removing a picture deletes its row; the other stays.
  await a.page.evaluate(() => {
    S.kb[0].imgs = S.kb[0].imgs.filter(p => p.id !== 'p1');
    save();
  });
  await settle(a, b);
  expect(srv.rows.get('kbimg:p1').deleted).toBe(true);
  expect((await b.state()).kb[0].imgs.map(p => p.id)).toEqual(['p2']);
  for (const d of [a, b]) expect(d.errors).toEqual([]);
});

test('an article synced with its pictures inside it (the earlier way) keeps them, and moves them out', async ({
  browser,
}) => {
  const srv = server();
  srv.rows.set('kb:old', {
    key: 'kb:old',
    data: {
      id: 'old',
      cat: '',
      title: 'Old',
      body: '',
      imgs: [{ id: 'q1', src: 'data:image/png;base64,AAAA' }],
    },
    deleted: false,
    edited_at: 1,
    seq: ++srv.seq,
  });
  const a = await device(browser, srv);
  expect((await a.state()).kb[0].imgs.map(p => p.id)).toEqual(['q1']);
  await a.sync();
  expect(srv.rows.has('kbimg:q1')).toBe(true);
  expect(srv.rows.get('kb:old').data.imgs).toEqual([]);
  expect(a.errors).toEqual([]);
});

test('rows written between a sync’s list and its fetch are not skipped', async ({ browser }) => {
  const srv = server();
  const a = await device(browser, srv);
  const b = await device(browser, srv);
  await a.add('First');
  await settle(a, b);
  await a.add('Second');
  await a.sync();
  // While B fetches the new rows, many other writes land (another device's big batch), one of
  // them rewriting a row B is fetching.
  srv.onFetch = () => {
    for (let i = 0; i < 300; i++)
      srv.rows.set('inbox:x' + i, {
        key: 'inbox:x' + i,
        data: { id: 'x' + i, text: 'Batch ' + i },
        deleted: false,
        edited_at: Date.now(),
        seq: ++srv.seq,
      });
    const q = [...srv.rows.values()].find(r => r.key.startsWith('quest:') && r.data.text === 'Second');
    srv.rows.set(q.key, {
      ...q,
      data: { ...q.data, text: 'Second, edited' },
      edited_at: Date.now(),
      seq: ++srv.seq,
    });
  };
  await b.sync();
  await b.sync();
  const s = await b.state();
  expect(s.inbox.filter(i => i.text.startsWith('Batch '))).toHaveLength(300);
  expect(texts(s)).toEqual(['First', 'Second, edited']);
  for (const d of [a, b]) expect(d.errors).toEqual([]);
});

test('articles keep an empty picture list in their row, so devices from before don’t rewrite them', async ({
  browser,
}) => {
  const srv = server();
  const a = await device(browser, srv);
  await a.page.evaluate(() => {
    S.kb = [
      {
        id: 'art',
        cat: '',
        title: 'Guide',
        body: '',
        edited: 1,
        imgs: [{ id: 'p', src: 'data:image/png;base64,AAAA', at: 1 }],
      },
    ];
    save();
  });
  await a.sync();
  expect(srv.rows.get('kb:art').data.imgs).toEqual([]);
  // A device from before reads it as it would its own (normalized, with imgs: []): no change.
  const same = await a.page.evaluate(() => {
    const row = toRecords(S).get('kb:art');
    return hashOf(row) === hashOf({ ...row, imgs: [] });
  });
  expect(same).toBe(true);
  expect(a.errors).toEqual([]);
});

test('once pictures are rows of their own, pictures still inside an older copy of an article are ignored', async ({
  browser,
}) => {
  const srv = server();
  const a = await device(browser, srv);
  await a.page.evaluate(() => {
    S.kb = [
      { id: 'art', cat: '', title: 'Guide', body: '', edited: 1, imgs: [] },
      {
        id: 'b',
        cat: '',
        title: 'Other',
        body: '',
        edited: 1,
        imgs: [{ id: 'keep', src: 'data:image/png;base64,AAAA', at: 1 }],
      },
    ];
    save();
  });
  await a.sync();
  // An older device, which still keeps pictures inside the article, sends one back (a picture
  // removed here since).
  srv.rows.set('kb:art', {
    key: 'kb:art',
    data: {
      id: 'art',
      cat: '',
      title: 'Guide',
      body: 'edited there',
      edited: 2,
      imgs: [{ id: 'gone', src: 'data:image/png;base64,AAAA' }],
    },
    deleted: false,
    edited_at: Date.now() + 1000,
    seq: ++srv.seq,
  });
  await a.sync();
  const s = await a.state();
  expect(s.kb.find(x => x.id === 'art').body).toBe('edited there');
  expect(s.kb.find(x => x.id === 'art').imgs).toEqual([]);
  expect(s.kb.find(x => x.id === 'b').imgs.map(p => p.id)).toEqual(['keep']);
  expect(srv.rows.has('kbimg:gone')).toBe(false);
  expect(a.errors).toEqual([]);
});

test('a device updated from before picture rows fetches the ones it passed over', async ({ browser }) => {
  const srv = server();
  const a = await device(browser, srv);
  const b = await device(browser, srv);
  await a.page.evaluate(() => {
    S.kb = [
      {
        id: 'art',
        cat: '',
        title: 'Guide',
        body: '',
        edited: 1,
        imgs: [{ id: 'p', src: 'data:image/png;base64,AAAA', at: 1 }],
      },
    ];
    save();
  });
  await a.sync();
  // B is like an older version: it has passed the picture row by (cursor beyond it, well past
  // the re-read window) without taking it in.
  for (let i = 0; i < 300; i++)
    srv.rows.set('inbox:y' + i, {
      key: 'inbox:y' + i,
      data: { id: 'y' + i, text: 'y' },
      deleted: false,
      edited_at: 1,
      seq: ++srv.seq,
    });
  await b.page.evaluate(seq => {
    S.kb = [{ id: 'art', cat: '', title: 'Guide', body: '', edited: 1, imgs: [] }];
    persistLocal();
    sync2.cursor = seq;
    delete sync2.kbimg;
    sync2.at = {};
    sync2.synced = {};
    saveSyncState();
  }, srv.seq);
  await b.sync();
  expect((await b.state()).kb[0].imgs.map(p => p.id)).toEqual(['p']);
  for (const d of [a, b]) expect(d.errors).toEqual([]);
});

test('Settings shows how long the last sync took and what it moved', async ({ browser }) => {
  const srv = server();
  const a = await device(browser, srv);
  await a.add('Report');
  await a.sync();
  await a.sync();
  await a.page.click('nav [data-v=account]');
  const line = a.page.locator('#syncstats');
  await expect(line).toContainText(
    /Last sync: \d+ ms, [\d.]+ K?B down \(\d+ items? fetched\), [\d.]+ K?B up \(\d+ items? sent\)\./,
  );
  await expect(line).toContainText(/Last \d+: \d+ ms on average, slowest \d+ ms/);
  expect(a.errors).toEqual([]);
});

test('review round 3: pictures survive an article rewritten mid-sync; first sync records what it read', async ({
  browser,
}) => {
  const srv = server();
  const a = await device(browser, srv);
  const b = await device(browser, srv);
  // B's first sync read everything: its next sync fetches nothing, and the first one counted
  // what it fetched.
  const first = await b.page.evaluate(() => syncStats[0]);
  expect(first.got).toBeGreaterThan(0);
  srv.readKeys = [];
  await b.sync();
  expect(srv.readKeys).toEqual([]);

  await a.page.evaluate(() => {
    S.kb = [
      {
        id: 'art',
        cat: '',
        title: 'Guide',
        body: '',
        edited: 1,
        imgs: [{ id: 'p1', src: 'data:image/png;base64,AAAA', at: 1 }],
      },
    ];
    save();
  });
  await a.sync();
  // While B fetches, the article is rewritten (its row gets a newer seq than B listed).
  srv.onFetch = () => {
    const r = srv.rows.get('kb:art');
    srv.rows.set('kb:art', {
      ...r,
      data: { ...r.data, body: 'edited' },
      edited_at: Date.now(),
      seq: ++srv.seq,
    });
  };
  await b.sync();
  await settle(a, b);
  expect(srv.rows.get('kbimg:p1').deleted).toBe(false);
  for (const d of [a, b]) expect((await d.state()).kb[0].imgs.map(p => p.id)).toEqual(['p1']);
  for (const d of [a, b]) expect(d.errors).toEqual([]);
});

test('review round 3: a picture whose article hasn’t arrived is kept, not deleted', async ({ browser }) => {
  const srv = server();
  srv.rows.set('kbimg:lone', {
    key: 'kbimg:lone',
    data: { id: 'lone', art: 'later', src: 'data:image/png;base64,AAAA', at: 1 },
    deleted: false,
    edited_at: 1,
    seq: ++srv.seq,
  });
  const a = await device(browser, srv);
  await a.sync();
  await a.sync();
  expect(srv.rows.get('kbimg:lone').deleted).toBe(false);
  // Its article arrives: the picture joins it.
  srv.rows.set('kb:later', {
    key: 'kb:later',
    data: { id: 'later', cat: '', title: 'Later', body: '', edited: 1, imgs: [] },
    deleted: false,
    edited_at: 2,
    seq: ++srv.seq,
  });
  await a.sync();
  expect((await a.state()).kb[0].imgs.map(p => p.id)).toEqual(['lone']);
  expect(a.errors).toEqual([]);
});

test('review round 3: an update from before Knowledge fetches the older Knowledge rows it passed over', async ({
  browser,
}) => {
  const srv = server();
  const a = await device(browser, srv);
  await a.page.evaluate(() => {
    S.kbcats = [{ id: 'c', name: 'Processes', parent: '' }];
    S.kb = [{ id: 'art', cat: 'c', title: 'Guide', body: '', edited: 1, imgs: [] }];
    S.noteImgs = [{ id: 'n', src: 'data:image/png;base64,AAAA', at: 1 }];
    save();
  });
  await a.sync();
  for (let i = 0; i < 300; i++)
    srv.rows.set('inbox:y' + i, {
      key: 'inbox:y' + i,
      data: { id: 'y' + i, text: 'y' },
      deleted: false,
      edited_at: 1,
      seq: ++srv.seq,
    });
  const b = await device(browser, srv);
  // B is like a device from before: past those rows, without them.
  await b.page.evaluate(seq => {
    S.kb = [];
    S.kbcats = [];
    S.noteImgs = [];
    persistLocal();
    sync2.cursor = seq;
    delete sync2.kbimg;
    sync2.at = {};
    for (const k in sync2.synced) if (/^(kb|kbcat|noteimg):/.test(k)) delete sync2.synced[k];
    saveSyncState();
  }, srv.seq);
  await b.sync();
  const s = await b.state();
  expect([s.kbcats.length, s.kb.length, s.noteImgs.length]).toEqual([1, 1, 1]);
  for (const d of [a, b]) expect(d.errors).toEqual([]);
});

test('review round 3: a remote edit passed over for a newer one here is fetched again if that one is undone', async ({
  browser,
}) => {
  const srv = server();
  const a = await device(browser, srv);
  const b = await device(browser, srv);
  await a.add('Orig');
  await settle(a, b);
  // A edits and sends; B edits later (newer) but can't send.
  await a.page.evaluate(() => {
    S.quests[0].text = 'A-edit';
    save();
  });
  await a.sync();
  const was = await b.page.evaluate(() => {
    const was = S.quests[0].text;
    S.quests[0].text = 'B-edit';
    save();
    return was;
  });
  srv.failFor = b.page;
  await b.page.evaluate(async () => {
    const real = pushDirty;
    window.pushDirty = async () => {
      throw new Error('offline');
    };
    await sync();
    window.pushDirty = real;
  });
  // B puts it back as it was: nothing of its own to send, and A's edit is taken in.
  await b.page.evaluate(was => {
    S.quests[0].text = was;
    save();
  }, was);
  await settle(a, b);
  expect(texts(await a.state())).toEqual(texts(await b.state()));
});

test('review round 3: something added and removed before a sync is never sent', async ({ browser }) => {
  const srv = server();
  const a = await device(browser, srv);
  await a.page.evaluate(() => {
    S.inbox.push({ id: 'zz', text: 'x' });
    save();
    S.inbox = S.inbox.filter(i => i.id !== 'zz');
    save();
  });
  await a.sync();
  expect(srv.rows.has('inbox:zz')).toBe(false);
  expect(a.errors).toEqual([]);
});

test('deep hunt: a device whose clock is behind still gets its edits in, and never stays apart', async ({
  browser,
}) => {
  const srv = server();
  const a = await device(browser, srv);
  const b = await device(browser, srv, null, { clockBehind: 5000 });
  await a.add('A text');
  await settle(a, b);
  // B's edit to A's version counts as after it, though B's clock says earlier.
  await b.page.evaluate(() => {
    S.quests[0].text = 'B text';
    save();
  });
  await settle(a, b);
  expect(texts(await a.state())).toEqual(['B text']);
  expect(texts(await b.state())).toEqual(['B text']);
  // And an edit the server turns away as older is replaced by the server's, not kept apart.
  await a.page.evaluate(() => {
    S.quests[0].text = 'A again';
    save();
  });
  await a.sync();
  await b.page.evaluate(() => {
    S.quests[0].text = 'B stale';
    markDirty(1); // (as if made long ago)
  });
  await b.page.evaluate(async () => {
    await pushDirty();
  });
  await settle(a, b);
  expect(texts(await b.state())).toEqual(texts(await a.state()));
  expect(await b.page.evaluate(() => Object.keys(sync2.dirty))).toEqual([]);
  for (const d of [a, b]) expect(d.errors).toEqual([]);
});

test('deep hunt: the day’s reset keeps a task another device finished today', async ({ browser }) => {
  const srv = server();
  const a = await device(browser, srv);
  const b = await device(browser, srv);
  await a.add('One');
  await a.add('Two');
  await settle(a, b);
  await b.page.evaluate(() => {
    S.day = shift(today(), -1);
    persistLocal();
  });
  await a.page.evaluate(() => {
    const b = snapshot();
    S.quests.find(q => q.text === 'One').done = true;
    settle(b);
  });
  await a.sync();
  await settle(a, b);
  const sa = await a.state(),
    sb = await b.state();
  expect(texts(sb)).toEqual(texts(sa));
  expect(texts(sb)).toContain('One');
  for (const d of [a, b]) expect(d.errors).toEqual([]);
});

test('deep hunt: signing in keeps a device’s own notes and Knowledge when asked to', async ({ browser }) => {
  const srv = server();
  const a = await device(browser, srv);
  await a.add('Account task');
  await a.sync();
  const b = await device(
    browser,
    srv,
    {
      notes: 'my notes',
      kbcats: [{ id: 'c', name: 'Mine', parent: '' }],
      flows: [{ id: 'f', name: 'Flow', url: 'ms-powerautomate:/x' }],
      quests: [],
    },
    { dialogs: true },
  );
  await settle(a, b);
  expect(srv.asked && srv.asked[0]).toContain("Add this device's 3 items");
  const s = await b.state();
  expect(s.notes).toBe('my notes');
  expect(s.kbcats.map(c => c.name)).toEqual(['Mine']);
  expect(texts(s)).toEqual(['Account task']);
  expect((await a.state()).notes).toBe('my notes');
});

test('deep hunt: text the database can’t store (NUL, half an emoji) doesn’t block syncing', async ({
  browser,
}) => {
  const srv = server();
  const a = await device(browser, srv);
  await a.page.evaluate(() => {
    S.notes = 'a\u0000b ' + '😀'.slice(0, 1) + ' c';
    save();
  });
  await a.sync();
  expect(srv.rows.get('meta:notes').data.text).toBe('ab  c');
  await a.sync();
  expect((await a.state()).notes).toBe('ab  c');
  expect(a.errors).toEqual([]);
});

test('round 5: a repeat’s copy deleted just before the day’s reset stays deleted', async ({ browser }) => {
  const srv = server();
  const a = await device(browser, srv);
  await a.page.evaluate(() => {
    S.templates = [{ id: 't', text: 'Daily', days: [0, 1, 2, 3, 4, 5, 6], monthDay: 0, children: [] }];
    S.day = shift(today(), -1);
    rollover();
    save();
  });
  await a.sync();
  const id = await a.page.evaluate(() => S.quests.find(q => q.tpl === 't').id);
  // Deleted, with the day not yet reset here (as just after midnight).
  await a.page.evaluate(id => {
    S.quests = S.quests.filter(q => q.id !== id);
    S.day = shift(today(), -1);
    save();
    rollover();
    save();
  }, id);
  await a.sync();
  expect((await a.state()).quests.some(q => q.id === id)).toBe(false);
  expect(srv.rows.get('quest:' + id).deleted).toBe(true);
  expect(a.errors).toEqual([]);
});

/* Release A: the top 3, saved places and resources across devices */
test('the top 3 syncs as one record: chosen on one device, shown on the other; the newer choice wins', async ({
  browser,
}) => {
  const srv = server();
  const a = await device(browser, srv);
  await a.add('Alpha');
  await a.add('Beta');
  await a.add('Gamma');
  await a.sync();
  const b = await device(browser, srv);
  const ids = (await a.state()).quests.map(q => q.id);
  await a.page.evaluate(ids => setTop3([ids[0], ids[1]]), ids);
  await a.sync();
  await expect
    .poll(async () => (await b.state()).top3 && (await b.state()).top3.ids)
    .toEqual([ids[0], ids[1]]);
  expect(srv.rows.has('meta:top3')).toBe(true);
  await expect(b.page.locator('#v-today .top3 .t3row')).toHaveCount(2);
  // Both choose while offline: the newer choice wins on both, and nothing else is touched.
  await a.ctx.setOffline(true);
  await b.ctx.setOffline(true);
  await a.page.evaluate(ids => setTop3([ids[2]]), ids);
  await a.page.waitForTimeout(20);
  await b.page.evaluate(ids => setTop3([ids[1], ids[2], ids[0]]), ids);
  await b.page.evaluate(() => {
    S.mins = 45;
    save();
  });
  await b.ctx.setOffline(false);
  await b.sync();
  await a.ctx.setOffline(false);
  await settle(a, b);
  for (const d of [a, b]) {
    const s = await d.state();
    expect(s.top3.ids).toEqual([ids[1], ids[2], ids[0]]);
    expect(s.mins).toBe(45);
    expect(texts(s)).toEqual(['Alpha', 'Beta', 'Gamma']);
  }
  // Cleared on one device: the record is deleted, and the other device shows none.
  await a.page.evaluate(() => setTop3([]));
  await settle(a, b);
  expect(srv.rows.get('meta:top3').deleted).toBe(true);
  expect((await b.state()).top3).toBeNull();
  for (const d of [a, b]) expect(d.errors).toEqual([]);
});

test('a new day: one device’s reset clears yesterday’s top 3, a choice made today elsewhere still wins', async ({
  browser,
}) => {
  const srv = server();
  const a = await device(browser, srv);
  await a.add('Alpha');
  await a.add('Beta');
  await a.sync();
  const ids = (await a.state()).quests.map(q => q.id);
  const b = await device(browser, srv);
  // Yesterday's choice, made yesterday.
  await a.page.evaluate(ids => setTop3([ids[0]]), ids);
  await settle(a, b);
  srv.rows.forEach(r => (r.edited_at = Number(r.edited_at) - 86400e3));
  for (const d of [a, b])
    await d.page.evaluate(() => {
      S.day = shift(today(), -1);
      S.top3.day = shift(today(), -1);
      persistLocal();
    });
  // B chooses for today before A's reset runs; A's reset (as of midnight) mustn't undo it.
  await b.page.evaluate(() => {
    S.day = today();
    setTop3(S.quests.map(q => q.id).slice(1, 2));
  });
  await b.sync();
  await a.page.evaluate(() => rollover());
  await settle(a, b);
  for (const d of [a, b]) expect((await d.state()).top3.ids).toEqual([ids[1]]);
});

test('a saved place and resources travel with the task’s row; the newer edit of either wins', async ({
  browser,
}) => {
  const srv = server();
  const a = await device(browser, srv);
  await a.add('Reconcile');
  await a.sync();
  const b = await device(browser, srv);
  await a.page.click('[aria-label="Actions: Reconcile"]');
  await a.page.click('#sheet [data-saveplace]');
  await a.page.fill('#sheetin', 'Check the credits');
  await a.page.click('#sheetok');
  await a.sync();
  await expect.poll(async () => ((await b.state()).quests[0].resume || {}).note).toBe('Check the credits');
  await expect(b.page.locator('#v-today .row .tag.place')).toHaveText('Saved place');
  // B links an article it just wrote; both arrive on A, and A's place is kept.
  await b.page.evaluate(() => {
    S.kbcats = [{ id: 'c1', name: 'Docs', parent: '' }];
    S.kb = [{ id: 'a1', cat: 'c1', title: 'Credits how-to', body: '', edited: 1, imgs: [] }];
    save();
  });
  await b.page.click('.open >> text=Reconcile');
  await b.page.evaluate(() => (document.querySelector('#resd').open = true));
  await b.page.click('[data-resadd="kb"]');
  await b.page.click('#sheet [data-linkkb="a1"]');
  await settle(a, b);
  const sa = await a.state();
  expect(sa.quests[0].links).toEqual([{ id: expect.any(String), kind: 'kb', ref: 'a1' }]);
  expect(sa.quests[0].resume.note).toBe('Check the credits');
  await a.page.click('.open >> text=Reconcile');
  await expect(a.page.locator('#resd .resrow')).toContainText('Credits how-to');
  // Cleared on A while B updates it offline: B's newer note wins everywhere.
  await b.ctx.setOffline(true);
  await a.page.click('#placecard [data-clearplace]');
  await a.sync();
  await b.page.waitForTimeout(20);
  await b.page.click('#placecard [data-saveplace]');
  await b.page.fill('#sheetin', 'Credits checked, now April');
  await b.page.click('#sheetok');
  await b.ctx.setOffline(false);
  await settle(a, b);
  for (const d of [a, b]) expect((await d.state()).quests[0].resume.note).toBe('Credits checked, now April');
  for (const d of [a, b]) expect(d.errors).toEqual([]);
});

test('triage on one device while the other device moves the item: the walk goes on without it', async ({
  browser,
}) => {
  const srv = server();
  const a = await device(browser, srv);
  for (const t of ['One', 'Two', 'Three']) {
    await a.page.click('nav [data-v=inbox]');
    await a.page.fill('#iin', t);
    await a.page.press('#iin', 'Enter');
  }
  await a.sync();
  const b = await device(browser, srv);
  await a.page.click('[data-triagestart]');
  await expect(a.page.locator('#v-inbox .tcard .ttitle')).toHaveText('Three');
  // B promotes "Three" to Today: A's card moves on to the next, and its count counts it.
  await b.page.click('nav [data-v=inbox]');
  await b.page.click('#v-inbox [data-promote] >> nth=0');
  await settle(a, b);
  await expect(a.page.locator('#v-inbox .tcard .ttitle')).toHaveText('Two');
  await expect(a.page.locator('#v-inbox .tprog')).toHaveText('1 of 3 processed');
  await a.page.click('[data-tdo="today"]');
  await settle(a, b);
  expect(texts(await b.state())).toEqual(['Three', 'Two']);
  expect((await b.state()).inbox.map(i => i.text)).toEqual(['One']);
  for (const d of [a, b]) expect(d.errors).toEqual([]);
});

/* Release B: executions and their reports across devices; follow-ups and runs */
// A script's report, as PowerShell or Power Automate Desktop would send it.
const report = (d, args) => d.page.evaluate(a => sb.rpc('cockpit_exec_report', a), args);
test('a launch on one device, reports from a script: both devices show the same verified result, once', async ({
  browser,
}) => {
  const srv = server();
  const a = await device(browser, srv);
  await a.page.evaluate(() => {
    S.flows = [{ id: 'f1', name: 'Weekly report', url: 'ms-powerautomate:/console/flow/run?x=1', last: 0 }];
    save();
    renderAll();
  });
  await a.page.click('nav [data-v=account]');
  await a.page.click('#xnew');
  await expect(a.page.locator('#xsetup .caprow code').nth(2)).toHaveText(/^xtok/);
  const token = await a.page.evaluate(() => execToken);
  await a.sync();
  const b = await device(browser, srv);
  expect((await b.state()).track).toBe(true);
  // A taps the flow; B hears of the launch, unconfirmed.
  await a.page.evaluate(
    () => (addEventListener('click', e => e.target.closest('a[data-flow]') && e.preventDefault()), 0),
  );
  await a.page.click('nav [data-v=today]');
  await unfold(a.page, 'flowsd');
  await a.page.click('#v-today a[data-flow="f1"]');
  await a.page.waitForTimeout(20);
  await settle(a, b);
  const x = (await a.state()).execs[0].id;
  expect((await b.state()).execs).toEqual([expect.objectContaining({ id: x, status: 'requested' })]);
  // The script reports running, then success: the report pairs with the launch, both devices agree.
  let r = await report(b, { token, flow: 'f1', status: 'running' });
  expect(r.data).toEqual({ execution: x, event: expect.any(Number) });
  r = await report(b, { token, flow: 'f1', status: 'succeeded', message: 'Sent 3 files' });
  expect(r.data.execution).toBe(x);
  await settle(a, b);
  for (const d of [a, b]) {
    const s = await d.state();
    expect(s.execs).toHaveLength(1);
    expect(s.execs[0]).toMatchObject({ id: x, status: 'succeeded', msg: 'Sent 3 files' });
    expect(s.execs[0].ev.map(e => e.s)).toEqual(['running', 'succeeded']);
    await expect(d.page.locator('#v-today a[data-flow="f1"] .xst')).toHaveText('✓');
  }
  // Both folded the same reports into the same record: nothing left to send back and forth.
  const h = await Promise.all(
    [a, b].map(d => d.page.evaluate(() => hashOf(toRecords(S).get('exec:' + S.execs[0].id)))),
  );
  expect(h[0]).toBe(h[1]);
  const before = srv.writes;
  await settle(a, b);
  expect(srv.writes - before).toBe(0);
  // Bad reports are refused by the server, and change nothing.
  expect((await report(b, { token: 'nope', flow: 'f1', status: 'running' })).error.message).toContain(
    'unknown',
  );
  expect((await report(b, { token, flow: 'f1', status: 'done' })).error.message).toContain('status');
  // A failure: both devices flag it; acknowledging on one clears it on the other.
  await a.page.click('nav [data-v=today]');
  await unfold(a.page, 'flowsd');
  await a.page.click('#v-today a[data-flow="f1"]');
  await a.page.waitForTimeout(20);
  await settle(a, b);
  await report(a, { token, flow: 'f1', status: 'failed', message: 'Step 4: file not found' });
  await settle(a, b);
  // Both devices count the same failure, once.
  for (const d of [a, b]) await expect(d.page.locator('#attd')).toContainText('Needs attention 1');
  for (const d of [a, b])
    await expect(d.page.locator('#v-today .attn [data-xdet]')).toContainText('Automation failed');
  await unfold(b.page, 'attd');
  await b.page.click('#v-today .attn [data-xdet]');
  await b.page.click('#sheet [data-xack]');
  await settle(a, b);
  for (const d of [a, b]) await expect(d.page.locator('#v-today [data-xdet]')).toHaveCount(0);
  for (const d of [a, b])
    await expect(d.page.locator('#v-today .attn')).toContainText('Nothing needs attention');
  // Revoked: reports stop; the records stay.
  await a.page.click('nav [data-v=account]');
  await a.page.click('#xrevoke');
  await expect(a.page.locator('#xrevoke')).toHaveText('Revoke?'); // (a two-tap confirmation)
  await a.page.evaluate(() => revokeExecToken()); // (a sync redraw mid-way would un-arm it)
  await settle(a, b);
  expect((await report(b, { token, flow: 'f1', status: 'running' })).error.message).toContain('unknown');
  expect((await b.state()).execs).toHaveLength(2);
  expect((await b.state()).track).toBe(false);
  for (const d of [a, b]) expect(d.errors).toEqual([]);
});

test('a report before the launch has synced, or with no launch at all, becomes a record of its own on every device', async ({
  browser,
}) => {
  const srv = server();
  const a = await device(browser, srv);
  await a.page.evaluate(() => {
    S.flows = [{ id: 'f1', name: 'Weekly report', url: 'ms-powerautomate:/x', last: 0 }];
    save();
    renderAll();
  });
  await a.page.click('nav [data-v=account]');
  await a.page.click('#xnew');
  const token = await a.page.evaluate(() => execToken);
  await a.sync();
  const b = await device(browser, srv);
  // A is offline when it taps; the flow (started by that tap) reports before A's launch is synced.
  await a.ctx.setOffline(true);
  await a.page.evaluate(
    () => (addEventListener('click', e => e.target.closest('a[data-flow]') && e.preventDefault()), 0),
  );
  await a.page.click('nav [data-v=today]');
  await unfold(a.page, 'flowsd');
  await a.page.click('#v-today a[data-flow="f1"]');
  await a.page.waitForTimeout(20);
  const r = await report(b, { token, flow: 'f1', status: 'succeeded', message: 'ok', run_ref: 'r1' });
  expect(r.data.execution).toBe('');
  await a.ctx.setOffline(false);
  await settle(a, b);
  // Both devices: the launch stays unconfirmed (honestly), and the report is its own record.
  for (const d of [a, b]) {
    const s = await d.state();
    expect(s.execs.map(x => [x.status, !!x.unreq]).sort()).toEqual([
      ['requested', false],
      ['succeeded', true],
    ]);
    expect(s.execs.find(x => x.unreq).id).toBe('u' + r.data.event);
  }
  // A later report with the same run_ref joins that same record.
  await report(b, { token, flow: 'f1', status: 'failed', message: 'later', run_ref: 'r1' });
  await settle(a, b);
  for (const d of [a, b]) {
    const s = await d.state();
    expect(s.execs).toHaveLength(2);
    expect(s.execs.find(x => x.unreq)).toMatchObject({ status: 'failed', msg: 'later', ref: 'r1' });
  }
  for (const d of [a, b]) expect(d.errors).toEqual([]);
});

test('follow-ups recorded on two devices offline are both kept; a run’s progress and the waiting details sync', async ({
  browser,
}) => {
  const srv = server();
  const a = await device(browser, srv);
  await a.page.evaluate(() => {
    S.kb = [
      {
        id: 'a1',
        cat: '',
        title: 'Proc',
        body: '',
        edited: 1,
        imgs: [],
        steps: [
          { id: 'p1', title: 'One' },
          { id: 'p2', title: 'Two' },
        ],
      },
    ];
    S.quests = [
      fix({
        id: 'q1',
        text: 'Approval',
        children: [
          fix({ id: 's1', text: 'Sign-off', wait: { who: 'Sam', note: '', due: today(), since: today() } }),
        ],
      }),
    ];
    save();
  });
  await a.sync();
  const b = await device(browser, srv);
  await a.ctx.setOffline(true);
  await b.ctx.setOffline(true);
  const follow = (d, note) =>
    d.page.evaluate(note => {
      addFollow('s1', 'chase', note);
      find('s1').n.wait.last = today();
      save();
    }, note);
  await follow(a, 'Emailed');
  await follow(b, 'Called');
  await a.ctx.setOffline(false);
  await b.ctx.setOffline(false);
  await settle(a, b);
  for (const d of [a, b]) {
    const s = await d.state();
    expect(s.follows.map(f => f.note).sort()).toEqual(['Called', 'Emailed']);
    expect(s.quests[0].children[0].wait.last).toBe(await d.page.evaluate(() => today()));
  }
  // A run started on A, a step done on B: the same run, its progress everywhere.
  await a.page.evaluate(() => openRun('a1', 'q1'));
  await settle(a, b);
  const id = (await a.state()).runs[0].id;
  expect((await b.state()).runs.map(r => r.id)).toEqual([id]);
  await b.page.evaluate(id => {
    const r = S.runs.find(x => x.id === id);
    r.done.push('p1');
    r.at = Date.now();
    save();
  }, id);
  await settle(a, b);
  expect((await a.state()).runs[0].done).toEqual(['p1']);
  for (const d of [a, b]) expect(d.errors).toEqual([]);
});

test('review fix: a device still on the previous version doesn’t strip procedure steps or switch tracking off', async ({
  browser,
}) => {
  const srv = server();
  const a = await device(browser, srv);
  await a.page.evaluate(() => {
    S.kb = [
      {
        id: 'a1',
        cat: '',
        title: 'Proc',
        body: 'b',
        edited: 1,
        imgs: [],
        steps: [{ id: 'p1', title: 'One' }],
      },
    ];
    S.track = true;
    save();
  });
  await a.sync();
  // Steps and tracking are rows of their own, which an older copy leaves alone.
  expect(srv.rows.get('kb:a1').data.steps).toBeUndefined();
  expect(srv.rows.get('kbsteps:a1').data.steps).toEqual([{ id: 'p1', title: 'One' }]);
  expect(srv.rows.get('meta:track').data).toEqual({ on: true });
  expect(srv.rows.get('meta:prefs').data.track).toBeUndefined();
  // The older copy edits the article's title and its prefs (as it would: from the keys it knows).
  const kb = srv.rows.get('kb:a1'),
    prefs = srv.rows.get('meta:prefs');
  srv.rows.set('kb:a1', {
    ...kb,
    data: { ...kb.data, title: 'Proc, renamed' },
    edited_at: Date.now() + 10,
    seq: ++srv.seq,
  });
  srv.rows.set('meta:prefs', {
    ...prefs,
    data: { ...prefs.data, mins: 45 },
    edited_at: Date.now() + 10,
    seq: ++srv.seq,
  });
  await a.sync();
  const s = await a.state();
  expect(s.kb[0].title).toBe('Proc, renamed');
  expect(s.kb[0].steps).toEqual([{ id: 'p1', title: 'One' }]);
  expect(s.track).toBe(true);
  expect(s.mins).toBe(45);
  // A second device reads them the same way.
  const b = await device(browser, srv);
  const sb2 = await b.state();
  expect(sb2.kb[0].steps).toEqual([{ id: 'p1', title: 'One' }]);
  expect(sb2.track).toBe(true);
  // Removing the steps removes their row.
  await a.page.evaluate(() => {
    delete S.kb[0].steps;
    save();
  });
  await settle(a, b);
  expect(srv.rows.get('kbsteps:a1').deleted).toBe(true);
  expect((await b.state()).kb[0].steps).toBeUndefined();
  for (const d of [a, b]) expect(d.errors).toEqual([]);
});

test('Release C: a recurring workflow’s run is made once across devices, a run moved on here shows there, a rule fires once', async ({
  browser,
}) => {
  const srv = server();
  const a = await device(browser, srv);
  await a.page.evaluate(() => {
    S.track = true;
    S.flows = [{ id: 'f1', name: 'SSRS report', url: 'ms-powerautomate:/x', last: 0 }];
    S.workflows = [
      {
        id: 'w1',
        name: 'Thursday reporting',
        ver: 1,
        days: [0, 1, 2, 3, 4, 5, 6],
        monthDay: 0,
        stages: [
          { id: 's1', type: 'manual', title: 'Prepare' },
          { id: 's2', type: 'flow', title: 'Run SSRS', flow: 'f1' },
          { id: 's3', type: 'verify', title: 'Check', checks: ['Right period'] },
        ],
      },
    ];
    S.rules = [
      {
        id: 'r1',
        name: 'On failure',
        on: { k: 'wrun_failed' },
        do: { k: 'inbox', text: 'Look at {name}: {err}' },
        enabled: true,
      },
      { id: 'r2', name: 'Ready', on: { k: 'wf_due' }, do: { k: 'quest', text: 'Do {name}' }, enabled: true },
    ];
    S.cap = [0, 240, 240, 240, 240, 240, 0];
    S.pins = [{ k: 'wf', id: 'w1' }];
    save();
  });
  await a.sync();
  const b = await device(browser, srv);
  // Both devices roll the day over: one ready run (same id), one task from the rule, and the
  // rule's log says so once.
  for (const d of [a, b])
    await d.page.evaluate(() => {
      S.day = shift(today(), -1);
      rollover();
    });
  await settle(a, b);
  const day = await a.page.evaluate(() => today());
  for (const d of [a, b]) {
    const s = await d.state();
    expect(s.wruns.map(r => [r.id, r.status])).toEqual([['w1-' + day, 'ready']]);
    expect(s.quests.filter(q => q.byRule).map(q => q.text)).toEqual(['Do Thursday reporting']);
    expect(s.rlog.filter(l => l.r === 'r2')).toHaveLength(1);
    expect(s.cap).toEqual([0, 240, 240, 240, 240, 240, 0]);
    expect(s.pins).toEqual([{ k: 'wf', id: 'w1' }]);
  }
  // Cleared on B, neither device's next reset brings it back (remembered as gone).
  await b.page.evaluate(() => {
    S.wruns = [];
    save();
  });
  await settle(a, b);
  for (const d of [a, b]) {
    await d.page.evaluate(() => {
      S.day = shift(today(), -1);
      rollover();
    });
    expect((await d.state()).wruns).toHaveLength(0);
  }
  await settle(a, b);
  for (const d of [a, b]) expect((await d.state()).wruns).toHaveLength(0);
  // Made afresh for the rest of the test.
  await a.page.evaluate(() => {
    S.wruns.push(makeRun(S.workflows[0], { id: 'w1-' + today(), prepared: true }));
    save();
  });
  await settle(a, b);
  // A starts the run and finishes the first stage; B sees it at the second.
  await a.page.evaluate(() => {
    beginRun(S.wruns[0]);
    completeStage(S.wruns[0], 's1');
    save();
  });
  await settle(a, b);
  expect((await b.state()).wruns[0]).toMatchObject({
    status: 'awaiting_user',
    cur: 's2',
    st: { s1: { o: 'done' } },
  });
  // B launches the flow; the script's failure report reaches both: the run fails once, the
  // rule makes one Inbox item (same id on both), and a retry on A is a new execution.
  await b.page.evaluate(
    () => (addEventListener('click', e => e.target.closest('a[data-flow]') && e.preventDefault()), 0),
  );
  await b.page.evaluate(() => openWorkflowRun(S.wruns[0].id));
  await b.page.click('#v-knowledge a[data-flow="f1"]');
  await b.page.waitForTimeout(20);
  await settle(a, b);
  const x1 = (await b.state()).wruns[0].live.exec;
  expect(x1).toBeTruthy();
  expect((await a.state()).wruns[0].live.exec).toBe(x1);
  const token = await a.page.evaluate(async () => (await sb.rpc('cockpit_new_exec_token')).data);
  await report(a, { token, flow: 'f1', execution: x1, status: 'failed', message: 'Login failed' });
  await settle(a, b);
  for (const d of [a, b]) {
    const s = await d.state();
    expect(s.wruns[0]).toMatchObject({ status: 'failed', err: 'Automation failed: Login failed' });
    expect(s.inbox.map(i => i.text)).toEqual(['Look at Thursday reporting: Automation failed: Login failed']);
    expect(s.rlog.filter(l => l.r === 'r1' && l.out === 'done')).toHaveLength(1);
  }
  await a.page.evaluate(() => {
    retryStage(S.wruns[0], 's2');
    save();
  });
  await settle(a, b);
  expect((await b.state()).wruns[0]).toMatchObject({ status: 'awaiting_user', live: { tries: 1 } });
  expect((await b.state()).execs).toHaveLength(1); // (the failed attempt is kept)
  // Nothing left to send back and forth: both hold the same records.
  const h = await Promise.all(
    [a, b].map(d =>
      d.page.evaluate(() =>
        [...toRecords(S).keys()]
          .filter(k => /^(wrun|rlog|inbox|task):/.test(k))
          .sort()
          .map(k => k + ':' + hashOf(toRecords(S).get(k))),
      ),
    ),
  );
  expect(h[0]).toEqual(h[1]);
  const before = srv.writes;
  await settle(a, b);
  expect(srv.writes - before).toBe(0);
  for (const d of [a, b]) expect(d.errors).toEqual([]);
});

test('Release C: a device on the previous version leaves workflow, rule, capacity and pin rows alone', async ({
  browser,
}) => {
  const srv = server();
  const a = await device(browser, srv);
  await a.page.evaluate(() => {
    S.workflows = [
      {
        id: 'w1',
        name: 'W',
        ver: 1,
        days: [],
        monthDay: 0,
        stages: [{ id: 's1', type: 'manual', title: 'A' }],
      },
    ];
    S.rules = [{ id: 'r1', name: 'R', on: { k: 'quest_done' }, do: { k: 'note', text: 'x' }, enabled: true }];
    S.cap = [0, 1, 2, 3, 4, 5, 0];
    S.pins = [{ k: 'wf', id: 'w1' }];
    S.quests = [fix({ id: 'q1', text: 'Q', est: 30 })];
    save();
  });
  await a.sync();
  for (const k of ['workflow:w1', 'rule:r1', 'meta:cap', 'meta:pins']) expect(srv.rows.get(k)).toBeTruthy();
  // The older copy doesn't know these kinds: `knownKey` is false for them, so a sync from it
  // neither reads nor deletes them (as Release B's test shows for kbsteps). It does rewrite
  // the task from the keys it knows, keeping fields it doesn't understand (est) as data.
  expect(
    await a.page.evaluate(() =>
      ['workflow:w1', 'rule:r1', 'rlog:x', 'wrun:y', 'meta:cap', 'meta:pins'].map(knownKey),
    ),
  ).toEqual([true, true, true, true, true, true]);
  const q = srv.rows.get('quest:q1');
  srv.rows.set('quest:q1', {
    ...q,
    data: { ...q.data, text: 'Q renamed' },
    edited_at: Date.now() + 10,
    seq: ++srv.seq,
  });
  await a.sync();
  const s = await a.state();
  expect(s.quests[0]).toMatchObject({ text: 'Q renamed', est: 30 });
  expect(s.workflows).toHaveLength(1);
  expect(s.rules).toHaveLength(1);
  // A fresh device reads everything the same way.
  const b = await device(browser, srv);
  const sb2 = await b.state();
  expect(sb2.workflows[0].stages).toEqual([{ id: 's1', type: 'manual', title: 'A' }]);
  expect(sb2.rules[0].do).toEqual({ k: 'note', text: 'x' });
  expect(sb2.cap).toEqual([0, 1, 2, 3, 4, 5, 0]);
  expect(sb2.pins).toEqual([{ k: 'wf', id: 'w1' }]);
  // Clearing the pins and capacity deletes their rows.
  await a.page.evaluate(() => {
    S.pins = [];
    S.cap = null;
    save();
  });
  await settle(a, b);
  expect(srv.rows.get('meta:pins').deleted).toBe(true);
  expect(srv.rows.get('meta:cap').deleted).toBe(true);
  expect((await b.state()).pins).toEqual([]);
  expect((await b.state()).cap).toBeNull();
  for (const d of [a, b]) expect(d.errors).toEqual([]);
});

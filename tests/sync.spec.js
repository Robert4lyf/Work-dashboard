const { test, expect } = require('@playwright/test');

// A stand-in for Supabase, shared by several "devices" (browser contexts): the cockpit_items rows
// live in the test, and each page reaches them through exposed functions. Supports the calls the
// app makes, plus live-update notifications to every other device after a write.
function fakeSupabase() {
  const query = table => {
    const q = { table, filters: {} };
    const api = {
      select() {
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
      order() {
        return api;
      },
      limit(n) {
        q.limit = n;
        return api;
      },
      maybeSingle: async () => ({ data: await window.srvState(), error: null }),
      upsert: async (rows, opts) => {
        if (table === 'cockpit_state') await window.srvSnapshot(rows);
        else await window.srvUpsert(Array.isArray(rows) ? rows : [rows]);
        return { error: null };
      },
      then(res, rej) {
        return window
          .srvRows(q.gt || 0, q.limit || 1000)
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
          subscribe() {
            return ch;
          },
        };
        return ch;
      },
      removeChannel() {},
      rpc: async name => ({ data: await window.srvRpc(name), error: null }),
    }),
  };
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
async function device(browser, srv, seed) {
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route(
    u => !u.href.startsWith('http://localhost'),
    r => r.abort(),
  );
  await page.exposeFunction('srvRows', (gt, limit) =>
    [...srv.rows.values()]
      .filter(r => r.seq > gt)
      .sort((a, b) => a.seq - b.seq)
      .slice(0, limit),
  );
  await page.exposeFunction('srvUpsert', rows => {
    srv.writes += rows.length;
    rows.forEach(r => srv.rows.set(r.key, { ...r, data: jsonb(r.data), seq: ++srv.seq }));
    // Tell the other devices, like Supabase Realtime would.
    srv.devices
      .filter(d => d.page !== page)
      .forEach(d => d.page.evaluate(() => window.__live && window.__live()));
  });
  await page.exposeFunction('srvState', () => srv.state);
  await page.exposeFunction('srvRpc', name =>
    name === 'cockpit_new_capture_token' ? (srv.token = 'tok123') : null,
  );
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
  await page.exposeFunction('srvSnapshot', row => {
    srv.state = { data: row.data, edited_at: row.edited_at };
    srv.snapshots++;
  });
  if (seed) await page.addInitScript(s => localStorage.setItem('work-cockpit-v1', s), JSON.stringify(seed));
  await page.addInitScript(fakeSupabase);
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
  // Only the changed rows travel: adding one quest writes the quest, the list order and the
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
  await a.page.click('nav [data-v=focus]');
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
  await a.page.click('[aria-label="Delete Remove me"]');
  await a.page.click('[aria-label="Delete Remove me"]');
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
  await a.page.click('#rptd summary');
  await a.page.click('[data-rpreset="daily"]');
  await a.page.click('[aria-label="Mark done: Standup"]');
  await a.sync();
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
  await a.page.click('#capnew');
  await expect(a.page.locator('.caprow code').nth(2)).toHaveText('tok123');
  await a.page.click('#captest');
  await expect
    .poll(async () => (await a.state()).inbox.map(i => i.text))
    .toEqual(['Test capture from Settings']);
  // The details survive a reload on this device.
  await a.page.reload();
  await a.page.click('nav [data-v=account]');
  await expect(a.page.locator('.caprow code').nth(2)).toHaveText('tok123');
  expect(a.errors).toEqual([]);
});

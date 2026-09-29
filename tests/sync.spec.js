const { test, expect } = require('@playwright/test');

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
  // (what's asked for: by key or after a seq; without the data unless it's selected, and the
  // data sent counted, to check what a sync downloads)
  await page.exposeFunction('srvRows', (gt, limit, cols, keys) => {
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
  await a.page.click('[aria-label="Remove Remove me"]');
  await a.page.click('#v-today [data-delnow]');
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
  await a.page.click('#capnew');
  await expect(a.page.locator('.caprow code').nth(3)).toHaveText('tok123');
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
  await expect(a.page.locator('.caprow').first()).toBeHidden();
  await a.page.click('#capsetup summary');
  await expect(a.page.locator('.caprow code').nth(3)).toHaveText('tok123');
  expect(a.errors).toEqual([]);
});

test('health check, signed in: sync, live updates and optional parts', async ({ browser }) => {
  const srv = server();
  const a = await device(browser, srv);
  await a.page.click('nav [data-v=account]');
  await a.page.click('#healthrun');
  const row = name => a.page.locator('.health .hrow2', { hasText: name });
  await expect(row('Signed in')).toHaveClass(/ok/);
  await expect(row('Sync table')).toHaveClass(/ok/);
  await expect(row('Last sync')).toHaveClass(/ok/);
  await expect(row('Live updates')).toContainText('Connected');
  expect(a.errors).toEqual([]);
});

test('the daily reset waits for the server: a quest reopened elsewhere yesterday survives', async ({
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
  expect(srv.rows.get('kb:art').data.imgs).toBeUndefined();
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
  expect(srv.rows.get('kb:old').data.imgs).toBeUndefined();
  expect(a.errors).toEqual([]);
});

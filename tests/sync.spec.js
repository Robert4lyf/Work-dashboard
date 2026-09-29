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

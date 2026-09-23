const { test, expect } = require('@playwright/test');

// A stand-in for Supabase: one shared row held in the test, reached by each "device" (browser
// context) through exposed functions. Supports exactly the calls the app makes.
const fakeSupabase = () => {
  window.supabase = {
    createClient: () => ({
      auth: {
        onAuthStateChange(cb) {
          setTimeout(() => cb('INITIAL_SESSION', { user: { id: 'u1', email: 'me@example.com' } }), 0);
          return { data: { subscription: { unsubscribe() {} } } };
        },
        signOut: async () => ({}),
      },
      from() {
        const q = { filters: {} };
        const api = {
          eq(k, v) {
            q.filters[k] = v;
            return api;
          },
          maybeSingle: async () => ({ data: await window.srvGet(), error: null }),
          upsert: async row => (await window.srvPut(row, null), { error: null }),
          update(row) {
            q.update = row;
            return api;
          },
          select() {
            if (!q.update) return api;
            return window
              .srvPut(q.update, q.filters.edited_at)
              .then(ok => ({ data: ok ? [{ user_id: 'u1' }] : [], error: null }));
          },
        };
        return api;
      },
    }),
  };
};

async function device(browser, server) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route(
    u => !u.href.startsWith('http://localhost'),
    r => r.abort(),
  );
  await page.exposeFunction('srvGet', async () => {
    const row = server.row ? { ...server.row } : null;
    // Lets a test make another device save after this read but before this device writes.
    if (server.onRead) {
      const f = server.onRead;
      server.onRead = null;
      await f();
    }
    return row;
  });
  await page.exposeFunction('srvPut', (row, expected) => {
    if (expected != null && (!server.row || server.row.edited_at !== expected)) return false;
    server.row = { data: row.data, edited_at: row.edited_at };
    server.writes++;
    return true;
  });
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
      await page.fill('#qin', text);
      await page.press('#qin', 'Enter');
    },
  };
  return d;
}
const texts = s => s.quests.map(q => q.text).sort();

test('edits made on two devices at once are merged, not overwritten', async ({ browser }) => {
  const server = { row: null, writes: 0 };
  const a = await device(browser, server);
  await a.add('Shared');
  await a.sync();
  const b = await device(browser, server);
  expect(texts(await b.state())).toEqual(['Shared']);

  // Both devices go offline and change different things.
  await a.ctx.setOffline(true);
  await b.ctx.setOffline(true);
  await a.add('From A');
  await b.add('From B');
  await b.page.click('[aria-label="Mark done: Shared"]');
  await a.ctx.setOffline(false);
  await a.sync();
  await b.ctx.setOffline(false);
  await b.sync();
  await a.sync();

  for (const d of [a, b]) {
    const s = await d.state();
    expect(texts(s)).toEqual(['From A', 'From B', 'Shared']);
    expect(s.quests.find(q => q.text === 'Shared').done).toBe(true);
    expect(d.errors).toEqual([]);
  }
  expect(server.row.data.quests.map(q => q.text).sort()).toEqual(['From A', 'From B', 'Shared']);
});

test('a deletion on one device survives an unrelated edit on the other', async ({ browser }) => {
  const server = { row: null, writes: 0 };
  const a = await device(browser, server);
  await a.add('Keep');
  await a.add('Remove me');
  await a.sync();
  const b = await device(browser, server);
  await a.ctx.setOffline(true);
  await b.ctx.setOffline(true);
  await a.page.click('[aria-label="Delete Remove me"]');
  await a.page.click('[aria-label="Delete Remove me"]');
  await b.add('New on B');
  await a.ctx.setOffline(false);
  await a.sync();
  await b.ctx.setOffline(false);
  await b.sync();
  expect(texts(await b.state())).toEqual(['Keep', 'New on B']);
});

test('a save that lands between reading and writing is merged, not overwritten', async ({ browser }) => {
  const server = { row: null, writes: 0 };
  const a = await device(browser, server);
  await a.add('First');
  await a.sync();
  const b = await device(browser, server);
  await b.add('From B');
  await b.sync();
  // A edits, then while A is syncing, B's next save lands just after A read the server.
  await a.add('From A');
  await b.add('Late B');
  server.onRead = () => b.sync();
  await a.sync();
  expect(texts(await a.state())).toEqual(['First', 'From A', 'From B', 'Late B']);
  expect(server.row.data.quests.map(q => q.text).sort()).toEqual(['First', 'From A', 'From B', 'Late B']);
});

test('merge rules', async ({ page }) => {
  await page.route(
    u => !u.href.startsWith('http://localhost'),
    r => r.abort(),
  );
  await page.goto('/');
  const r = await page.evaluate(() => {
    const q = (id, text, extra = {}) => ({ id, text, children: [], ...extra });
    const base = { editedAt: 1, xp: 0, timer: null, quests: [q('1', 'One'), q('2', 'Two')], daily: {} };
    const mine = {
      editedAt: 3,
      xp: 0,
      timer: null,
      quests: [q('1', 'One (edited here)'), q('2', 'Two'), q('3', 'Mine')],
      daily: { '2026-09-23': { Design: 10 } },
      sessions: [{ tag: 'Design', mins: 10, t: new Date(2026, 8, 23, 10).getTime(), q: null }],
    };
    const theirs = {
      editedAt: 2,
      xp: 0,
      timer: { end: 5, mins: 25, tag: '', q: null },
      quests: [q('1', 'One (edited there)')],
      daily: { '2026-09-23': { Admin: 5 } },
      sessions: [{ tag: 'Admin', mins: 5, t: new Date(2026, 8, 23, 11).getTime(), q: null }],
    };
    return mergeState(base, mine, theirs);
  });
  // Both edited quest 1: the newer side (mine) wins. Quest 2 deleted there and untouched here: gone.
  expect(r.quests.map(x => x.text)).toEqual(['One (edited here)', 'Mine']);
  // The timer only changed on the other device, so it is kept even though that side is older.
  expect(r.timer).toMatchObject({ mins: 25 });
  // Both logged focus time the same day: the day is rebuilt from both sets of sessions.
  expect(r.daily['2026-09-23']).toEqual({ Design: 10, Admin: 5 });
  expect(r.sessions).toHaveLength(2);
});

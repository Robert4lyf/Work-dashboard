// Two tabs of one device, signed in (the fake server in tests/twotabs.js), and the cases the
// bug-hunt round found: a tab mid-sync or waking from the background must not save its older copy
// over what the other tab just saved.
const { test } = require('@playwright/test');
const { server, context, tab, quiet, pushes, rowsOf, wait, expect } = require('./twotabs');

const inboxOnServer = srv =>
  rowsOf(srv)
    .filter(r => r.key.startsWith('inbox:') && !r.deleted)
    .map(r => r.data.text);
test.setTimeout(90000);

test('an edit in one tab is sent once, shows in the other, and leaves nothing waiting in either', async ({
  browser,
}) => {
  const srv = server();
  const ctx = await context(browser, srv);
  const a = await tab(ctx, 'A'),
    b = await tab(ctx, 'B');
  await quiet(srv, a, b);
  await a.add('From tab A');
  await quiet(srv, a, b);
  expect(await b.inbox()).toEqual(['From tab A']);
  expect(inboxOnServer(srv)).toEqual(['From tab A']);
  expect(Object.values(pushes(srv, u => u.key.startsWith('inbox:')))).toEqual([1]);
  for (const t of [a, b]) expect(Object.keys((await t.sync2()).dirty)).toEqual([]);
  await b.add('From tab B');
  await quiet(srv, a, b);
  expect(await a.inbox()).toEqual(['From tab B', 'From tab A']);
  expect(inboxOnServer(srv).sort()).toEqual(['From tab A', 'From tab B']);
  expect(a.errors.concat(b.errors)).toEqual([]);
});

test('a save in one tab while the other is mid-sync is still sent, and survives the other’s next edit', async ({
  browser,
}) => {
  const srv = server();
  const ctx = await context(browser, srv);
  const a = await tab(ctx, 'A'),
    b = await tab(ctx, 'B');
  await quiet(srv, a, b);
  srv.delay = 400;
  const bsync = b.sync();
  await wait(150);
  await a.add('Made in A while B was syncing');
  await bsync;
  // (B takes A's save in as soon as its sync is over; an edit in B in that same instant is the
  // one case left, see js/tabs.js)
  await expect.poll(() => b.inbox()).toEqual(['Made in A while B was syncing']);
  await b.add('Then one in B');
  srv.delay = 0;
  await quiet(srv, a, b);
  expect(inboxOnServer(srv).sort()).toEqual(['Made in A while B was syncing', 'Then one in B']);
  expect((await a.inbox()).sort()).toEqual(['Made in A while B was syncing', 'Then one in B']);
  expect((await b.inbox()).sort()).toEqual(['Made in A while B was syncing', 'Then one in B']);
});

test('an edit in one tab while the other is taking in a change from another device is kept everywhere', async ({
  browser,
}) => {
  const srv = server();
  const ctx = await context(browser, srv);
  const a = await tab(ctx, 'A'),
    b = await tab(ctx, 'B');
  const d = await tab(await context(browser, srv), 'D'); // another device
  await quiet(srv, a, b, d);
  await d.add('From the phone');
  await quiet(srv, d);
  // B hears of it and is part-way through taking it in when A saves.
  srv.delay = 400;
  const bsync = b.sync();
  await wait(150);
  await a.add('Typed in A meanwhile');
  await bsync;
  srv.delay = 0;
  await quiet(srv, a, b, d);
  await b.add('B later');
  await quiet(srv, a, b, d);
  const all = ['B later', 'From the phone', 'Typed in A meanwhile'];
  expect(inboxOnServer(srv).sort()).toEqual(all);
  for (const t of [a, b, d]) expect((await t.inbox()).sort()).toEqual(all);
});

test('edits made offline in both tabs are each sent once on reconnecting', async ({ browser }) => {
  const srv = server();
  const ctx = await context(browser, srv);
  const a = await tab(ctx, 'A'),
    b = await tab(ctx, 'B');
  await quiet(srv, a, b);
  await ctx.setOffline(true);
  await a.add('A1');
  await expect.poll(() => b.inbox()).toEqual(['A1']);
  await b.add('B1');
  await expect.poll(() => a.inbox()).toEqual(['B1', 'A1']);
  const before = srv.upserts.length;
  await ctx.setOffline(false);
  await a.page.evaluate(() => window.dispatchEvent(new Event('online')));
  await b.page.evaluate(() => window.dispatchEvent(new Event('online')));
  await quiet(srv, a, b);
  expect(inboxOnServer(srv).sort()).toEqual(['A1', 'B1']);
  const sent = pushes(srv, u => srv.upserts.indexOf(u) >= before && u.key.startsWith('inbox:'));
  expect(Object.values(sent)).toEqual([1, 1]);
});

// A tab the browser froze in the background: it hears nothing until it wakes.
const freeze = t =>
  t.page.evaluate(() => {
    window.__take = window.takeSavedSoon;
    window.takeSavedSoon = () => Promise.resolve();
    Object.defineProperty(document, 'hidden', { get: () => window.__hidden, configurable: true });
    window.__hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    const at = Date.now();
    window.__now = Date.now;
    Date.now = () => at; // (its timers don't run either)
  });
const wake = t =>
  t.page.evaluate(() => {
    Date.now = window.__now;
    window.takeSavedSoon = window.__take;
    window.__hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
  });

test('a tab waking from the background with a session that ended meanwhile keeps what the other tab did', async ({
  browser,
}) => {
  const srv = server();
  const ctx = await context(browser, srv, { syncOff: true });
  const a = await tab(ctx, 'A'),
    b = await tab(ctx, 'B');
  await a.page.evaluate(() => {
    S.timer = { id: uid(), end: Date.now() + 2000, tag: 'Design', mins: 25, q: null };
    save();
    renderAll();
  });
  await expect.poll(() => b.page.evaluate(() => !!S.timer)).toBe(true);
  await freeze(b);
  await expect.poll(() => a.page.evaluate(() => !S.timer), { timeout: 10000 }).toBe(true); // it ends in A
  await a.add('Done in A after the session');
  await a.page.evaluate(() => storeDone());
  await wake(b);
  await expect.poll(() => b.inbox()).toEqual(['Done in A after the session']);
  await wait(800);
  expect(await a.inbox()).toEqual(['Done in A after the session']);
  expect(await b.page.evaluate(() => !S.timer)).toBe(true);
  // (the session counted once)
  expect(await a.page.evaluate(() => S.sessions.length)).toBe(1);
  expect(await b.page.evaluate(() => S.sessions.length)).toBe(1);
});

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
test('a picture brought back with Undo survives the other tab clearing out deleted pictures', async ({
  browser,
}) => {
  const srv = server();
  const ctx = await context(browser, srv, { syncOff: true });
  const a = await tab(ctx, 'A'),
    b = await tab(ctx, 'B');
  await a.page.evaluate(src => {
    S.noteImgs.push({ id: 'pic1', src, at: Date.now() });
    save();
    renderAll();
  }, PNG);
  await expect.poll(() => b.page.evaluate(() => S.noteImgs.length)).toBe(1);
  await b.add('B saves once'); // (B puts the picture in the store itself, as it would at start)
  await expect.poll(() => a.inbox()).toEqual(['B saves once']);
  await wait(300);
  await a.page.evaluate(() => {
    go('notes');
    deleteNoteImg('pic1');
  });
  await expect.poll(() => b.page.evaluate(() => S.noteImgs.length)).toBe(0);
  await b.page.evaluate(() => prunePics()); // (what its once-a-minute tidy does)
  await wait(300);
  await a.page.click('#undo');
  await expect.poll(() => b.page.evaluate(() => S.noteImgs.map(m => typeof m.src))).toEqual(['string']);
  await b.add('Something else in B');
  await expect.poll(() => a.inbox()).toContain('Something else in B');
  expect(await a.page.evaluate(() => S.noteImgs.map(m => typeof m.src))).toEqual(['string']);
  // After a reload its data is still there.
  await wait(500);
  await a.page.reload();
  await a.page.waitForFunction(() => window.appReady === true);
  expect(await a.page.evaluate(() => S.noteImgs.map(m => typeof m.src))).toEqual(['string']);
});

test('without IndexedDB every save still reaches the other tab', async ({ browser }) => {
  const srv = server();
  const ctx = await context(browser, srv, { syncOff: true, noIdb: true });
  const a = await tab(ctx, 'A'),
    b = await tab(ctx, 'B');
  const all = [];
  for (let i = 0; i < 12; i++) {
    await a.add('a' + i);
    await wait(120);
    await b.add('b' + i);
    await wait(120);
    all.push('a' + i, 'b' + i);
  }
  await wait(500);
  expect((await a.inbox()).sort()).toEqual(all.slice().sort());
  expect((await b.inbox()).sort()).toEqual(all.slice().sort());
});

test('a tab that is still starting takes in a save made after it read the store', async ({ browser }) => {
  const srv = server();
  const ctx = await context(browser, srv, { syncOff: true });
  const a = await tab(ctx, 'A');
  await a.add('Before C');
  await a.page.evaluate(() => storeDone());
  const page = await ctx.newPage();
  // (C's start is held just after its read of the store)
  await page.addInitScript(() => {
    const all = Promise.all.bind(Promise);
    let held = false;
    Promise.all = function (arr) {
      const p = all(arr);
      if (held || !Array.isArray(arr) || arr.length !== 2 || typeof picDb === 'undefined' || !picDb) return p;
      held = true;
      return p.then(r => new Promise(ok => (window.__go = () => ok(r))));
    };
  });
  await page.goto('/');
  await page.waitForFunction(() => typeof window.__go === 'function');
  await a.add('Saved in A while C was starting');
  await wait(300);
  await page.evaluate(() => window.__go());
  await page.waitForFunction(() => window.appReady === true);
  await expect
    .poll(() => page.evaluate(() => S.inbox.map(i => i.text)))
    .toEqual(['Saved in A while C was starting', 'Before C']);
});

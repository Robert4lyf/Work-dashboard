// Release B: deep links (#/… routes) and the shortcut builder.
const { test, expect } = require('./fixtures');

const seed = () => {
  S.kbcats = [{ id: 'c1', name: 'Finance', parent: '' }];
  S.kb = [
    {
      id: 'a1',
      cat: 'c1',
      title: 'Report procedure',
      body: 'Steps.',
      edited: 1,
      imgs: [],
      steps: [
        { id: 'p1', title: 'Pull extract' },
        { id: 'p2', title: 'Send' },
      ],
    },
    { id: 'a2', cat: 'c1', title: 'Plain article', body: 'Text.', edited: 1, imgs: [] },
  ];
  S.quests = [
    fix({
      id: 'q1',
      text: 'Weekly reporting',
      children: [
        fix({ id: 's1', text: 'Reconcile' }),
        fix({ id: 's2', text: 'Sign-off', wait: { who: 'Sam', note: '', due: today(), since: today() } }),
      ],
    }),
    fix({ id: 'q2', text: 'Call Dana', resume: { note: 'Left a voicemail', at: Date.now(), step: '' } }),
  ];
  S.later = [fix({ id: 'L1', text: 'Later thing', start: shift(today(), 3) })];
  S.inbox = [
    { id: 'i1', text: 'Idea' },
    { id: 'i2', text: 'Another' },
  ];
  save();
  renderAll();
};
// A cold launch at a route: the store written first (a navigation would cut the write short),
// about:blank between (a hash alone wouldn't reload the page).
const cold = async (page, h) => {
  await page.evaluate(() => storeDone());
  await page.goto('about:blank');
  await page.goto('/' + h);
  await page.waitForFunction(() => window.appReady === true);
};
const where = page =>
  page.evaluate(() => ({
    view,
    path: path.slice(),
    kbArt,
    run: !!kbRun,
    triage: !!triage,
    hash: location.hash,
    toast: document.querySelector('#toast').textContent,
  }));

test('every destination opens from a cold launch, and the address is cleaned up', async ({ app, page }) => {
  await app.open();
  await page.evaluate(seed);
  const cases = [
    ['#/today', w => w.view === 'today' && !w.path.length],
    ['#/inbox', w => w.view === 'inbox' && !w.triage],
    ['#/inbox/triage', w => w.view === 'inbox' && w.triage],
    ['#/q/q1', w => w.view === 'today' && w.path.join('/') === 'q1'],
    ['#/q/s1', w => w.view === 'today' && w.path.join('/') === 'q1/s1'],
    ['#/kb/a2', w => w.view === 'knowledge' && w.kbArt === 'a2' && !w.run],
    ['#/kb/a1/run', w => w.view === 'knowledge' && w.kbArt === 'a1' && w.run],
    ['#/waiting', w => w.view === 'waiting'],
    ['#/waiting/s2', w => w.view === 'waiting'],
    ['#/focus', w => w.view === 'focus'],
    ['#/review', w => w.view === 'review'],
    ['#/continue', w => w.view === 'today' && w.path.join('/') === 'q2'],
  ];
  // (about:blank between: a hash alone wouldn't reload the page)
  for (const [h, ok] of cases) {
    await cold(page, h);
    const w = await where(page);
    expect(ok(w), h + ' -> ' + JSON.stringify(w)).toBe(true);
    expect(w.hash, h).toBe('');
  }
  // The marked waiting item, and a task on Upcoming or in the Inbox shown where it is.
  await cold(page, '#/waiting/s2');
  await expect(page.locator('#v-waiting .row.marked')).toContainText('Sign-off');
  await cold(page, '#/q/L1');
  await expect(page.locator('#upd')).toHaveAttribute('open', '');
  await page.evaluate(() => {
    S.inbox[0].node = fix({ id: 'n1', text: 'Idea', children: [fix({ id: 'k1', text: 'Sub' })] });
    save();
  });
  await cold(page, '#/q/k1');
  await expect(page.locator('#v-inbox [data-steps="i1"]')).toHaveAttribute('aria-expanded', 'true');
  // No session was started or changed by any of that; nothing ticked or moved.
  const s = await app.state();
  expect(s.timer).toBeNull();
  expect(s.quests.map(q => q.done)).toEqual([false, false]);
  expect(s.runs).toHaveLength(1);
  expect(s.runs[0].done).toEqual([]);
});

test('a link while the app is open navigates (not a back step); back then walks the app, not the browser', async ({
  app,
  page,
}) => {
  await app.open();
  await page.evaluate(seed);
  await app.go('inbox');
  await page.evaluate(() => (location.hash = '#/q/s1'));
  await expect(page.locator('#v-today h1')).toHaveText('Reconcile');
  expect((await where(page)).hash).toBe('');
  await page.goBack();
  await expect(page.locator('#v-today h1')).toHaveText('Weekly reporting');
  await page.goBack();
  await expect(page.locator('#v-today .row')).toHaveCount(2);
  await expect(page.locator('#v-today')).toBeVisible(); // (still in the app)
  // A link arriving over an open sheet or single-task mode closes them first.
  await page.click('[aria-label="Actions: Call Dana"]');
  await page.evaluate(() => (location.hash = '#/waiting'));
  await expect(page.locator('#sheet')).toHaveCount(0);
  await expect(page.locator('#v-waiting')).toBeVisible();
  await page.evaluate(() => setZen(true));
  await page.evaluate(() => (location.hash = '#/today'));
  await expect(page.locator('#v-zen')).toBeHidden();
  // The article editor isn't clobbered: it asks first.
  await page.evaluate(() => {
    kbEdit = { cat: 'c1', title: 'Draft', body: 'keep' };
    go('knowledge');
  });
  await page.evaluate(() => (location.hash = '#/kb/a2'));
  await expect(page.locator('#sheettitle')).toHaveText('Leave this article?');
  await page.click('#sheet [data-sheetclose]:not(.sheetback)');
  expect(await page.evaluate(() => kbEdit.title)).toBe('Draft');
});

test('missing, invalid or hostile targets fail plainly, change nothing, and never leave the app', async ({
  app,
  page,
}) => {
  await app.open();
  await page.evaluate(seed);
  const canonState = () => page.evaluate(() => JSON.stringify(canon({ ...S, editedAt: 0 })));
  const before = await canonState();
  for (const [h, msg, view] of [
    ['#/q/nope', "task isn't here", 'today'],
    ['#/kb/nope', "article isn't here", 'knowledge'],
    ['#/waiting/s1', "waiting item isn't here", 'waiting'], // (s1 isn't waiting)
    ['#/kb/a2/run', 'no steps to follow', 'knowledge'],
    ['#/nope', "isn't one the Dashboard knows", 'today'],
    ['#/q/<img onerror=x>', "isn't one the Dashboard knows", 'today'],
    ['#/q/%ZZ', "isn't one the Dashboard knows", 'today'],
    ['#/today/extra', "isn't one the Dashboard knows", 'today'],
    ['#/q/' + 'a'.repeat(41), "isn't one the Dashboard knows", 'today'],
  ]) {
    await cold(page, h);
    // (the message may wait on the first word from the sync library, when the service worker
    // has it: signed out, that's a moment)
    await expect.poll(async () => (await where(page)).toast, h).toContain(msg);
    const w = await where(page);
    expect(w.view, h).toBe(view);
    expect(w.hash).toBe('');
  }
  expect(await canonState()).toBe(before);
  expect(await page.evaluate(() => document.querySelectorAll('img[onerror]').length)).toBe(0);
});

test('Settings builds the links; app-icon shortcuts carry routes', async ({ app, page }) => {
  await app.open();
  await page.evaluate(seed);
  await app.go('account');
  const link = () => page.locator('#sclink').textContent();
  expect(await link()).toBe('http://localhost:4173/#/today');
  await page.selectOption('#scpick', 'q');
  expect(await link()).toBe('http://localhost:4173/#/q/q1');
  await page.selectOption('#scid', 'q2');
  expect(await link()).toBe('http://localhost:4173/#/q/q2');
  await page.selectOption('#scpick', 'run');
  await expect(page.locator('#scid option')).toHaveCount(1); // (only the article with steps)
  expect(await link()).toBe('http://localhost:4173/#/kb/a1/run');
  await page.selectOption('#scpick', 'triage');
  expect(await link()).toBe('http://localhost:4173/#/inbox/triage');
  await expect(page.locator('#scid')).toHaveCount(0);
  const m = await (await page.request.get('/manifest.webmanifest')).json();
  expect(m.shortcuts.map(s => s.url)).toEqual([
    './index.html?capture=1',
    './index.html#/inbox/triage',
    './index.html#/continue',
  ]);
});

test('review fix: after a cold launch at a route, back steps through the app once and never replays the route', async ({
  app,
  page,
}) => {
  await app.open();
  await page.evaluate(seed);
  await cold(page, '#/q/s1');
  await expect(page.locator('#v-today h1')).toHaveText('Reconcile');
  expect(await page.evaluate(() => [location.hash, history.state && history.state.app])).toEqual(['', 'in']);
  await page.goBack();
  await expect(page.locator('#v-today h1')).toHaveText('Weekly reporting');
  await page.goBack();
  await expect(page.locator('#v-today .row')).toHaveCount(2);
  await expect(page.locator('#v-today h1')).toHaveCount(0); // (not reopened by a replayed route)
  await cold(page, '#/inbox/triage');
  await expect(page.locator('#v-inbox .tcard')).toBeVisible();
  await page.goBack();
  await expect(page.locator('#iform')).toBeVisible(); // (triage left, not restarted)
  expect(await page.evaluate(() => location.hash)).toBe('');
});

// Release C: the Command Centre.
const { test, expect } = require('./fixtures');

const seed = () => {
  const now = Date.now(),
    t = today();
  S.track = true;
  S.flows = [{ id: 'f1', name: 'Report flow', url: 'ms-powerautomate:/a' }];
  S.kb = [
    {
      id: 'a1',
      cat: '',
      title: 'Extract',
      body: '',
      edited: 1,
      imgs: [],
      steps: [{ id: 'p1', title: 'One' }],
    },
  ];
  S.workflows = [
    {
      id: 'w1',
      name: 'Weekly report',
      stages: [{ id: 's1', type: 'manual', title: 'Prepare' }],
      days: [(new Date().getDay() + 2) % 7],
      monthDay: 0,
      ver: 1,
    },
  ];
  S.quests = [
    fix({ id: 'q1', text: 'Overdue thing', due: shift(t, -1), est: 60 }),
    fix({ id: 'q2', text: 'Due today', due: t }),
    fix({
      id: 'q3',
      text: 'Tomorrow',
      due: shift(t, 1),
      est: 120,
      resume: { note: 'Halfway', at: now, step: '' },
    }),
    fix({ id: 'q4', text: 'Sign-off', wait: { who: 'Sam', note: '', due: t, since: shift(t, -3) } }),
  ];
  S.wruns = [
    {
      id: 'r1',
      wf: 'w1',
      ver: 1,
      name: 'Weekly report',
      def: [{ id: 's1', type: 'manual', title: 'Prepare' }],
      started: now - 3600e3,
      at: now - 3600e3,
      status: 'failed',
      err: 'boom',
      st: {},
      log: [],
      live: {},
    },
    {
      id: 'r2',
      wf: 'w1',
      ver: 1,
      name: 'Weekly report',
      def: [{ id: 's1', type: 'manual', title: 'Prepare' }],
      started: now - 7200e3,
      at: now - 7200e3,
      fin: now - 7000e3,
      status: 'succeeded',
      st: {},
      log: [],
      live: {},
    },
    {
      id: 'r3',
      wf: 'w1',
      ver: 1,
      name: 'Weekly report',
      def: [{ id: 's1', type: 'manual', title: 'Prepare' }],
      started: now - 600e3,
      at: now - 600e3,
      status: 'awaiting_user',
      cur: 's1',
      st: {},
      log: [],
      live: {},
    },
  ];
  S.runs = [
    { id: 'pr1', art: 'a1', q: '', started: now - 100e3, at: now - 100e3, done: [], cur: '', fin: 0 },
  ];
  S.execs = [
    {
      id: 'x1',
      flow: 'f1',
      q: '',
      at: now - 60e3,
      status: 'running',
      msg: '',
      upd: now - 60e3,
      ref: '',
      ev: [],
    },
    {
      id: 'x2',
      flow: 'f1',
      q: '',
      at: now - 2 * 864e5,
      status: 'requested',
      msg: '',
      upd: now - 2 * 864e5,
      ref: '',
      ev: [],
    },
    {
      id: 'x3',
      flow: 'f1',
      q: '',
      at: now - 300e3,
      status: 'failed',
      msg: 'Timeout',
      upd: now - 200e3,
      ref: '',
      ev: [],
    },
  ];
  S.pins = [
    { k: 'wf', id: 'w1' },
    { k: 'flow', id: 'f1' },
    { k: 'view', id: 'forecast' },
    { k: 'kb', id: 'nope' },
  ];
  save();
  renderAll();
};
const rows = (page, i) =>
  page.locator('#v-ops .opsec').nth(i).locator('.oprow .open > span, .attrow .open > span').allTextContents();

test('the five lists come from the records; every row opens its thing; nothing runs on its own', async ({
  app,
  page,
}) => {
  await app.open();
  await page.evaluate(seed);
  const before = await page.evaluate(() => JSON.stringify(canon({ ...S, editedAt: 0 })));
  const weekend = [5, 6, 0].includes(new Date().getDay());
  // Today's summary counts the same items the Command Centre lists.
  await expect(page.locator('#attd > summary')).toContainText('Needs attention ' + (weekend ? 7 : 6));
  await page.click('#v-today .attcc');
  await expect(page.locator('#v-ops .opshead')).toHaveText('Command Centre');
  await expect(page.locator('.opsync')).toContainText("Not syncing this device's records only.");
  expect(await rows(page, 0)).toEqual(
    [
      'Weekly report', // failed run (failures first)
      'Report flow', // failed flow
      'Report flow', // launched two days ago, no word
      'Overdue thing',
      'Due today',
      'Sign-off', // chase due
      'Weekly review',
    ].filter((x, i) => i !== 6 || weekend),
  );
  expect(await rows(page, 1)).toEqual(['Weekly report', 'Extract', 'Report flow', 'Tomorrow']);
  await expect(page.locator('.pins .pin')).toHaveCount(4);
  await expect(page.locator('.pins .pin.gone')).toHaveText('Removed');
  // Recent results: what's finished (failures still needing attention are above, not repeated).
  expect(await rows(page, 3)).toEqual(['Weekly report']);
  const coming = await rows(page, 4);
  expect(coming.length).toBeGreaterThan(0);
  expect(coming.length).toBeLessThanOrEqual(3); // (briefly: the Forecast has the rest)
  await expect(page.locator('#v-ops .opsec').nth(4)).toContainText('workflows: Weekly report');
  // Drawing it changed nothing.
  expect(await page.evaluate(() => JSON.stringify(canon({ ...S, editedAt: 0 })))).toBe(before);
  // Rows open their things.
  await page.click('#v-ops .attrow [data-open="q1"]');
  await expect(page.locator('#v-today h1')).toHaveText('Overdue thing');
  await page.evaluate(() => go('ops'));
  await page.click('#v-ops .attrow [data-wfopen="r1"]');
  await expect(page.locator('#v-knowledge .kbtitle')).toHaveText('Weekly report');
  await page.evaluate(() => go('ops'));
  await page.click('#v-ops .attrow [data-wgo="q4"]');
  await expect(page.locator('#v-waiting .row.marked')).toContainText('Sign-off');
  await page.evaluate(() => go('ops'));
  await page.click('#v-ops .oprow [data-runopen="pr1"]');
  await expect(page.locator('#v-knowledge .kbtitle')).toHaveText('Extract');
  await page.evaluate(() => go('ops'));
  await page.click('#v-ops .oprow [data-open="q3"]');
  await expect(page.locator('#v-today h1')).toHaveText('Tomorrow');
  // Keyboard and the back gesture.
  await page.keyboard.press('o');
  await expect(page.locator('#v-ops')).toBeVisible();
  await page.evaluate(() => history.back());
  await expect(page.locator('#v-today')).toBeVisible();
  expect(app.errors).toEqual([]);
});

test('pins: add, reorder, unpin; a flow pin is a link (a tap launches it); a workflow pin starts a run only when tapped', async ({
  app,
  page,
}) => {
  await app.open();
  await page.evaluate(seed);
  await page.evaluate(() => {
    S.pins = [];
    S.wruns = [];
    save();
  });
  await app.go('ops');
  await expect(page.locator('.pins')).toHaveCount(0);
  await page.click('[data-pinadd]');
  await expect(page.locator('#sheet .qact')).toHaveCount(1 + 1 + 1 + 4 + 6);
  await page.click('#sheet [data-pin="flow"][data-id="f1"]');
  await page.click('#sheet [data-pin="wf"][data-id="w1"]');
  await page.click('#sheet [data-pin="view"][data-id="insights"]');
  await expect(page.locator('#sheet .qact')).toHaveCount(10); // (picked ones leave the list)
  await page.click('#sheet [data-sheetclose]:not(.sheetback)');
  await expect(page.locator('.pins .pin')).toHaveText(['▶ Report flow', 'Weekly report', 'Insights']);
  expect((await app.state()).pins).toEqual([
    { k: 'flow', id: 'f1' },
    { k: 'wf', id: 'w1' },
    { k: 'view', id: 'insights' },
  ]);
  expect(await page.evaluate(() => toRecords(S).has('meta:pins'))).toBe(true);
  await page.click('[data-pinedit]');
  await page.click('[data-pinmv="2"][data-dir="-1"]');
  await expect(page.locator('.pins .pin')).toHaveText(['▶ Report flow', 'Insights', 'Weekly report']);
  await page.click('[data-pindel="0"]');
  await expect(page.locator('.pins .pin')).toHaveText(['Insights', 'Weekly report']);
  await page.click('[data-pinedit]');
  await expect(page.locator('.pins.editing')).toHaveCount(0);
  // Nothing started yet; the workflow pin starts a run on a tap.
  expect((await app.state()).wruns).toHaveLength(0);
  await page.click('.pins [data-wfstart="w1"]');
  await expect(page.locator('#v-knowledge .pstep h3')).toHaveText('Prepare');
  expect((await app.state()).wruns).toHaveLength(1);
  await page.evaluate(() => go('ops'));
  await page.click('.pins [data-opsview="insights"]');
  await expect(page.locator('#v-review')).toBeVisible();
  await expect(page.locator('.rtabs [data-rsub="insights"]')).toHaveAttribute('aria-pressed', 'true');
  // Junk pins are dropped; at most 12.
  await page.evaluate(() => {
    S.pins = [
      { k: 'shell', id: 'x' },
      { k: 'wf', id: 'w1' },
      { k: 'wf', id: 'w1' },
      'junk',
      ...Array.from({ length: 20 }, (_, i) => ({ k: 'q', id: 'q' + i })),
    ];
    norm(S);
  });
  const pins = (await app.state()).pins;
  expect(pins).toHaveLength(12);
  expect(pins[0]).toEqual({ k: 'wf', id: 'w1' });
  expect(app.errors).toEqual([]);
});

test('routines are lists of buttons; the day summary copies; the status line is honest offline', async ({
  app,
  page,
  context,
}) => {
  await app.open();
  await page.evaluate(seed);
  await app.go('ops');
  await page.click('[data-routine="start"]');
  await expect(page.locator('#sheettitle')).toHaveText('Morning checklist');
  const items = await page.locator('#sheet .qact').allTextContents();
  expect(items[0]).toContain('Needs attention: ');
  expect(items[1]).toBe('Pick your Top 3');
  expect(items[2]).toContain('Process the Inbox');
  expect(items[3]).toMatch(/^Today: \d+h \d+m planned of /);
  expect(items[4]).toBe('Start on: Tomorrow'); // (a place saved just now comes first: see recommend)
  await page.click('#sheet [data-top3pick]');
  await expect(page.locator('#sheettitle')).toContainText('Top 3');
  await page.click('#sheet [data-sheetclose]:not(.sheetback)');
  await page.click('[data-routine="finish"]');
  await expect(page.locator('#sheettitle')).toHaveText('End-of-day checklist');
  const fin = await page.locator('#sheet .qact').allTextContents();
  expect(fin[0]).toBe('Save your place on Tomorrow');
  expect(fin[1]).toBe('Waiting: 1 chase due');
  expect(fin[2]).toBe('Workflows under way: 1'); // (the failed one isn't under way)
  expect(fin[4]).toMatch(/^Copy today's summary \(0 quests finished\)$/);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.click('#sheet [data-opscopy]');
  await expect(page.locator('#toast')).toContainText('Copied');
  const text = await page.evaluate(() => daySummary());
  expect(text).toContain('Finished: nothing');
  expect(text).toContain('Still needs attention: Weekly report, Report flow, Report flow, Overdue thing'); // (failures first)
  // No session was started, nothing ticked, nothing launched.
  const s = await app.state();
  expect(s.timer).toBeNull();
  expect(s.wruns.filter(r => r.status === 'awaiting_user')).toHaveLength(1);
  expect(s.execs).toHaveLength(3);
  // Offline: said so.
  await context.setOffline(true);
  await page.evaluate(() => renderOps());
  await expect(page.locator('.opsync')).toContainText("Offline showing this device's records");
  await context.setOffline(false);
  // The deep link and the shortcut builder.
  await page.evaluate(() => storeDone());
  await page.goto('about:blank');
  await page.goto('/#/ops');
  await page.waitForFunction(() => window.appReady === true);
  await expect(page.locator('#v-ops')).toBeVisible();
  expect(await page.evaluate(() => location.hash)).toBe('');
  await app.go('account');
  await page.selectOption('#scpick', 'ops');
  expect(await page.locator('#sclink').textContent()).toBe('http://localhost:4173/#/ops');
  expect(app.errors).toEqual([]);
});

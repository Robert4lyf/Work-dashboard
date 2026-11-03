// Release C: operational analytics under Review > Insights.
const { test, expect } = require('./fixtures');

const seed = () => {
  const now = Date.now(),
    day = 864e5,
    t = today();
  S.flows = [
    { id: 'f1', name: 'Report flow', url: 'ms-powerautomate:/a' },
    { id: 'f2', name: 'Archive flow', url: 'ms-powerautomate:/b' },
  ];
  S.log = [
    { id: 'a', d: t, text: 'A', trail: [], p: '', est: 60, m: 30 },
    { id: 'b', d: shift(t, -1), text: 'B', trail: [], p: '' },
    { id: 'c', d: shift(t, -2), text: 'C', trail: [], p: '', est: 60, m: 60 },
    { id: 'd', d: shift(t, -10), text: 'D', trail: [], p: '' }, // (the period before, for 7 days)
  ];
  S.daily = { [t]: { work: 90 }, [shift(t, -1)]: { work: 30 }, [shift(t, -9)]: { work: 240 } };
  S.interrupts = [{ id: 'i1', t: now - day, text: 'x' }];
  const def = [
    { id: 's1', type: 'manual', title: 'Prepare' },
    { id: 's2', type: 'flow', title: 'Run the flow', flow: 'f1' },
  ];
  S.wruns = [
    {
      id: 'r1',
      wf: 'w1',
      ver: 1,
      name: 'Weekly report',
      def,
      started: now - 2 * day,
      at: now - 2 * day,
      fin: now - 2 * day + 3600e3,
      status: 'succeeded',
      st: {},
      log: [],
      live: {},
    },
    {
      id: 'r2',
      wf: 'w1',
      ver: 1,
      name: 'Weekly report',
      def,
      started: now - day,
      at: now - day,
      fin: 0,
      status: 'failed',
      err: 'Automation failed',
      st: { s2: { o: 'failed', at: now - day, note: 'Automation failed' } },
      log: [],
      live: {},
    },
    {
      id: 'r3',
      wf: 'w1',
      ver: 1,
      name: 'Weekly report',
      def,
      started: now - day,
      at: now - day,
      fin: now - day + 60e3,
      status: 'cancelled',
      st: {},
      log: [],
      live: {},
    },
    {
      id: 'r4',
      wf: 'w1',
      ver: 1,
      name: 'Weekly report',
      def,
      started: now - 3600e3,
      at: now,
      fin: 0,
      status: 'awaiting_user',
      st: {},
      log: [],
      live: {},
    },
    {
      id: 'r5',
      wf: 'w2',
      ver: 1,
      name: 'Month end',
      def: [def[0]],
      started: now - 20 * day,
      at: now - 20 * day,
      fin: now - 20 * day + 600e3,
      status: 'succeeded',
      st: {},
      log: [],
      live: {},
    },
  ];
  const x = (id, flow, at, status, evAt) => ({
    id,
    flow,
    q: '',
    at,
    status,
    msg: '',
    upd: evAt || at,
    ref: '',
    ev: evAt ? [{ i: 1, t: evAt, s: status, m: '' }] : [],
  });
  S.execs = [
    x('x1', 'f1', now - 2 * day, 'succeeded', now - 2 * day + 120e3),
    x('x2', 'f1', now - day, 'failed', now - day + 60e3),
    x('x3', 'f1', now - 2 * day, 'requested'), // (no word after a day: unconfirmed)
    x('x4', 'f2', now - 600e3, 'requested'), // (awaiting)
    x('x5', 'f2', now - 600e3, 'cancelled', now - 300e3),
    x('x6', 'f1', now - 12 * day, 'succeeded', now - 12 * day + 60e3),
  ];
  S.follows = [
    { id: 'fa', n: 'w1', t: now - 5 * day, d: shift(t, -5), k: 'start', note: '' },
    { id: 'fb', n: 'w1', t: now - 3 * day, d: shift(t, -3), k: 'chase', note: '' },
    { id: 'fc', n: 'w1', t: now - day, d: shift(t, -1), k: 'resolve', note: '' },
    { id: 'fd', n: 'w2', t: now - 10 * day, d: shift(t, -10), k: 'start', note: '' },
    { id: 'fe', n: 'w2', t: now - 9 * day, d: shift(t, -9), k: 'resolve', note: '' },
  ];
  S.quests = [
    fix({
      id: 'q1',
      text: 'Sign-off',
      wait: { who: 'Sam', note: '', due: shift(t, -1), since: shift(t, -4) },
    }),
    fix({ id: 'q2', text: 'Quote', wait: { who: 'Dana', note: '', due: '', since: shift(t, -1) } }),
  ];
  S.rlog = [
    { id: 'l1', r: 'r1', t: now - day, k: 'quest_done', key: 'k', out: 'done', m: 'x' },
    { id: 'l2', r: 'r1', t: now - day, k: 'quest_done', key: 'k2', out: 'limit', m: '' },
  ];
  save();
  renderAll();
};

test('the sentences are the same every time and say what each rate is a rate of', async ({ app, page }) => {
  await app.open();
  await page.evaluate(seed);
  const lines = await page.evaluate(() => insightLines(insights(7)).map(([h, ls]) => [h, ls]));
  const by = Object.fromEntries(lines);
  expect(by.Productivity).toEqual([
    '3 tasks finished this period, up 200% on the period before (1).',
    '2h 0m of focus time this period, down 50% on the period before (4h 0m). About 17m a day.',
    '1 interruption noted this period, none the period before.',
  ]);
  expect(by.Processes[0]).toBe(
    '4 runs started: 1 succeeded, 1 failed, 1 cancelled, 1 still under way. Success rate 50% of the 2 runs with an outcome (cancelled and unfinished runs aren’t counted).'.replace(
      '’',
      "'",
    ),
  );
  expect(by.Processes[1]).toBe('4 runs started this period, none the period before.');
  expect(by.Processes[2]).toBe(
    'Weekly report: 4 runs, 1 succeeded, 1 failed, a successful run typically takes 1h 0m; most failed stage: Run the flow (1).',
  );
  expect(by.Automation[0]).toBe(
    '5 automation launches: 1 verified succeeded, 1 verified failed, 1 cancelled, 1 unconfirmed (no word after a day), 1 awaiting a result. Success rate 50% of the 2 verified results. A first report typically arrives 2m after the launch.',
  );
  expect(by.Automation[1]).toBe('5 launches this period, up 400% on the period before (1).');
  expect(by.Automation.slice(2)).toEqual([
    'Report flow: 3 launches, 1 succeeded, 1 failed, 1 unconfirmed, 0 awaiting; 50% of 2 verified.',
    'Archive flow: 2 launches, 0 succeeded, 0 failed, 0 unconfirmed, 1 awaiting; 0% of 0 verified.',
  ]);
  expect(by.Waiting).toEqual([
    '1 waiting item resolved this period, about the same as the period before (1). Typically after 4 days, the longest 4 days.',
    '1 follow-up recorded. 2 items open now.',
    'Sam: 1 open item, waiting up to 4 days, 1 past the chase date.',
    'Dana: 1 open item, waiting up to 1 day.',
  ]);
  expect(by.Estimates[0]).toContain(
    '2 finished tasks with an estimate took 1h 30m of focus time against 2h 0m estimated; the typical task took 1.0× its estimate, and 1 of 2 came within a quarter of it. Estimates are about right.',
  );
  expect(by.Rules).toEqual(['Rules fired 1 time, held back by a daily cap 1 time, with 0 errors.']);
  // Twice the same; a wider period counts the older run and launch too.
  expect(await page.evaluate(() => insightsText(insights(7)))).toBe(
    await page.evaluate(() => insightsText(insights(7))),
  );
  const wide = await page.evaluate(() => insightLines(insights(30)));
  expect(wide[1][1][0]).toContain('5 runs started: 2 succeeded');
  expect(wide[2][1][0]).toContain('6 automation launches: 2 verified succeeded');
  expect(app.errors).toEqual([]);
});

test('the page shows the period, charts and sentences; exports carry the numbers and nothing secret', async ({
  app,
  page,
}) => {
  await app.open();
  await page.evaluate(seed);
  await page.evaluate(() => {
    execToken = 'SECRET-TOKEN-VALUE';
    S.pushKey = 'push-secret';
    save();
  });
  await app.go('review');
  await page.click('[data-rsub="insights"]');
  await expect(page.locator('[data-ispan="30"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#v-review h2')).toHaveText([
    'Productivity',
    'Processes',
    'Automation',
    'Waiting',
    'Estimates',
    'Rules',
  ]);
  await expect(page.locator('.ibars')).toHaveCount(2);
  await expect(page.locator('.ibars').first().locator('.ibar')).toHaveCount(30);
  await page.click('[data-ispan="7"]');
  await expect(page.locator('.ibars').first().locator('.ibar')).toHaveCount(7);
  await expect(page.locator('.ilines').first()).toContainText('3 tasks finished this period');
  const text = await page.evaluate(() => insightsText(insights(7))),
    csv = await page.evaluate(() => insightsCsv(insights(7)));
  expect(text).toContain('Insights, ');
  expect(text).not.toContain('SECRET');
  expect(csv).not.toContain('SECRET');
  expect(csv).not.toContain('push-secret');
  const rows = csv.split('\n');
  expect(rows[0]).toBe(
    'date,quests_finished,focus_minutes,runs_started,runs_succeeded,runs_failed,runs_cancelled,launches,launches_succeeded,launches_failed,launches_unconfirmed,waits_resolved,rules_fired',
  );
  expect(rows).toHaveLength(8);
  const todayRow = rows[7].split(',');
  expect(todayRow[0]).toBe(await page.evaluate(() => today()));
  expect(todayRow.slice(1, 4)).toEqual(['1', '90', '1']);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.click('[data-iexport="text"]');
  await expect(page.locator('#toast')).toContainText('Copied');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-iexport="csv"]')]);
  expect(dl.suggestedFilename()).toMatch(/^dashboard-insights-\d{4}-\d\d-\d\d\.csv$/);
  // The Review tabs: back from Insights goes to Today; History is still its own page.
  await page.click('[data-rsub="log"]');
  await expect(page.locator('#v-log')).toBeVisible();
  await page.click('[data-rsub="insights"]');
  await expect(page.locator('#v-log')).toBeHidden();
  await page.evaluate(() => history.back());
  await expect(page.locator('#v-today')).toBeVisible();
  expect(app.errors).toEqual([]);
});

test('empty records give plain sentences, no errors', async ({ app, page }) => {
  await app.open();
  await app.go('review');
  await page.click('[data-rsub="insights"]');
  await expect(page.locator('#v-review')).toContainText('No tasks finished in either period.');
  await expect(page.locator('#v-review')).toContainText('No process runs started this period.');
  await expect(page.locator('#v-review')).toContainText('No automation launches this period.');
  await expect(page.locator('#v-review')).toContainText('No rules fired this period.');
  await expect(page.locator('#v-review')).toContainText('No finished tasks with an estimate yet');
  expect(app.errors).toEqual([]);
});

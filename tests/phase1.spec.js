// Phase 1 (simplify daily use): one attention list (the Command Centre's), what a busy day's
// cards say on Projects, one rule for what to work on next, and a quieter Command Centre.
const { test, expect } = require('./fixtures');
const { busyDay } = require('./busyday');

test.beforeEach(async ({ page, app }) => {
  await page.clock.install({ time: new Date(2026, 10, 3, 9) });
  await app.open();
});
const busy = async (app, page) => {
  await app.setState(busyDay);
  await page.reload();
};
const attRows = (page, root = '#v-ops .attlist') =>
  page.$$eval(`${root} .attrow`, rs =>
    rs.map(r => [
      r.querySelector('.open > span').textContent,
      r.querySelector('.attgo').textContent.replace(' ›', ''),
    ]),
  );
const card = (page, id) => page.locator(`#v-projects .project-card[data-qid="${id}"]`);

test('an empty day: the Command Centre is one quiet line, no secondary clutter', async ({ app, page }) => {
  await expect(page.locator('#v-projects .project-card')).toHaveCount(0);
  await app.go('ops');
  await expect(page.locator('#v-ops .opsquiet')).toHaveText(
    'All clear: nothing needs you and nothing is running.',
  );
  await expect(page.locator('#v-ops .attlist')).toHaveCount(0);
  // Empty operational sections aren't drawn; Quick launch and the checklists are.
  await expect(page.getByRole('heading', { name: 'Command Centre', level: 1 })).toBeVisible();
  await expect(page.locator('#v-ops h2')).toHaveText(['Quick launch', 'Checklists']);
  await page.evaluate(() => history.back());
  await expect(page.locator('#v-projects')).toBeVisible();
});

test('busy day: one attention list, ordered by urgency; a workflow and its own flow failure are one item', async ({
  app,
  page,
}) => {
  await busy(app, page);
  // On Projects, each card says what's pressing on it.
  await expect(card(page, 'q1').locator('.project-meta .tag.late')).toHaveText('Overdue');
  await expect(card(page, 'q2').locator('.project-meta .tag.now')).toHaveText('Due today');
  await expect(card(page, 'q6').locator('.project-meta .tag.late')).toHaveText('Step overdue');
  await expect(card(page, 'q3').locator('.project-wait')).toHaveText('Waiting on Emily · Chase now');
  // (a card previews three steps: Office move's waiting one is its fourth, shown once it's the
  // active project, where what's being waited on comes straight after the next step)
  await expect(card(page, 'q8').locator('.project-wait')).toHaveCount(0);
  await expect(card(page, 'q8').locator('.project-actions [data-open]')).toHaveText('1 more step');
  await card(page, 'q8').locator('[data-project-activate]').click();
  await expect(page.locator('.active-project .project-card')).toHaveAttribute('data-qid', 'q8');
  await expect(card(page, 'q8').locator('.project-step-name > span')).toHaveText([
    'Next · Draft',
    'Floor plan sign-off',
    'Review',
  ]);
  await expect(card(page, 'q8').locator('.project-wait')).toHaveText('Waiting on Laura · Chase today');
  // The Command Centre lists them all, the most urgent first. Every item says what tapping it does.
  await app.go('ops');
  await expect(page.locator('#v-ops .opsec h2').first()).toHaveText('Needs attention 7');
  expect(await attRows(page)).toEqual([
    ['Month-end report', 'Open the failed step'],
    ['Tidy downloads', 'Open automation details'],
    ['Fletcher Way', 'Open task'],
    ['Client onboarding: Review', 'Open task'], // (Release G: a step named with its task)
    ['Hear back on figures', 'Open in Waiting'],
    ['Filbert Close', 'Open task'],
    ['Floor plan sign-off', 'Open in Waiting'],
  ]);
  // (2 failed · 3 overdue · 2 today)
  await expect(page.locator('#v-ops .attlist .attrow.sev0')).toHaveCount(2);
  await expect(page.locator('#v-ops .attlist .attrow.sev1')).toHaveCount(3);
  await expect(page.locator('#v-ops .attlist .attrow.sev2')).toHaveCount(2);
  await expect(page.locator('#v-ops .attlist .attrow').first()).toBeVisible();
  // (Export report's failure is the Month-end run's failed stage: not a second emergency.)
  await expect(page.locator('#v-ops .attlist')).not.toContainText('Export report');
  // The list is the app's one attention list: the same items, the same count.
  expect(await attRows(page)).toEqual(await page.evaluate(() => attentionItems().map(i => [i.text, i.act])));
  // Recent results don't repeat what still needs attention.
  await expect(page.locator('#v-ops')).not.toContainText('Recent results');
  // Opening the list acknowledged nothing.
  const s = await app.state();
  expect(s.wruns.find(r => r.id === 'r1').ack).toBeUndefined();
  expect(s.execs.find(x => x.id === 'x2').ack).toBeUndefined();
});

test('acting on items: the failed stage opens; acknowledging or resolving updates the count, on a sync redraw too', async ({
  app,
  page,
}) => {
  await busy(app, page);
  await app.go('ops');
  await page.click('#v-ops .attlist [data-wfopen="r1"]');
  await expect(page.locator('.werr')).toContainText('Timed out logging in');
  // Back returns to the Command Centre (where it was opened from), not to the workflow list.
  await expect(page.locator('[data-wfback]')).toHaveText('‹ Command Centre');
  await page.evaluate(() => history.back());
  await expect(page.locator('#v-ops')).toBeVisible();
  await expect(page.locator('#v-ops .opsec h2').first()).toHaveText('Needs attention 7');
  // Changes from another device arrive as a background redraw: acknowledged run, flow and an
  // overdue task finished. The list and its count follow, here and on Projects.
  await page.evaluate(() => {
    S.wruns.find(r => r.id === 'r1').ack = 1;
    S.execs.find(x => x.id === 'x2').ack = 1;
    S.quests[1].done = true;
    S.quests[1].children.forEach(c => (c.done = true));
    inBackground(renderAll);
  });
  await expect(page.locator('#v-ops .opsec h2').first()).toHaveText('Needs attention 4');
  await expect(page.locator('#v-ops .attlist .attrow.sev0')).toHaveCount(0);
  expect(await attRows(page)).toEqual([
    ['Client onboarding: Review', 'Open task'],
    ['Hear back on figures', 'Open in Waiting'],
    ['Filbert Close', 'Open task'],
    ['Floor plan sign-off', 'Open in Waiting'],
  ]);
  // Acknowledged failures are results now.
  await expect(page.locator('#v-ops')).toContainText('Recent results');
  await expect(page.locator('#v-ops')).toContainText('Process failed');
  await app.go('projects');
  await expect(page.locator('#projects-done .project-card h2')).toHaveText(['Fletcher Way']);
  await expect(card(page, 'q1').locator('.tag.late')).toHaveCount(0);
});

test('a flow failure of its own stays its own item; a stale launch inside a run is the run', async ({
  app,
  page,
}) => {
  await app.setState(s => {
    const now = Date.now();
    s.flows = [{ id: 'f1', name: 'Export report', url: 'ms-powerautomate:/x' }];
    s.execs = [
      { id: 'x1', flow: 'f1', at: now - 3600e3, status: 'failed', msg: 'Boom', upd: now - 3600e3, ev: [] },
      {
        id: 'x2',
        flow: 'f1',
        at: now - 50 * 3600e3,
        status: 'running',
        msg: '',
        upd: now - 49 * 3600e3,
        ev: [],
      },
    ];
    const def = [{ id: 's1', type: 'flow', title: 'Export', flow: 'f1' }];
    s.workflows = [{ id: 'wf', name: 'Report run', stages: def, days: [], ver: 1 }];
    s.wruns = [
      {
        id: 'r',
        wf: 'wf',
        ver: 1,
        name: 'Report run',
        def,
        started: now - 50 * 3600e3,
        at: now - 50 * 3600e3,
        cur: 's1',
        st: {},
        live: { exec: 'x2', launched: now - 50 * 3600e3 },
        status: 'awaiting_automation',
      },
    ];
  });
  await page.reload();
  await app.go('ops');
  expect(await attRows(page)).toEqual([
    ['Export report', 'Open automation details'],
    ['Report run', 'Open process'],
  ]);
});

test('the focus recommendation follows one rule: saved place today, else list order; nothing reordered', async ({
  app,
  page,
}) => {
  await busy(app, page);
  const order = await app.order(),
    ids = (await app.state()).quests.map(q => q.id);
  // A place saved an hour ago comes first.
  expect(await page.evaluate(() => recommend()?.why)).toBe('place');
  expect(await page.evaluate(() => recommend()?.q.text)).toBe('Q4 budget report');
  expect(await page.evaluate(() => recommend()?.n.text)).toBe('Review'); // (the step it was saved on)
  // An older saved place doesn't take over: the first task in list order with a step to do does.
  await page.evaluate(() => {
    S.quests[4].resume.at = Date.now() - 3 * 864e5;
    renderAll();
  });
  expect(await page.evaluate(() => recommend()?.why)).toBe('list');
  expect(await page.evaluate(() => recommend()?.q.text)).toBe('Walsingham sale');
  expect(await page.evaluate(() => recommend()?.n.text)).toBe('Review'); // (its Draft is ticked)
  // Focus starts on the same thing.
  expect(await page.evaluate(() => focusTarget())).toBe('q0b');
  // The first waiting on someone, or scheduled: the next in the list.
  await page.evaluate(() => {
    S.quests[0].wait = { who: 'Sam', note: '', due: '', since: today() };
    renderAll();
  });
  expect(await page.evaluate(() => recommend()?.q.text)).toBe('Fletcher Way');
  expect(await page.evaluate(() => focusTarget())).toBe('q1a');
  await page.evaluate(() => {
    S.quests[1].scheduled = { date: today(), time: '15:00' };
    renderAll();
  });
  expect(await page.evaluate(() => recommend()?.q.text)).toBe('Filbert Close');
  // One with a step waiting on someone comes after the rest (Megan finance queries is passed over).
  await page.evaluate(() => {
    S.quests[2].wait = { who: 'Sam', note: '', due: '', since: today() };
    renderAll();
  });
  expect(await page.evaluate(() => recommend()?.q.text)).toBe('Q4 budget report');
  expect(await page.evaluate(() => recommend()?.why)).toBe('list');
  // None of this moved anything, on the board or in the saved order.
  expect(await app.order()).toEqual(order);
  expect(order[0]).toBe('Walsingham sale');
  expect((await app.state()).quests.map(q => q.id)).toEqual(ids);
});

test('a running session wins; a place saved on another task meanwhile leaves it alone', async ({
  app,
  page,
}) => {
  await busy(app, page);
  await page.evaluate(() => {
    delete S.quests[4].resume;
    renderAll();
  });
  await page.keyboard.press('z');
  await page.click('#v-zen [data-zstart]');
  expect((await app.state()).timer.q).toBe('q0b');
  // (the header carries the clock, not a recommendation)
  await expect(page.locator('header #hclock')).toHaveCount(1);
  await page.evaluate(() => {
    S.quests[4].resume = { note: 'Totals checked', at: Date.now(), step: 'q4b' };
    save();
    renderAll();
  });
  expect(await page.evaluate(() => recommend()?.q.text)).toBe('Q4 budget report');
  await expect(page.locator('header #hclock')).toHaveCount(1);
  expect((await app.state()).timer.q).toBe('q0b');
  await expect(page.locator('#v-zen .zt')).toHaveText('Review');
  expect(await page.evaluate(() => zenTarget().parents[0].id)).toBe('q0');
});

test('the checklists say what they are; the Command Centre deep link and Android back work', async ({
  app,
  page,
}) => {
  await busy(app, page);
  await page.goto('/#/ops');
  await page.waitForFunction(() => window.appReady === true);
  await expect(page.locator('#v-ops')).toBeVisible();
  await page.click('[data-routine="start"]');
  await expect(page.locator('#sheettitle')).toHaveText('Morning checklist');
  await expect(page.locator('#sheet')).toContainText('Nothing runs on its own');
  await expect(page.locator('#sheet')).toContainText('Start on: Review'); // (the header's recommendation)
  await page.evaluate(() => history.back());
  await expect(page.locator('#sheet')).toHaveCount(0);
  await page.click('[data-routine="finish"]');
  await expect(page.locator('#sheettitle')).toHaveText('End-of-day checklist');
});

for (const width of [320, 360, 390])
  test(`busy day at ${width}px: nothing scrolls sideways on Projects, a task's page or the Command Centre`, async ({
    app,
    page,
  }) => {
    await page.setViewportSize({ width, height: 760 });
    await busy(app, page);
    const fits = () => page.evaluate(() => document.documentElement.scrollWidth);
    await expect(page.locator('#v-projects .project-card')).toHaveCount(20);
    expect(await fits()).toBeLessThanOrEqual(width);
    // (a card's waiting line and its name don't run off the card)
    const [c, w] = await Promise.all([
      card(page, 'q3').boundingBox(),
      card(page, 'q3').locator('.project-wait').boundingBox(),
    ]);
    expect(w.x).toBeGreaterThanOrEqual(c.x);
    expect(w.x + w.width).toBeLessThanOrEqual(c.x + c.width);
    await app.openQuest('Megan finance queries');
    await expect(page.locator('#v-today .row')).toHaveCount(4);
    expect(await fits()).toBeLessThanOrEqual(width);
    await page.evaluate(() => go('ops'));
    await expect(page.locator('#v-ops .attlist .attrow')).toHaveCount(7);
    expect(await fits()).toBeLessThanOrEqual(width);
  });

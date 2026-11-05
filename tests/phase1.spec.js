// Phase 1 (simplify daily use): Today's hierarchy, one attention list shared with the Command
// Centre, one rule for what to work on next, and a quieter Command Centre.
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
const attRows = (page, root) =>
  page.$$eval(`${root} .attrow`, rs =>
    rs.map(r => [
      r.querySelector('.open > span').textContent,
      r.querySelector('.attgo').textContent.replace(' ›', ''),
    ]),
  );

test('an empty day: one quiet attention line, the Command Centre one tap away, no secondary clutter', async ({
  page,
}) => {
  await expect(page.locator('#v-today .attn')).toHaveText(/Nothing needs attention/);
  // (only the alarms, folded, are below the list)
  await expect(page.locator('#v-today .todaymore details')).toHaveCount(1);
  await page.click('#v-today .attcc');
  await expect(page.locator('#v-ops .opsquiet')).toHaveText(
    'All clear: nothing needs you and nothing is running.',
  );
  // Empty operational sections aren't drawn; Quick launch and the checklists are.
  await expect(page.locator('#v-ops h2')).toHaveText(['Command Centre', 'Quick launch', 'Checklists']);
  await page.evaluate(() => history.back());
  await expect(page.locator('#v-today')).toBeVisible();
});

test('busy day: one attention summary, ordered by urgency; a workflow and its own flow failure are one item', async ({
  app,
  page,
}) => {
  await busy(app, page);
  const sum = page.locator('#attsum');
  await expect(sum).toContainText('Needs attention 7');
  await expect(sum).toContainText('2 failed · 3 overdue · 2 today');
  await expect(sum).toHaveClass(/sev0/);
  // (Release G: compact) The one that matters most is shown straight away, with its action; the
  // rest are folded under "6 more" until opened. Every item says what tapping it does.
  await expect(page.locator('.attfirst .attrow')).toHaveCount(1);
  await expect(page.locator('.attfirst .attrow')).toBeVisible();
  await expect(page.locator('#attd > summary')).toHaveText('6 more');
  await expect(page.locator('#attd .attrow').first()).toBeHidden();
  await page.click('#attd > summary');
  expect(await attRows(page, '.attfirst')).toEqual([['Month-end report', 'Open the failed step']]);
  expect(await attRows(page, '#attd')).toEqual([
    ['Tidy downloads', 'Open automation details'],
    ['Fletcher Way', 'Open task'],
    ['Client onboarding: Review', 'Open task'], // (Release G: a step named with its task)
    ['Hear back on figures', 'Open in Waiting'],
    ['Filbert Close', 'Open task'],
    ['Floor plan sign-off', 'Open in Waiting'],
  ]);
  // (Export report's failure is the Month-end run's failed stage: not a second emergency.)
  await expect(page.locator('#v-today .attn')).not.toContainText('Export report');
  // The Command Centre shows the same items: the same count.
  await page.click('#v-today .attcc');
  expect(await attRows(page, '#v-ops')).toEqual(
    await page.evaluate(() => attentionItems().map(i => [i.text, i.act])),
  );
  await expect(page.locator('#v-ops .opsec h2').first()).toHaveText('Needs attention 7');
  // Recent results don't repeat what still needs attention.
  await expect(page.locator('#v-ops')).not.toContainText('Recent results');
  // Opening the list acknowledged nothing.
  const s = await app.state();
  expect(s.wruns.find(r => r.id === 'r1').ack).toBeUndefined();
  expect(s.execs.find(x => x.id === 'x2').ack).toBeUndefined();
});

test('acting on items: the failed stage opens; acknowledging or resolving updates both counts; a sync redraw keeps the list open', async ({
  app,
  page,
}) => {
  await busy(app, page);
  await page.click('#attd > summary');
  await page.click('.attfirst [data-wfopen="r1"]');
  await expect(page.locator('.werr')).toContainText('Timed out logging in');
  // Back returns to Today (where it was opened from), not to the workflow list.
  await expect(page.locator('[data-wfback]')).toHaveText('‹ Today');
  await page.evaluate(() => history.back());
  await expect(page.locator('#v-today')).toBeVisible();
  await expect(page.locator('#attd')).toHaveAttribute('open', '');
  // Changes from another device arrive as a background redraw: acknowledged run, flow and an
  // overdue task finished. The panel stays open and the counts agree everywhere.
  await page.evaluate(() => {
    S.wruns.find(r => r.id === 'r1').ack = 1;
    S.execs.find(x => x.id === 'x2').ack = 1;
    S.quests[1].done = true;
    S.quests[1].children.forEach(c => (c.done = true));
    inBackground(renderAll);
  });
  await expect(page.locator('#attd')).toHaveAttribute('open', '');
  await expect(page.locator('#attsum')).toContainText('Needs attention 4');
  await expect(page.locator('#attsum')).not.toHaveClass(/sev0/);
  await page.evaluate(() => go('ops'));
  await expect(page.locator('#v-ops .opsec h2').first()).toHaveText('Needs attention 4');
  // Acknowledged failures are results now.
  await expect(page.locator('#v-ops')).toContainText('Recent results');
  await expect(page.locator('#v-ops')).toContainText('Process failed');
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
  expect(await attRows(page, '.attfirst')).toEqual([['Export report', 'Open automation details']]);
  expect(await attRows(page, '#attd')).toEqual([['Report run', 'Open process']]);
});

test('the header follows one rule: saved place today, else Top 3, else list order; nothing reordered', async ({
  app,
  page,
}) => {
  await busy(app, page);
  const head = page.locator('#hnow');
  // A place saved an hour ago comes first, with Continue.
  await expect(head).toContainText('Pick up where you left off · Q4 budget report');
  await expect(page.locator('#hact [data-resume="q4"]')).toHaveText('Continue');
  // An older saved place doesn't take over: Top 3's first task with a step to do does.
  await page.evaluate(() => {
    S.quests[4].resume.at = Date.now() - 3 * 864e5;
    renderAll();
  });
  await expect(head).toContainText('Top 3 priority 1 · Team rota');
  await expect(head.locator('b')).toHaveText('Draft');
  // Focus starts on the same thing.
  expect(await page.evaluate(() => focusTarget())).toBe('q5a');
  // #1 waiting on someone, or done: the next priority.
  await page.evaluate(() => {
    S.quests[5].wait = { who: 'Sam', note: '', due: '', since: today() };
    renderAll();
  });
  // (Release E: numbered as the Top 3 card shows them, where the waiting one is set aside)
  await expect(head).toContainText('Top 3 priority 1 · Q4 budget report');
  await page.evaluate(() => {
    S.top3.ids = ['q9'];
    S.quests[9].children.forEach(c => (c.done = true));
    S.quests[9].done = true;
    renderAll();
  });
  // No Top 3 task with a step left: list order, as before.
  await expect(head).toContainText('Next task · Walsingham sale');
  const order = await app.order();
  expect(order[0]).toBe('Walsingham sale');
  // The Top 3 itself is untouched by any of this.
  expect((await app.state()).top3.ids).toEqual(['q9']);
});

test('a running session wins; changing the Top 3 meanwhile leaves it alone', async ({ app, page }) => {
  await busy(app, page);
  await page.evaluate(() => {
    delete S.quests[4].resume;
    renderAll();
  });
  await page.click('#hact [data-zen]');
  await page.click('#v-zen [data-zstart]');
  expect((await app.state()).timer.q).toBe('q5a');
  // (the header carries the clock, not a recommendation)
  await expect(page.locator('#hnow #hclock')).toHaveCount(1);
  await page.evaluate(() => setTop3(['q9', 'q5']));
  await expect(page.locator('#hnow #hclock')).toHaveCount(1);
  expect((await app.state()).timer.q).toBe('q5a');
});

test("Today's order: attention, Top 3, what it's waiting on, the work; the rest folded at the end", async ({
  app,
  page,
}) => {
  await busy(app, page);
  // (Release H: the line that jumps to each section first)
  const blocks = await page.$$eval('#v-today > *', els =>
    els.map(e => e.className.split(' ')[0] || e.tagName.toLowerCase()),
  );
  expect(blocks.shift()).toBe('tjump');
  // (Release F: Waiting above the list on a phone, so a long day doesn't bury it)
  // (Release G: the list's filter between its title and the list)
  expect(blocks.slice(0, 6)).toEqual(['attn', 'top3', 'todaysec', 'sechead', 'tfilter', 'list']);
  await expect(page.locator('#v-today > .todaysec')).toHaveClass(/waitsec2/);
  expect(blocks[blocks.length - 1]).toBe('todaymore');
  // Flows, steps due soon and the rest are folded there, still a tap away.
  const more = page.locator('#v-today .todaymore');
  await expect(more.locator('#flowsd .flows a')).toHaveCount(3);
  await expect(more.locator('#flowsd .flows a').first()).toBeHidden();
  await more.locator('#flowsd > summary').click();
  await expect(more.locator('#flowsd .flows a').first()).toBeVisible();
  await expect(more.locator('#soond > summary')).toContainText('Steps due soon');
  // Overdue and due-today work is in Needs attention, not repeated in Steps due soon.
  await more.locator('#soond > summary').click();
  await expect(more.locator('#soond')).not.toContainText('Overdue');
  // Top 3 and Waiting start on the first screen of a phone (above the tab bar).
  for (const s of ['#v-today > .top3', '#v-today > .waitsec2']) {
    const top = await page.locator(s).evaluate(e => e.getBoundingClientRect().top);
    expect(top).toBeLessThan(844 - 80);
  }
});

test('board mode keeps the same summary and Top 3 above it', async ({ app, page }) => {
  await busy(app, page);
  await page.click('[data-tview="board"]');
  await expect(page.locator('#attsum')).toContainText('Needs attention 7');
  await expect(page.locator('#v-today .top3')).toBeVisible();
  await expect(page.locator('#v-today .blane')).not.toHaveCount(0);
  await page.click('[data-tview="list"]');
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
  test(`busy day at ${width}px: nothing scrolls sideways, the summary and its link don't overlap`, async ({
    app,
    page,
  }) => {
    await page.setViewportSize({ width, height: 760 });
    await busy(app, page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const [a, b] = await Promise.all([
      page.locator('#attsum b').boundingBox(),
      page.locator('#v-today .attcc').boundingBox(),
    ]);
    expect(a.x + a.width).toBeLessThanOrEqual(b.x);
    await page.evaluate(() => go('ops'));
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });

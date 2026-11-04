// Phases 2 and 3: regression tests for the defects the adversarial passes found.
const { test, expect } = require('./fixtures');

test('audit: back closes an article shown over a process overview first; a typed step counts on Save; a step added with options is required unless skipping is chosen', async ({
  app,
  page,
}) => {
  await app.open();
  await page.evaluate(() => {
    S.kb = [{ id: 'a1', cat: '', title: 'Policy', body: 'x', edited: 1, imgs: [] }];
    S.workflows = [
      {
        id: 'w1',
        name: 'Report',
        ver: 1,
        days: [],
        monthDay: 0,
        stages: [{ id: 's1', type: 'manual', title: 'A' }],
      },
    ];
    save();
  });
  await app.processes();
  await page.click('[data-wfview="w1"]');
  await page.evaluate(() => openSearch());
  await page.fill('#sq', 'policy');
  await page.click('#sres [data-sart="a1"]');
  await expect(page.locator('#v-knowledge .kbtitle')).toHaveText('Policy');
  await page.evaluate(() => history.back());
  await expect(page.locator('#v-knowledge .kbtitle')).toHaveText('Report'); // (one back: the overview under it)
  // Save with a step typed but not added: it's added, not lost.
  await page.click('[data-wfedit="w1"]');
  await page.fill('#wfstepin', 'Typed last');
  await page.click('#wfform .btn.green');
  expect((await app.state()).workflows[0].stages.map(s => s.title)).toEqual(['A', 'Typed last']);
  await page.click('[data-wfedit="w1"]');
  await page.click('#wfstageadd');
  // (Release D: required by default; skipping is an advanced choice on the step)
  await expect(page.locator('#wsadv')).not.toHaveAttribute('open', '');
  await expect(page.locator('#wsskip')).not.toBeChecked();
  await page.click('#sheet [data-sheetclose]:not(.sheetback)');
  await page.click('[data-wfcancel]');
  // Archived processes are listed, folded, and come back.
  await page.click('[data-wfarchive="w1"]');
  await expect(page.locator('#wfarchd summary')).toHaveText('Archived 1');
  await page.click('#wfarchd summary');
  await page.click('#wfarchd [data-wfarchive="w1"]');
  await expect(page.locator('#wfarchd')).toHaveCount(0);
  await expect(page.locator('[data-wfview="w1"]')).toBeVisible();
  expect(app.errors).toEqual([]);
});

test('audit: a saved rule keeps only the details its trigger uses; previews honour the name filter for waiting triggers', async ({
  app,
  page,
}) => {
  await app.open();
  await page.evaluate(() => {
    const now = Date.now();
    S.flows = [{ id: 'f1', name: 'Export', url: 'ms-powerautomate:/x' }];
    S.quests = [
      fix({
        id: 'q1',
        text: 'Sign-off',
        wait: { who: 'Sam', note: '', due: shift(today(), -1), since: shift(today(), -3) },
      }),
      fix({
        id: 'q2',
        text: 'Quote',
        wait: { who: 'Dana', note: '', due: shift(today(), -1), since: shift(today(), -3) },
      }),
    ];
    norm(S);
    S.follows = [
      {
        id: 'c1',
        n: S.quests[0].children[0].id,
        t: now - 864e5,
        d: shift(today(), -1),
        k: 'resolve',
        note: '',
      },
      {
        id: 'c2',
        n: S.quests[1].children[0].id,
        t: now - 864e5,
        d: shift(today(), -1),
        k: 'resolve',
        note: '',
      },
    ];
    save();
  });
  await app.settings('rules');
  await page.click('[data-rulenew]');
  await page.click('[data-rulescratch]');
  await page.fill('#rlname', 'Switched');
  await page.selectOption('#rlon', 'exec_failed');
  await page.selectOption('#rlflow', 'f1');
  await page.selectOption('#rlon', 'wrun_failed');
  await page.selectOption('#rldo', 'note');
  await page.click('#sheetok');
  const r = (await app.state()).rules[0];
  expect(r.on).toEqual({ k: 'wrun_failed' }); // (no automation filter left behind)
  // (a resolve names the waiting step, "Hear back", as the live event does)
  expect(
    await page.evaluate(() => rulePreviewCount({ ...S.rules[0], on: { k: 'wait_resolved', match: 'hear' } })),
  ).toBe(2);
  expect(
    await page.evaluate(() => rulePreviewCount({ ...S.rules[0], on: { k: 'wait_resolved', match: 'zzz' } })),
  ).toBe(0);
  expect(
    await page.evaluate(() => rulePreviewCount({ ...S.rules[0], on: { k: 'wait_due', match: 'quote' } })),
  ).toBe(1);
  expect(
    await page.evaluate(() => rulePreview({ ...S.rules[0], on: { k: 'wait_due', match: 'quote' } }).n),
  ).toBe(1);
  expect(app.errors).toEqual([]);
});

test('audit: a finding opens its process by id, even when renamed; the rule row’s green word stays in the rule row', async ({
  app,
  page,
}) => {
  await app.open();
  await page.evaluate(() => {
    const now = Date.now(),
      day = 864e5;
    const def = [{ id: 's1', type: 'manual', title: 'Step' }];
    S.workflows = [{ id: 'w1', name: 'Renamed since', ver: 2, days: [], monthDay: 0, stages: def }];
    S.wruns = [1, 2].map(i => ({
      id: 'r' + i,
      wf: 'w1',
      ver: 1,
      name: 'Old name',
      def,
      started: now - i * day,
      at: now - i * day,
      status: 'failed',
      err: 'x',
      cur: 's1',
      st: { s1: { o: 'failed', at: now - i * day } },
      log: [],
      live: {},
    }));
    S.quests = [fix({ id: 'q', text: 'Flexible', est: 60 })];
    S.cap = [300, 300, 300, 300, 300, 300, 300];
    save();
  });
  await app.go('review');
  await page.click('[data-rsub="insights"]');
  await page.click('.finding >> nth=0 >> button');
  await expect(page.locator('#v-knowledge .kbtitle')).toHaveText('Renamed since');
  await app.go('review');
  await page.click('[data-rsub="forecast"]');
  const ok = page.locator('.rec.ok').first();
  await expect(ok).toContainText('Everything planned fits');
  expect(await ok.evaluate(el => getComputedStyle(el.querySelector('p')).color)).toBe(
    await page.evaluate(() => getComputedStyle(document.querySelector('.recs')).color),
  );
  expect(app.errors).toEqual([]);
});

test('probe: the overview replaces an open run or article; run sheets act on the run as it is after a pull; capacity keeps focus on Tab', async ({
  app,
  page,
}) => {
  await app.open();
  await page.evaluate(() => {
    const def = [
      { id: 's1', type: 'manual', title: 'A', skip: true },
      { id: 's2', type: 'manual', title: 'B' },
    ];
    S.workflows = [{ id: 'w1', name: 'Report', ver: 1, days: [], monthDay: 0, stages: def }];
    S.kb = [{ id: 'a1', cat: '', title: 'Policy', body: 'x', edited: 1, imgs: [] }];
    S.quests = [fix({ id: 'q', text: 'T', est: 30 })];
    S.cap = [300, 300, 300, 300, 300, 300, 300];
    save();
  });
  await app.processes();
  await page.click('[data-wfstart="w1"]');
  await expect(page.locator('.pstep h3')).toHaveText('A');
  // A sync pull rebuilds the records while the skip sheet is open: the answer still lands.
  await page.click('[data-wfact="skip"]');
  await page.evaluate(() => {
    norm(JSON.parse(JSON.stringify(S)));
    inBackground(renderAll);
  });
  await page.fill('#sheetin', 'Done by hand');
  await page.click('#sheetok');
  expect((await app.state()).wruns[0]).toMatchObject({
    cur: 's2',
    st: { s1: { o: 'skipped', note: 'Done by hand' } },
  });
  // From the run, a finding-style "open the process" shows the overview, not the run.
  await page.evaluate(() => wfClick({ wfview: 'w1' }, null));
  await expect(page.locator('.wfstate')).toContainText('Your turn');
  await expect(page.locator('.pstep')).toHaveCount(0);
  // An article open in Knowledge gives way too.
  await page.evaluate(() => {
    kbArt = 'a1';
    renderKnowledge();
  });
  await expect(page.locator('#v-knowledge .kbtitle')).toHaveText('Policy');
  await page.evaluate(() => wfClick({ wfview: 'w1' }, null));
  await expect(page.locator('#v-knowledge .kbtitle')).toHaveText('Report');
  await expect(page.locator('.wfstate')).toBeVisible();
  // Capacity: Tab after editing a day lands on the next day's field, with the value saved.
  await app.go('review');
  await page.click('[data-rsub="forecast"]');
  await page.click('#capd summary');
  await page.fill('[data-cap="1"]', '120');
  await page.keyboard.press('Tab');
  await expect.poll(() => page.evaluate(() => S.cap[1])).toBe(120);
  await expect
    .poll(() => page.evaluate(() => document.activeElement && document.activeElement.dataset.cap))
    .toBe('2');
  expect(app.errors).toEqual([]);
});

test('probe: back from the process editor asks when something was typed; a failed run is the one offered; a duplicate is shown', async ({
  app,
  page,
}) => {
  await app.open();
  await page.evaluate(() => {
    const def = [{ id: 's1', type: 'manual', title: 'A' }];
    S.workflows = [{ id: 'w1', name: 'Report', ver: 1, days: [], monthDay: 0, stages: def }];
    const now = Date.now();
    S.wruns = [
      {
        id: 'r1',
        wf: 'w1',
        ver: 1,
        name: 'Report',
        def,
        started: now - 7200e3,
        at: now - 7000e3,
        status: 'failed',
        err: 'x',
        cur: 's1',
        st: { s1: { o: 'failed', at: now - 7000e3 } },
        log: [],
        live: {},
      },
      {
        id: 'r2',
        wf: 'w1',
        ver: 1,
        name: 'Report',
        def,
        started: now - 600e3,
        at: now - 600e3,
        status: 'awaiting_user',
        cur: 's1',
        st: {},
        log: [],
        live: {},
      },
    ];
    save();
  });
  await app.processes();
  // (Release D: the row's Fix opens the failed run itself, by its id)
  const fix = page.getByRole('region', { name: 'Processes' }).getByLabel('Fix: Report');
  await expect(fix).toHaveText('Fix');
  expect(await fix.getAttribute('data-wfopen')).toBeTruthy();
  await page.click('[data-wfview="w1"]');
  await expect(page.locator('.wfstate .btn')).toHaveText('Fix the failed step');
  await page.click('[data-wfdup="w1"]');
  await expect(page.locator('#v-knowledge .kbtitle')).toHaveText('Report (copy)');
  // The editor with typed text: Android back asks; Stay keeps it; Leave drops it.
  await page.click('[data-wfedit]');
  await page.fill('#wfname', 'Renamed copy');
  await page.evaluate(() => history.back());
  await expect(page.locator('#sheettitle')).toHaveText('Leave this process?');
  await page.click('#sheet [data-sheetclose]:not(.sheetback)');
  await expect(page.locator('#wfname')).toHaveValue('Renamed copy');
  await page.evaluate(() => history.back());
  await page.click('#sheetok');
  await expect(page.locator('#v-knowledge .kbtitle')).toHaveText('Report (copy)');
  expect((await app.state()).workflows[1].name).toBe('Report (copy)');
  // Nothing typed: back leaves without asking.
  await page.click('[data-wfedit]');
  await page.evaluate(() => history.back());
  await expect(page.locator('#sheet')).toHaveCount(0);
  await expect(page.locator('.wfstate')).toBeVisible();
  expect(app.errors).toEqual([]);
});

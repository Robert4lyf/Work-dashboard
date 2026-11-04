// Phases 2 and 3: regression tests for the defects the adversarial passes found.
const { test, expect } = require('./fixtures');

test('audit: back closes an article shown over a process overview first; a typed step counts on Save; a step added with options may be skipped', async ({
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
  await expect(page.locator('#wsskip')).toBeChecked();
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
  await app.go('account');
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

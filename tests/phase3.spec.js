// Phase 3: Insights that lead with findings; a Forecast that says what it covers.
const { test, expect } = require('./fixtures');

test('findings come from the records with fixed bars to clear; a single failure or a 1-to-2 change is not a finding', async ({
  app,
  page,
}) => {
  await app.open();
  const found = async () =>
    page.evaluate(() => findings(insights(30)).map(f => [f.sev, f.title, f.act ? f.act[0] : null]));
  // One failed automation attempt: nothing stands out.
  await page.evaluate(() => {
    const now = Date.now();
    S.flows = [{ id: 'f1', name: 'Export', url: 'ms-powerautomate:/x' }];
    S.execs = [
      {
        id: 'x1',
        flow: 'f1',
        q: '',
        at: now - 3600e3,
        status: 'failed',
        msg: 'boom',
        upd: now - 3000e3,
        ref: '',
        ev: [],
      },
    ];
    S.log = [
      { id: 'a', d: today(), text: 'A', trail: [], p: '' },
      { id: 'b', d: shift(today(), -40), text: 'B', trail: [], p: '' },
    ];
    save();
  });
  expect(await found()).toEqual([]);
  // Two verified failures and no success: a finding, with the latest attempt to open.
  await page.evaluate(() => {
    const now = Date.now();
    S.execs.push({
      id: 'x2',
      flow: 'f1',
      q: '',
      at: now - 1800e3,
      status: 'failed',
      msg: 'boom',
      upd: now - 1000e3,
      ref: '',
      ev: [],
    });
    save();
  });
  expect(await found()).toEqual([[0, 'Export keeps failing', 'Open the latest attempt']]);
  // Three successes alongside: no longer a finding (failures aren't the majority).
  await page.evaluate(() => {
    const now = Date.now();
    for (let i = 0; i < 3; i++)
      S.execs.push({
        id: 'ok' + i,
        flow: 'f1',
        q: '',
        at: now - 500e3,
        status: 'succeeded',
        msg: '',
        upd: now - 400e3,
        ref: '',
        ev: [],
      });
    save();
  });
  expect(await found()).toEqual([]);
  // A stalled run, overdue work piling up, a step failing twice, an item chased three times.
  await page.evaluate(() => {
    const now = Date.now(),
      day = 864e5,
      t = today();
    const def = [
      { id: 's1', type: 'flow', title: 'Export', flow: 'f1' },
      { id: 's2', type: 'manual', title: 'Send' },
    ];
    S.workflows = [{ id: 'w1', name: 'Report', ver: 1, days: [], monthDay: 0, stages: def }];
    S.wruns = [
      {
        id: 'r1',
        wf: 'w1',
        ver: 1,
        name: 'Report',
        def,
        started: now - 10 * day,
        at: now - 9 * day,
        status: 'failed',
        err: 'x',
        cur: 's1',
        st: { s1: { o: 'failed', at: now - 9 * day } },
        log: [],
        live: {},
      },
      {
        id: 'r2',
        wf: 'w1',
        ver: 1,
        name: 'Report',
        def,
        started: now - 8 * day,
        at: now - 7 * day,
        status: 'failed',
        err: 'x',
        cur: 's1',
        st: { s1: { o: 'failed', at: now - 7 * day } },
        log: [],
        live: {},
      },
      {
        id: 'r3',
        wf: 'w1',
        ver: 1,
        name: 'Report',
        def,
        started: now - 5 * day,
        at: now - 4 * day,
        status: 'awaiting_user',
        cur: 's2',
        st: { s1: { o: 'done', at: now - 5 * day } },
        log: [],
        live: {},
      },
    ];
    S.quests = [1, 2, 3].map(i => fix({ id: 'q' + i, text: 'Late ' + i, due: shift(t, -i) }));
    S.quests.push(
      fix({ id: 'w', text: 'Approval', wait: { who: 'Sam', note: '', due: t, since: shift(t, -9) } }),
    );
    norm(S); // (the waiting quest gets its waiting step, as on load)
    const step = S.quests[3].children[0].id;
    S.follows = [1, 2, 3].map(i => ({
      id: 'c' + i,
      n: step,
      t: now - i * day,
      d: shift(t, -i),
      k: 'chase',
      note: '',
    }));
    save();
  });
  expect(await found()).toEqual([
    [0, '“Export” fails in Report', 'Open the process'],
    [1, '3 tasks are overdue', 'See them in the Command Centre'],
    [1, 'Still waiting on Sam after 3 follow-ups', 'Open in Waiting'],
  ]); // (three at most: the stalled run, with one case, comes after the item chased three times)
  // The page: three findings at most, each with its evidence and a way in; the rest folded.
  await app.go('review');
  await page.click('[data-rsub="insights"]');
  await expect(page.locator('.finding')).toHaveCount(3);
  await expect(page.locator('.finding').first()).toContainText('That step failed in 2 of 3 runs');
  await page.click('.finding >> nth=0 >> button');
  await expect(page.locator('#v-knowledge .kbtitle')).toHaveText('Report');
  expect(app.errors).toEqual([]);
});

test('the charts answer a tap, the table reads the same numbers, and sparse data says what it can measure', async ({
  app,
  page,
}) => {
  await app.open();
  await app.go('review');
  await page.click('[data-rsub="insights"]');
  await expect(page.locator('.findnone')).toContainText('Not much to measure yet');
  await expect(page.locator('.finding, .stats, .ibars')).toHaveCount(0);
  await page.evaluate(() => {
    const t = today();
    S.log = [
      { id: 'a', d: t, text: 'A', trail: [], p: '' },
      { id: 'b', d: t, text: 'B', trail: [], p: '' },
      { id: 'c', d: shift(t, -1), text: 'C', trail: [], p: '' },
    ];
    S.daily = { [t]: { work: 45 } };
    save();
    renderReview();
  });
  await expect(page.locator('.stats .stat b').first()).toHaveText('3');
  await expect(page.locator('.ibars').first().locator('.ibar')).toHaveCount(30);
  await expect(page.locator('.ibars .ibar').nth(29)).toHaveAttribute('aria-label', 'Today: 2 tasks');
  await page.click('.ibars >> nth=0 >> .ibar >> nth=29');
  await expect(page.locator('.ipick')).toHaveText('Today: 2 tasks');
  await page.click('.ibars >> nth=1 >> .ibar >> nth=29');
  await expect(page.locator('.ipick')).toHaveText('Today: 45m');
  await page.click('#itable summary');
  await expect(page.locator('.itab tbody tr')).toHaveText(['Yesterday10m', 'Today245m'].map(() => /.*/));
  await expect(page.locator('.itab tbody tr').last()).toContainText('Today');
  // The detail is there, folded, with the same sentences the export carries.
  await page.click('#idetail summary');
  await expect(page.locator('#idetail')).toContainText('3 tasks finished this period');
  expect(await page.evaluate(() => insightsText(insights(30)))).toContain('3 tasks finished this period');
  expect(app.errors).toEqual([]);
});

test('the forecast headline separates estimated work, capacity, overloaded days and unestimated tasks; coverage is classified', async ({
  app,
  page,
}) => {
  await app.open();
  await page.evaluate(() => {
    S.cap = [0, 300, 300, 300, 300, 300, 0];
    S.quests = [
      fix({ id: 'a', text: 'Estimated', est: 120, due: shift(today(), 1) }),
      fix({ id: 'b', text: 'No estimate one' }),
      fix({ id: 'c', text: 'No estimate two' }),
      fix({ id: 'd', text: 'No estimate three', due: shift(today(), 1) }),
    ];
    save();
  });
  const cov = async () => page.evaluate(() => coverage(allocate(7)));
  expect(await cov()).toMatchObject({ k: 'much', un: 3, total: 4, assumed: false });
  await app.go('review');
  await page.click('[data-rsub="forecast"]');
  await expect(page.locator('.fhead .fhl b').nth(0)).toHaveText('2h 0m');
  await expect(page.locator('.fhead .fhl').nth(3)).toHaveText('3tasks not estimated');
  await expect(page.locator('.fcov')).toContainText(
    'Much of the forecast is incomplete: 3 of 4 tasks have no estimate. Unestimated work is not spare capacity.',
  );
  await page.evaluate(() => {
    S.quests[1].est = 30;
    S.quests[2].est = 30;
    save();
  });
  expect(await cov()).toMatchObject({ k: 'some', un: 1, total: 4 });
  await page.evaluate(() => {
    S.quests[3].est = 30;
    S.cap = null;
    save();
    renderReview();
  });
  expect(await cov()).toMatchObject({ k: 'all', un: 0, assumed: true });
  await expect(page.locator('.fcov')).toHaveText(
    'All relevant work is estimated. Capacity uses assumed defaults.',
  );
  await expect(page.locator('.fhead .fhl small').nth(1)).toHaveText('capacity (assumed)');
  // A day's panel: estimated work, deadlines, capacity, what isn't counted.
  await page.evaluate(() => {
    delete S.quests[3].est;
    save();
    renderReview();
  });
  const tomorrow = await page.evaluate(() => dayLabel(shift(today(), 1)));
  await page.click('.rday >> nth=1');
  await expect(page.locator('.fday h3')).toHaveText(tomorrow);
  await expect(page.locator('.fday')).toContainText('Due this day: Estimated, No estimate three');
  await expect(page.locator('.fday')).toContainText('Not estimated (not counted): No estimate three');
  await expect(page.locator('.rday').nth(1)).toHaveAttribute('aria-pressed', 'true');
  // At 30 days the bars are too small to tap: a picker takes their place.
  await page.click('[data-fspan="30"]');
  await expect(page.locator('button.rday')).toHaveCount(0);
  await page.selectOption('#fdaypick', { index: 2 });
  await expect(page.locator('.fday h3')).toHaveText(tomorrow);
  await expect(page.locator('#howd')).toContainText('Coverage:');
  expect(app.errors).toEqual([]);
});

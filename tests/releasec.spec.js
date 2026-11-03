// Release C: the five scenarios, end to end on one device (the two-device halves are in sync.spec.js).
const { test, expect } = require('./fixtures');

const report = (page, exec, status, id, msg = '') =>
  page.evaluate(
    ([exec, status, id, msg]) => {
      foldExecEvent({
        id,
        execution: exec,
        flow: 'f1',
        status,
        message: msg,
        reported_at: new Date().toISOString(),
      });
      save();
      renderAll();
    },
    [exec, status, id, msg],
  );
const stage = page => page.locator('#v-knowledge .pstep h3');
const flowTap = async page => {
  await page.click('#v-knowledge a[data-flow="f1"]');
  await page.clock.runFor(10);
};

test('Scenario A: Thursday SSRS reporting: a run made ready by the day, the flow’s verified result, checks, send; no second run', async ({
  app,
  page,
}) => {
  await page.clock.install({ time: new Date(2026, 10, 5, 8, 55) }); // a Thursday
  await app.open();
  await page.clock.pauseAt(new Date(2026, 10, 5, 9));
  await page.evaluate(() => {
    S.track = true;
    S.flows = [{ id: 'f1', name: 'SSRS weekly report', url: 'ms-powerautomate:/x', last: 0 }];
    S.workflows = [
      {
        id: 'w1',
        name: 'Thursday SSRS reporting',
        ver: 1,
        days: [4],
        monthDay: 0,
        stages: [
          { id: 's1', type: 'manual', title: 'Check the source data', text: 'Yesterday’s loads finished?' },
          { id: 's2', type: 'flow', title: 'Run the SSRS report flow', flow: 'f1' },
          {
            id: 's3',
            type: 'verify',
            title: 'Check the output',
            checks: ['Week ending is right', 'All regions present'],
          },
          { id: 's4', type: 'manual', title: 'Send to the team' },
        ],
      },
    ];
    S.day = shift(today(), -1);
    rollover();
    save();
    renderAll();
  });
  // The day made one run, ready; the Command Centre and Today both say so; nothing started.
  let s = await app.state();
  expect(s.wruns.map(r => [r.id, r.status])).toEqual([['w1-2026-11-05', 'ready']]);
  await expect(page.locator('#v-today .attn')).toContainText('Workflow ready: Thursday SSRS reporting');
  await page.click('#v-today .chip.ops');
  await expect(page.locator('#v-ops .opsec').first()).toContainText('Workflow ready to start');
  await page.click('#v-ops [data-wfopen="w1-2026-11-05"]');
  await page.click('[data-wfact="begin"]');
  await expect(stage(page)).toHaveText('Check the source data');
  await page.click('[data-wfact="done"]');
  await expect(stage(page)).toHaveText('Run the SSRS report flow');
  await flowTap(page);
  s = await app.state();
  expect(s.execs).toHaveLength(1);
  expect(s.wruns[0].status).toBe('awaiting_automation');
  await expect(page.locator('#v-knowledge')).toContainText('Launched, no word yet');
  await report(page, s.execs[0].id, 'running', 1);
  await expect(page.locator('#v-knowledge')).toContainText('Running');
  await report(page, s.execs[0].id, 'succeeded', 2, 'Report emailed');
  await expect(stage(page)).toHaveText('Check the output');
  await page.check('.wchecks input >> nth=0');
  await page.check('.wchecks input >> nth=1');
  await page.click('[data-wfact="done"]');
  await expect(stage(page)).toHaveText('Send to the team');
  await page.click('[data-wfact="done"]');
  await expect(page.locator('#v-knowledge')).toContainText('Succeeded');
  s = await app.state();
  expect(s.wruns[0]).toMatchObject({
    status: 'succeeded',
    st: { s2: { o: 'done', exec: s.execs[0].id, note: 'Flow: Report emailed' } },
  });
  // The day rolled again (a reload, another device's reset): still one run, done.
  await page.evaluate(() => {
    S.day = shift(today(), -1);
    rollover();
  });
  expect((await app.state()).wruns).toHaveLength(1);
  // Next Thursday is in Coming up; Insights count one run, one verified launch.
  await page.clock.setSystemTime(new Date(2026, 10, 6, 9));
  await page.evaluate(() => {
    rollover();
    renderAll();
  });
  await page.evaluate(() => go('ops'));
  await expect(page.locator('#v-ops .opsec').nth(3)).toContainText('workflows: Thursday SSRS reporting');
  await page.evaluate(() => {
    reviewSub = 'insights';
    go('review');
  });
  await expect(page.locator('#v-review')).toContainText(
    '1 run started: 1 succeeded, 0 failed, 0 cancelled, 0 still under way. Success rate 100% of the 1 run with an outcome',
  );
  await expect(page.locator('#v-review')).toContainText('1 flow launch: 1 verified succeeded');
  expect(app.errors).toEqual([]);
});

test('Scenario B: month-end workload: estimates against capacity show the crunch; a move is offered, explained, and only done on a tap', async ({
  app,
  page,
}) => {
  await page.clock.install({ time: new Date(2026, 10, 23, 9) }); // Monday before month end
  await app.open();
  await page.clock.pauseAt(new Date(2026, 10, 23, 9, 1));
  await page.evaluate(() => {
    S.cap = [0, 240, 240, 240, 240, 240, 0];
    S.quests = [
      fix({ id: 'q1', text: 'Reconcile ledgers', est: 720, due: '2026-11-27' }),
      fix({ id: 'q2', text: 'Accruals', est: 240, due: '2026-11-27' }),
      fix({ id: 'q3', text: 'Board pack', est: 240, due: '2026-11-30' }),
      fix({ id: 'q4', text: 'Intercompany', est: 180, due: '2026-11-27' }),
      fix({ id: 'q5', text: 'Tidy the shared drive' }),
    ];
    S.later = [fix({ id: 'q6', text: 'Close the month', est: 120, start: '2026-11-30', due: '2026-11-30' })];
    S.templates = [fix({ id: 't1', text: 'Daily cash check', est: 30, days: [1, 2, 3, 4, 5], monthDay: 0 })];
    save();
    renderAll();
  });
  await app.go('review');
  await page.click('[data-rsub="forecast"]');
  await page.click('[data-fspan="14"]');
  const f = await page.evaluate(() => {
    const f = allocate(14);
    return {
      days: f.days.map(d => [d.d, d.load, d.cap, d.over]),
      recs: recommendations(f).map(r => r.text),
      none: f.none.map(q => q.text),
    };
  });
  // Mon–Fri this week: 4h a day less the daily check from Tuesday; 10h due Friday fits by
  // Thursday... and the rest lands on Friday as an overrun. Nothing moves until asked.
  expect(f.days[0]).toEqual(['2026-11-23', 240, 240, 0]);
  expect(f.days[4][3]).toBeGreaterThan(0);
  expect(f.recs[0]).toMatch(/^Fri 27 Nov is over by/);
  expect(f.recs[0]).toContain('planned against 4h 0m');
  expect(f.none).toEqual(['Tidy the shared drive']);
  await expect(page.locator('.rday.over')).toHaveCount(2); // (Friday, and the 30th: board pack and close)
  await expect(page.locator('.rec.over').first()).toContainText('Moving');
  const before = await page.evaluate(() => JSON.stringify(canon({ ...S, editedAt: 0 })));
  await page.click('.rec.over [data-fmove]');
  await expect(page.locator('#sheettitle')).toContainText('Move “');
  await page.click('#sheet [data-sheetclose]:not(.sheetback)');
  expect(await page.evaluate(() => JSON.stringify(canon({ ...S, editedAt: 0 })))).toBe(before); // (declined: nothing moved)
  await page.click('.rec.over [data-fmove]');
  await page.click('#sheetok');
  expect((await app.state()).later.length).toBe(2);
  await expect(page.locator('.rday.over')).toHaveCount(1); // (Friday eased; the 30th is still yours to decide)
  // The Command Centre's Coming up shows the week's load.
  await page.evaluate(() => go('ops'));
  await expect(page.locator('#v-ops .opsec').nth(3)).toContainText('planned of 4h 0m');
  expect(app.errors).toEqual([]);
});

test('Scenario C: an automation fails mid-run: the error, a retry as a new attempt, success; the old attempt stays in history and the counts', async ({
  app,
  page,
}) => {
  await page.clock.install({ time: new Date(2026, 10, 5, 9) });
  await app.open();
  await page.clock.pauseAt(new Date(2026, 10, 5, 9, 1));
  await page.evaluate(() => {
    S.track = true;
    S.flows = [{ id: 'f1', name: 'Archive flow', url: 'ms-powerautomate:/x', last: 0 }];
    S.workflows = [
      {
        id: 'w1',
        name: 'Archive run',
        ver: 1,
        days: [],
        monthDay: 0,
        stages: [
          { id: 's1', type: 'flow', title: 'Archive', flow: 'f1' },
          { id: 's2', type: 'manual', title: 'Confirm with the team' },
        ],
      },
    ];
    save();
    renderAll();
  });
  await app.go('knowledge');
  await page.click('[data-wfstart="w1"]');
  await flowTap(page);
  const x1 = (await app.state()).execs[0].id;
  await report(page, x1, 'failed', 1, 'Share not reachable');
  await expect(page.locator('.werr')).toContainText('Flow failed: Share not reachable');
  await expect(page.locator('#v-knowledge .runprog')).toContainText('Failed');
  await app.go('today');
  await expect(page.locator('#v-today .attn')).toContainText('Workflow failed');
  await expect(page.locator('#v-today .attn')).toContainText('Flow failed');
  await page.click('#v-today .attn [data-wfopen]');
  await page.click('[data-wfact="retry"]');
  await expect(page.locator('#sheettitle')).toHaveText('Launch the flow again?');
  await page.click('#sheetok');
  await flowTap(page);
  const s = await app.state();
  expect(s.execs).toHaveLength(2);
  const x2 = s.wruns[0].live.exec;
  expect(x2).not.toBe(x1);
  // A late success for the OLD attempt changes nothing; the new one's result moves on.
  await report(page, x1, 'succeeded', 2);
  expect((await app.state()).wruns[0].cur).toBe('s1');
  await report(page, x2, 'succeeded', 3);
  await expect(stage(page)).toHaveText('Confirm with the team');
  await page.click('[data-wfact="done"]');
  const r = (await app.state()).wruns[0];
  expect(r.status).toBe('succeeded');
  expect(r.log.map(l => l.k)).toEqual([
    'started',
    'launched',
    'failed',
    'retry',
    'launched',
    'done',
    'done',
    'succeeded',
  ]);
  await expect(page.locator('#v-knowledge')).toContainText('What happened');
  await page.evaluate(() => {
    reviewSub = 'insights';
    go('review');
  });
  await expect(page.locator('#v-review')).toContainText(
    '2 flow launches: 2 verified succeeded, 0 verified failed',
  );
  await expect(page.locator('#v-review')).toContainText('1 run started: 1 succeeded');
  expect(app.errors).toEqual([]);
});

test('Scenario D: an NFC card opens the Command Centre; a pinned workflow starts only on a tap; the link runs nothing', async ({
  app,
  page,
}) => {
  await app.open();
  await page.evaluate(() => {
    S.flows = [{ id: 'f1', name: 'Flow', url: 'ms-powerautomate:/x', last: 0 }];
    S.workflows = [
      {
        id: 'w1',
        name: 'Morning checks',
        ver: 1,
        days: [],
        monthDay: 0,
        stages: [{ id: 's1', type: 'manual', title: 'Read the overnight log' }],
      },
    ];
    S.pins = [
      { k: 'wf', id: 'w1' },
      { k: 'flow', id: 'f1' },
    ];
    S.quests = [fix({ id: 'q1', text: 'Plan the day' })];
    save();
  });
  await page.evaluate(() => storeDone());
  await page.goto('about:blank');
  await page.goto('/#/ops');
  await page.waitForFunction(() => window.appReady === true);
  await expect(page.locator('#v-ops .opshead')).toHaveText('Command Centre');
  let s = await app.state();
  expect(s.wruns).toHaveLength(0);
  expect(s.execs).toHaveLength(0);
  expect(s.timer).toBeNull();
  expect(s.flows[0].last).toBe(0);
  expect(await page.evaluate(() => location.hash)).toBe('');
  await page.click('.pins [data-wfstart="w1"]');
  await expect(page.locator('#v-knowledge .pstep h3')).toHaveText('Read the overnight log');
  s = await app.state();
  expect(s.wruns).toHaveLength(1);
  await page.evaluate(() => history.back());
  await expect(page.locator('#v-knowledge h2.kbhead', { hasText: 'Workflows' })).toBeVisible();
  await page.evaluate(() => history.back());
  await expect(page.locator('#v-today')).toBeVisible();
  expect(app.errors).toEqual([]);
});

test('Scenario E: an approval stage waits in the Inbox, is chased by a rule on its date, and the reply moves the run to the decision', async ({
  app,
  page,
}) => {
  await app.open();
  await page.evaluate(() => {
    S.workflows = [
      {
        id: 'w1',
        name: 'Spend approval',
        ver: 1,
        days: [],
        monthDay: 0,
        stages: [
          { id: 's1', type: 'manual', title: 'Write the request' },
          { id: 's2', type: 'wait', title: 'Approval', who: 'Priya' },
          {
            id: 's3',
            type: 'decide',
            title: 'Outcome',
            choices: [
              { label: 'Approved', next: 's5' },
              { label: 'Rejected', next: 's4' },
            ],
          },
          { id: 's4', type: 'manual', title: 'Rework the request' },
          { id: 's5', type: 'manual', title: 'Raise the order' },
        ],
      },
    ];
    S.rules = [
      {
        id: 'r1',
        name: 'Chase',
        on: { k: 'wait_due' },
        do: { k: 'inbox', text: 'Chase {who} about {name}' },
        enabled: true,
      },
    ];
    save();
    renderAll();
  });
  await app.go('knowledge');
  await page.click('[data-wfstart="w1"]');
  await page.click('[data-wfact="done"]');
  await expect(stage(page)).toHaveText('Approval');
  await page.click('[data-wfact="waititem"]');
  let s = await app.state();
  expect(s.wruns[0].status).toBe('waiting');
  expect(s.inbox[0]).toMatchObject({ text: 'Approval (Spend approval)', wait: { who: 'Priya' } });
  const item = s.inbox[0].id;
  await app.go('waiting');
  await expect(page.locator('#v-waiting')).toContainText('Approval (Spend approval)');
  // Two days on, the chase date: the rule adds a reminder, once.
  await page.evaluate(() => {
    S.inbox[0].wait.due = shift(today(), -1);
    S.day = shift(today(), -1);
    rollover();
    S.day = shift(today(), -1);
    rollover();
    renderAll();
  });
  s = await app.state();
  expect(s.inbox.map(i => i.text)).toEqual([
    'Chase Priya about Approval (Spend approval)',
    'Approval (Spend approval)',
  ]);
  await page.evaluate(() => go('ops'));
  await expect(page.locator('#v-ops .opsec').first()).toContainText('Chase Priya');
  await expect(page.locator('#v-ops .opsec').nth(1)).toContainText('Waiting on someone · Approval');
  // The reply: resolved from the Waiting Centre; the run moves to the decision.
  await page.evaluate(id => setWaiting(id, null), item);
  s = await app.state();
  expect(s.wruns[0]).toMatchObject({
    status: 'awaiting_user',
    cur: 's3',
    st: { s2: { o: 'done', wait: item } },
  });
  expect(s.follows.map(f => f.k)).toEqual(['start', 'resolve']);
  await page.evaluate(() => openWorkflowRun(S.wruns[0].id));
  await page.click('[data-wfact="pick"][data-pick="0"]');
  await expect(stage(page)).toHaveText('Raise the order');
  await page.click('[data-wfact="done"]');
  expect((await app.state()).wruns[0].status).toBe('succeeded');
  expect(app.errors).toEqual([]);
});

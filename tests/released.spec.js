// Release D, checkpoint 1: what a process run offers matches what its rules allow, failure
// recovery leads with one action, activity is grouped truthfully, new steps are required, the
// approval example says what it does, and Insights findings point at the right automation.
const { test, expect } = require('./fixtures');
const { processDay } = require('./releaseddata');

const flows = [
  { id: 'f1', name: 'Export', url: 'ms-powerautomate:/console/flow/run?workflowName=a' },
  { id: 'f2', name: 'Export', url: 'ms-powerautomate:/console/flow/run?workflowName=b' },
];
const def = [
  { id: 's1', type: 'manual', title: 'Prepare' },
  { id: 's2', type: 'flow', title: 'Run it', flow: 'f1' },
  { id: 's3', type: 'manual', title: 'Finish', skip: true },
];
// One run in each state, on the stage that makes sense for it.
function runsInEveryState() {
  const now = Date.now(),
    base = (id, status, cur, extra = {}) => ({
      id,
      wf: 'w1',
      ver: 1,
      name: 'Report ' + status,
      q: '',
      def,
      started: now - 9e5,
      at: now - 6e5,
      cur,
      st: {},
      live: {},
      status,
      log: [],
      ...extra,
    });
  return [
    base('ready', 'ready', 's1'),
    base('user', 'awaiting_user', 's1'),
    base('auto', 'awaiting_automation', 's2', { live: { exec: 'x1' } }),
    base('paused', 'paused', 's1'),
    base('failed', 'failed', 's2', {
      st: { s2: { o: 'failed', at: now, note: 'Timeout', exec: 'x0' } },
      err: 'Automation failed: Timeout',
    }),
    base('failskip', 'failed', 's3', { st: { s3: { o: 'failed', at: now, note: 'No' } }, err: 'No' }),
    base('done', 'succeeded', '', { fin: now }),
    base('gone', 'cancelled', 's1', { fin: now }),
  ];
}
async function seedStates(page) {
  await page.evaluate(
    ({ flows, def, runs }) => {
      const now = Date.now();
      S.track = true;
      S.flows = flows;
      S.workflows = [{ id: 'w1', name: 'Report', ver: 1, days: [], monthDay: 0, stages: def }];
      S.execs = [
        { id: 'x0', flow: 'f1', at: now - 7e5, status: 'failed', msg: 'Timeout', upd: now - 6e5, ev: [] },
        { id: 'x1', flow: 'f1', at: now - 1e5, status: 'running', msg: '', upd: now - 1e5, ev: [] },
      ];
      S.wruns = runs;
      norm(S);
      save();
    },
    { flows, def, runs: runsInEveryState() },
  );
}
// The run-level actions the page shows for a run, and whether the engine accepts each one.
const shown = page =>
  page.evaluate(() => [...document.querySelectorAll('#v-knowledge [data-wfact]')].map(b => b.dataset.wfact));
const engineAccepts = (page, id, act) =>
  page.evaluate(
    ({ id, act }) => {
      const r = JSON.parse(JSON.stringify(wrunById(id))),
        s = runStage(r);
      const f = {
        begin: () => beginRun(r),
        resume: () => resumeRun(r),
        pause: () => pauseRun(r),
        cancel: () => cancelRun(r),
        retry: () => retryStage(r, s.id),
        skip: () => completeStage(r, s.id, { o: 'skipped', note: 'x' }),
        done: () => completeStage(r, s.id),
      }[act];
      return f ? f() : '';
    },
    { id, act },
  );

test('every state offers only actions its rules accept; a failed run has no Pause and one Cancel', async ({
  app,
  page,
}) => {
  await app.open();
  await seedStates(page);
  const expected = {
    ready: { has: ['begin', 'cancel'], not: ['pause', 'resume', 'retry'] },
    user: { has: ['done', 'pause', 'cancel', 'copy'], not: ['resume', 'retry', 'ack'] },
    auto: { has: ['pause', 'cancel', 'confirmflow'], not: ['resume', 'retry', 'skip'] },
    paused: { has: ['resume', 'cancel', 'copy'], not: ['pause', 'done', 'retry'] },
    failed: { has: ['retry', 'inbox', 'ack', 'cancel', 'copy'], not: ['pause', 'resume', 'skip', 'done'] },
    failskip: { has: ['retry', 'skip', 'cancel'], not: ['pause', 'resume'] },
    done: { has: ['copy'], not: ['pause', 'cancel', 'retry', 'ack', 'inbox', 'resume'] },
    gone: { has: ['copy'], not: ['pause', 'cancel', 'retry', 'ack', 'inbox', 'resume'] },
  };
  for (const [id, e] of Object.entries(expected)) {
    await page.evaluate(id => openWorkflowRun(id), id);
    const acts = await shown(page);
    for (const a of e.has) expect(acts, `${id} offers ${a}`).toContain(a);
    for (const a of e.not) expect(acts, `${id} doesn't offer ${a}`).not.toContain(a);
    // (no action shown twice: one Cancel, one Copy)
    for (const a of ['cancel', 'copy', 'pause', 'resume', 'retry'])
      expect(acts.filter(x => x === a).length, `${id}: ${a} once`).toBeLessThanOrEqual(1);
    for (const a of acts.filter(a =>
      ['begin', 'resume', 'pause', 'cancel', 'retry', 'skip', 'done'].includes(a),
    ))
      expect(await engineAccepts(page, id, a), `${id}: the engine accepts ${a}`).toBe('');
  }
  // The pure map agrees with the page for the failed run.
  expect(await page.evaluate(() => runActions(wrunById('failed')))).toEqual({
    primary: 'retry',
    more: ['inbox', 'ack', 'cancel', 'copy'],
  });
  expect(app.errors).toEqual([]);
});

test('failure recovery: the error and the retry warning lead, Try again is the one primary action, the rest are under Other options', async ({
  app,
  page,
}) => {
  await app.open();
  await seedStates(page);
  await page.evaluate(() => openWorkflowRun('failed'));
  const card = page.locator('#v-knowledge .pstep.failed');
  await expect(card.locator('.werr')).toContainText('This step failed. Automation failed: Timeout');
  await expect(card.locator('.werr')).toContainText('Last attempt');
  // The warning that the last attempt may have done its work is on the page, not behind a menu.
  await expect(card.locator('.wwarn')).toBeVisible();
  await expect(card.locator('.wwarn')).toContainText('may already have done some of its work');
  await expect(card.locator(':scope > .acts .btn')).toHaveText(['Try again']);
  await expect(card.locator('#wfmore')).not.toHaveAttribute('open', '');
  await expect(card.locator('#wfmore [data-wfact="ack"]')).toBeHidden();
  // No run footer duplicating them.
  await expect(page.locator('#v-knowledge .runfoot')).toHaveCount(0);
  await card.locator('#wfmore summary').click();
  await expect(card.locator('#wfmore .btn')).toHaveText([
    'Add to the Inbox for later',
    'Acknowledge (stays failed)',
    'Cancel the run',
    'Copy details',
  ]);
  // Acknowledging is not fixing: the run stays failed, the page says so, the options stay open
  // over the redraw.
  await card.locator('[data-wfact="ack"]').click();
  let r = await page.evaluate(() => wrunById('failed'));
  expect([r.status, r.ack]).toEqual(['failed', 1]);
  await expect(page.locator('.pstep.failed .pnext')).toContainText('stays failed until');
  await expect(page.locator('#wfmore')).toHaveAttribute('open', '');
  await expect(page.locator('#wfmore [data-wfact="ack"]')).toHaveCount(0);
  // Retry asks first, keeps the old attempt, and is never automatic.
  await page.click('.pstep.failed [data-wfact="retry"]');
  await expect(page.locator('#sheettitle')).toHaveText('Launch the automation again?');
  await page.click('#sheetok');
  r = await page.evaluate(() => wrunById('failed'));
  expect(r.status).toBe('awaiting_user');
  expect(r.live.exec).toBeUndefined();
  expect(await page.evaluate(() => S.execs.length)).toBe(2);
  // A new failure after an acknowledged one needs attention again.
  expect(r.ack).toBeUndefined();
  await page.evaluate(() => {
    const r = wrunById('failed');
    failStage(r, 's2', 'Automation failed: again');
    save();
    renderAll();
  });
  expect(await page.evaluate(() => wrunById('failed').ack)).toBeUndefined();
  expect(await page.evaluate(() => renderAttention())).toContain('Report failed');
  expect(app.errors).toEqual([]);
});

test('a tap on an action the run no longer allows (changed by a sync) is refused, not half-done; sheets act on the run as it is now', async ({
  app,
  page,
}) => {
  await app.open();
  await seedStates(page);
  await page.evaluate(() => openWorkflowRun('user'));
  // Another device fails the run; this page still shows Pause.
  await page.evaluate(() => {
    const r = wrunById('user');
    r.status = 'failed';
    r.err = 'Failed elsewhere';
  });
  await page.click('[data-wfact="pause"]');
  await expect(page.locator('#toast')).toContainText('Not now: the process is failed');
  expect((await page.evaluate(() => wrunById('user'))).status).toBe('failed');
  await expect(page.locator('#v-knowledge [data-wfact="pause"]')).toHaveCount(0);
  // Cancel's sheet open, then a pull replaces the run's record: the cancel lands on the new one.
  await page.evaluate(() => openWorkflowRun('paused'));
  await page.click('.pstep [data-wfact="cancel"]');
  await page.evaluate(() => {
    S.wruns = S.wruns.map(r => JSON.parse(JSON.stringify(r)));
  });
  await page.click('#sheetok');
  const s = await app.state();
  expect(s.wruns.find(r => r.id === 'paused').status).toBe('cancelled');
  expect(app.errors).toEqual([]);
});

test('Processes: failures need attention, runs under way are in progress, a guide inside a process shows through it, two runs of one process both show', async ({
  app,
  page,
}) => {
  await app.open();
  await app.setState(processDay);
  await page.reload();
  await app.processes();
  await expect(page.locator('#wfattn')).toHaveText('Needs attention 1');
  await expect(page.locator('#wfattn + .list .row')).toHaveCount(1);
  await expect(page.locator('#wfattn + .list')).toContainText('Month-end report');
  await expect(page.locator('#wfattn + .list')).toContainText('Failed');
  // In progress: the running and paused runs and the standalone guide; never the failed run,
  // never the guide being followed inside Month-end close as work of its own.
  await expect(page.locator('#wfhead')).toHaveText('In progress 4');
  const prog = page.locator('#wfhead + .list');
  await expect(prog).not.toContainText('Failed');
  await expect(prog.locator('[data-runopen="p1"]')).toHaveCount(0);
  await expect(prog.locator('[data-runopen="p2"]').first()).toContainText('Reset a VPN token');
  await expect(prog.locator('[data-wfopen="r3"]').first()).toContainText('guide: 1 of 3 steps');
  await expect(prog.locator('[data-wfopen="r4"]').last()).toHaveText('Resume');
  // The same process, failed once and running once: both there.
  await expect(page.locator('#v-knowledge [data-wfopen="r1"]').first()).toBeVisible();
  await expect(page.locator('#v-knowledge [data-wfopen="r2"]').first()).toBeVisible();
  // The guide run inside the process is still opened from the process's step.
  await page.click('#v-knowledge .row [data-wfopen="r3"] >> nth=0');
  await page.click('[data-wfact="procedure"]');
  expect(await page.evaluate(() => kbRun)).toBe('p1');
  // A failure acknowledged is still a failure (shown as acknowledged, after the others).
  await page.evaluate(() => {
    wrunById('r1').ack = 1;
    kbRun = kbArt = kbRunBackWf = null;
    renderKnowledge();
  });
  await app.processes();
  await expect(page.locator('#wfattn + .list')).toContainText('Failed · acknowledged');
  // The Command Centre doesn't list the embedded guide, or a run's own automation, twice.
  await page.evaluate(() => go('ops'));
  const rows = await page.evaluate(() => opsProgress().map(r => r.text));
  expect(rows).not.toContain('Month-end close checklist');
  expect(rows).not.toContain('Backup'); // (x3 is the Month-end report run's attempt)
  expect(rows).toContain('Reset a VPN token');
  expect(app.errors).toEqual([]);
});

test('new steps are required; skipping is chosen per step and kept; saved skip settings are unchanged', async ({
  app,
  page,
}) => {
  await app.open();
  await page.evaluate(() => {
    S.workflows = [
      {
        id: 'w1',
        name: 'Old',
        ver: 1,
        days: [],
        monthDay: 0,
        stages: [
          { id: 's1', type: 'manual', title: 'Was skippable', skip: true },
          { id: 's2', type: 'manual', title: 'Was required' },
        ],
      },
    ];
    save();
  });
  await app.processes();
  await page.click('[data-wfview="w1"]');
  await page.click('[data-wfedit="w1"]');
  // Only the step that can be skipped says so.
  await expect(page.locator('#wfstages li').nth(0)).toContainText('can be skipped');
  await expect(page.locator('#wfstages li').nth(1)).not.toContainText('skip');
  await page.fill('#wfstepin', 'Typed');
  await page.keyboard.press('Enter');
  await expect(page.locator('#wfstages li').nth(2)).not.toContainText('skip');
  // Editing the skippable step's title keeps its setting.
  await page.click('#wfstages [data-wfstage="s1"]');
  await expect(page.locator('#wsadv')).toHaveAttribute('open', '');
  await expect(page.locator('#wsskip')).toBeChecked();
  await page.fill('#wstitle', 'Still skippable');
  await page.click('#sheetok');
  // A new step with options: skipping chosen under Advanced.
  await page.click('#wfstageadd');
  await page.fill('#wstitle', 'Optional');
  await page.click('#wsadv summary');
  await page.check('#wsskip');
  await page.click('#sheetok');
  await page.click('#wfform .btn.green');
  const st = (await app.state()).workflows[0].stages;
  expect(st.map(s => [s.title, !!s.skip])).toEqual([
    ['Still skippable', true],
    ['Was required', false],
    ['Typed', false],
    ['Optional', true],
  ]);
  expect(st[2]).not.toHaveProperty('skip');
  // Every example's steps are required, but for one an experienced user may pass over.
  const tpl = await page.evaluate(() =>
    WF_TEMPLATES.map(t =>
      templateToWorkflow(t)
        .stages.filter(s => s.skip)
        .map(s => s.title),
    ),
  );
  expect(tpl.flat()).toEqual(['Read the instructions']);
  expect(app.errors).toEqual([]);
});

test('the approval example records the decision and both answers go on to the follow-up; an old definition still branches', async ({
  app,
  page,
}) => {
  await app.open();
  await page.evaluate(() => {
    S.workflows = [
      {
        id: 'old',
        name: 'Old approval',
        ver: 1,
        days: [],
        monthDay: 0,
        stages: [
          {
            id: 'd',
            type: 'decide',
            title: 'Outcome',
            choices: [
              { label: 'Yes', next: 'z' },
              { label: 'No', next: '' },
            ],
          },
          { id: 'y', type: 'manual', title: 'Rework' },
          { id: 'z', type: 'manual', title: 'Act' },
        ],
      },
    ];
    save();
  });
  for (const [pick, label] of [
    [0, 'Approved'],
    [1, 'Rejected'],
  ]) {
    const r = await page.evaluate(pick => {
      const t = WF_TEMPLATES.find(x => x.name === 'Approval process'),
        w = templateToWorkflow(t);
      S.workflows.push(w);
      const r = makeRun(w);
      S.wruns.push(r);
      completeStage(r, r.cur);
      completeStage(r, r.cur, { note: 'received' });
      openWorkflowRun(r.id);
      return r.id;
    }, pick);
    await expect(page.locator('.pstep h3')).toHaveText('Record the decision');
    await expect(page.locator('.pstep .pnext')).toContainText('Your choice is recorded');
    await page.click(`[data-wfact="pick"][data-pick="${pick}"]`);
    const run = await page.evaluate(id => wrunById(id), r);
    const dec = run.def.find(s => s.title === 'Record the decision');
    expect(run.st[dec.id]).toMatchObject({ o: 'done', pick, note: label });
    await expect(page.locator('.pstep h3')).toHaveText('Follow up on the decision');
    await expect(page.locator('.pstep')).toContainText('Rejected: rework the request');
  }
  // An existing definition with a real jump keeps it.
  const old = await page.evaluate(() => {
    const r = makeRun(wfById('old'));
    S.wruns.push(r);
    completeStage(r, 'd', { pick: 0 });
    const a = r.cur;
    const r2 = makeRun(wfById('old'));
    completeStage(r2, 'd', { pick: 1 });
    return [a, r2.cur];
  });
  expect(old).toEqual(['z', 'y']);
  expect(app.errors).toEqual([]);
});

test('Insights: a repeated failure links to that automation’s own latest failure, by id, in the period, beyond the table’s six', async ({
  app,
  page,
}) => {
  await app.open();
  const f = await page.evaluate(() => {
    const now = Date.now(),
      D = 864e5,
      x = (id, flow, status, ago) => ({
        id,
        flow,
        at: now - ago,
        status,
        msg: '',
        upd: now - ago + 1000,
        ev: [],
      });
    S.flows = [
      { id: 'fa', name: 'Export', url: 'https://example.com/a' },
      { id: 'fb', name: 'Export', url: 'https://example.com/b' }, // (the same name)
      { id: 'fr', name: 'Renamed now', url: 'https://example.com/r' },
      ...Array.from({ length: 7 }, (_, i) => ({
        id: 'busy' + i,
        name: 'Busy ' + i,
        url: 'https://example.com/' + i,
      })),
    ];
    S.execs = [
      // fa: failing twice; fb, the same name, failed most recently but only once, and succeeds.
      x('a1', 'fa', 'failed', 3 * D),
      x('a2', 'fa', 'failed', 2 * D),
      x('b1', 'fb', 'failed', 1 * D),
      x('b2', 'fb', 'succeeded', 1.5 * D),
      x('b3', 'fb', 'succeeded', 1.2 * D),
      // fr: renamed since; its failures still its own.
      x('r1', 'fr', 'failed', 4 * D),
      x('r2', 'fr', 'failed', 3.5 * D),
      // a deleted automation, history kept; one failure outside the period is newer than none.
      x('g1', 'fgone', 'failed', 5 * D),
      x('g2', 'fgone', 'failed', 4.5 * D),
      x('g0', 'fgone', 'failed', 60 * D),
      // seven busy, healthy automations: the low-volume failing ones fall outside the top six.
      ...Array.from({ length: 7 }, (_, i) =>
        Array.from({ length: 5 }, (_, j) => x(`k${i}${j}`, 'busy' + i, 'succeeded', (j + 1) * 0.3 * D)),
      ).flat(),
    ];
    const ins = insights(30);
    return {
      table: ins.auto.table.map(t => t.id),
      found: findings(ins)
        .filter(f => / keeps failing$/.test(f.title))
        .map(f => [f.title, f.act && f.act[1]]),
    };
  });
  expect(f.table).not.toContain('fa');
  expect(f.found).toEqual(
    expect.arrayContaining([
      ['Export keeps failing', 'data-xdet="a2"'],
      ['Renamed now keeps failing', 'data-xdet="r2"'],
      ['removed automation keeps failing', 'data-xdet="g2"'],
    ]),
  );
  expect(f.found.map(x => x[1])).not.toContain('data-xdet="b1"');
  expect(f.found.map(x => x[1])).not.toContain('data-xdet="g0"');
  expect(app.errors).toEqual([]);
});

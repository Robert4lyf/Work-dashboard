// Release C: executable workflows (definitions, runs, the state machine, stages, recurrence).
const { test, expect, unfold } = require('./fixtures');

const seed = () => {
  S.track = true;
  S.flows = [{ id: 'f1', name: 'Report flow', url: 'ms-powerautomate:/flows/x' }];
  S.kb = [
    {
      id: 'a1',
      cat: '',
      title: 'Extract procedure',
      body: '',
      edited: 1,
      imgs: [],
      steps: [
        { id: 'p1', title: 'Pull' },
        { id: 'p2', title: 'Save' },
      ],
    },
  ];
  S.quests = [fix({ id: 'q1', text: 'Weekly reporting' })];
  S.workflows = [
    {
      id: 'w1',
      name: 'Thursday report',
      desc: '',
      ver: 1,
      days: [],
      monthDay: 0,
      q: 'q1',
      stages: [
        { id: 's1', type: 'manual', title: 'Prepare', text: 'Check the data', skip: true },
        { id: 's2', type: 'flow', title: 'Run the flow', flow: 'f1' },
        { id: 's3', type: 'verify', title: 'Check', checks: ['Right period', 'File complete'] },
        { id: 's4', type: 'procedure', title: 'Extract', kb: 'a1' },
        { id: 's5', type: 'wait', title: 'Sign-off', who: 'Sam' },
        {
          id: 's6',
          type: 'decide',
          title: 'Outcome',
          choices: [
            { label: 'Approved', next: 's8' },
            { label: 'Rework', next: 's7' },
          ],
        },
        { id: 's7', type: 'manual', title: 'Rework' },
        { id: 's8', type: 'manual', title: 'Send' },
      ],
    },
  ];
  save();
  renderAll();
};
const run = page => page.evaluate(() => JSON.parse(JSON.stringify(S.wruns[0])));
const stage = page => page.locator('#v-knowledge .pstep h3');
const report = (page, exec, status, id, msg = '') =>
  page.evaluate(
    ([exec, status, id, msg]) =>
      foldExecEvent({
        id,
        execution: exec,
        flow: 'f1',
        status,
        message: msg,
        reported_at: new Date().toISOString(),
      }),
    [exec, status, id, msg],
  );

test('a run walks every kind of stage: flow result verified by report, checks, a procedure, a wait, a decision branch', async ({
  app,
  page,
}) => {
  await app.open();
  await page.evaluate(seed);
  await app.processes();
  await expect(page.locator('#v-knowledge')).toContainText('Thursday report');
  await page.click('[data-wfstart="w1"]');
  await expect(stage(page)).toHaveText('Prepare');
  expect((await run(page)).status).toBe('awaiting_user');
  expect((await run(page)).def).toHaveLength(8); // (its own copy of the stages)
  await page.click('[data-wfact="done"]');
  await expect(stage(page)).toHaveText('Run the flow');
  // Nothing moves on until the flow reports: the launch is the stage's own attempt.
  await page.click('#v-knowledge a[data-flow="f1"]');
  await page.evaluate(() => new Promise(r => setTimeout(r, 20)));
  let r = await run(page);
  expect(r.status).toBe('awaiting_automation');
  expect(r.live.exec).toBeTruthy();
  await expect(page.locator('#v-knowledge')).toContainText('Launched, no word yet');
  await report(page, r.live.exec, 'running', 1);
  await page.evaluate(() => renderKnowledge());
  expect((await run(page)).status).toBe('awaiting_automation');
  await report(page, r.live.exec, 'succeeded', 2, 'Done in 4s');
  await page.evaluate(() => {
    save();
    renderKnowledge();
  });
  r = await run(page);
  expect(r.cur).toBe('s3');
  expect(r.st.s2).toMatchObject({
    o: 'done',
    exec: r.live.exec || r.st.s2.exec,
    note: 'Automation: Done in 4s',
  });
  // A late "running" for that execution changes nothing (the result is final).
  await report(page, r.st.s2.exec, 'running', 3);
  expect((await run(page)).cur).toBe('s3');
  // Verification: every check ticked first.
  await expect(stage(page)).toHaveText('Check');
  await expect(page.locator('[data-wfact="done"]')).toBeDisabled();
  await page.check('.wchecks input >> nth=0');
  await expect(page.locator('[data-wfact="done"]')).toBeDisabled();
  await page.check('.wchecks input >> nth=1');
  await page.click('[data-wfact="done"]');
  // The procedure: opened as a run of its own, back comes here, finishing moves the stage on.
  await expect(stage(page)).toHaveText('Extract');
  await page.click('[data-wfact="procedure"]');
  await expect(page.locator('#v-knowledge .kbtitle')).toHaveText('Extract procedure');
  await expect(page.locator('[data-runback]')).toHaveText('‹ Back to the process');
  await page.click('[data-runback]');
  await expect(stage(page)).toHaveText('Extract');
  await expect(page.locator('[data-wfact="procedure"]')).toHaveText('Continue the guide');
  await page.click('[data-wfact="procedure"]');
  await page.click('[data-rundone]');
  await page.click('[data-rundone]');
  await page.click('[data-runfinish]');
  await expect(stage(page)).toHaveText('Sign-off'); // (back here, moved on)
  r = await run(page);
  expect(r.st.s4.o).toBe('done');
  expect(r.st.s4.run).toBeTruthy();
  // The wait: an Inbox waiting item on Sam, named the same on every device; clearing it moves on.
  await page.click('[data-wfact="waititem"]');
  r = await run(page);
  expect(r.status).toBe('waiting');
  const it = await page.evaluate(() => S.inbox[0]);
  expect(it.wait.who).toBe('Sam');
  expect(it.id).toBe(await page.evaluate(() => keyId('w:' + S.wruns[0].id + ':s5')));
  await page.evaluate(id => setWaiting(id, null), it.id);
  await page.evaluate(() => renderKnowledge());
  await expect(stage(page)).toHaveText('Outcome');
  // The decision: Rework jumps to s7, then s8 follows in order.
  await page.click('[data-wfact="pick"][data-pick="1"]');
  await expect(stage(page)).toHaveText('Rework');
  await page.click('[data-wfact="done"]');
  await expect(stage(page)).toHaveText('Send');
  await page.click('[data-wfact="done"]');
  r = await run(page);
  expect(r.status).toBe('succeeded');
  expect(r.fin).toBeGreaterThan(0);
  expect(Object.keys(r.st).sort()).toEqual(['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8']);
  await expect(page.locator('#v-knowledge')).toContainText('Completed');
  // The task page lists nothing running; the summary copies.
  expect(app.errors).toEqual([]);
});

test('failure: the error is shown, retry is a new attempt (the old execution kept), skip needs a reason, pause, cancel, inbox', async ({
  app,
  page,
}) => {
  await app.open();
  await page.evaluate(seed);
  await app.processes();
  await page.click('[data-wfstart="w1"]');
  await page.click('[data-wfact="done"]');
  await page.click('#v-knowledge a[data-flow="f1"]');
  await page.evaluate(() => new Promise(r => setTimeout(r, 20)));
  let r = await run(page);
  const first = r.live.exec;
  await report(page, first, 'failed', 1, 'Timeout');
  await page.evaluate(() => {
    save();
    renderAll();
  });
  r = await run(page);
  expect(r.status).toBe('failed');
  expect(r.err).toBe('Automation failed: Timeout');
  await expect(page.locator('.werr')).toContainText('Timeout');
  await app.go('today');
  await expect(page.locator('#v-today .attn [data-wfopen]')).toContainText('Process failed');
  await unfold(page, 'attd');
  await page.click('#v-today .attn [data-wfopen]');
  // Retry: asks first (the flow may have done its work), then a fresh attempt.
  await page.click('[data-wfact="retry"]');
  await expect(page.locator('#sheettitle')).toHaveText('Launch the automation again?');
  await page.click('#sheetok');
  r = await run(page);
  expect(r.status).toBe('awaiting_user');
  expect(r.live.exec).toBeUndefined();
  expect(r.live.tries).toBe(1);
  expect(r.st.s2).toBeUndefined();
  await page.click('#v-knowledge a[data-flow="f1"]');
  await page.evaluate(() => new Promise(r => setTimeout(r, 20)));
  r = await run(page);
  expect(r.live.exec).not.toBe(first);
  expect(await page.evaluate(() => S.execs.length)).toBe(2); // (the failed one stays)
  // A result for the OLD execution doesn't move the new attempt on.
  await report(page, first, 'succeeded', 2);
  expect((await run(page)).cur).toBe('s2');
  expect((await run(page)).status).toBe('awaiting_automation');
  // Pause: nothing moves while paused, even a result; resume settles it.
  await page.click('[data-wfact="pause"]');
  expect((await run(page)).status).toBe('paused');
  await report(page, r.live.exec, 'succeeded', 3);
  expect((await run(page)).status).toBe('paused');
  expect((await run(page)).cur).toBe('s2');
  await page.click('[data-wfact="resume"]');
  // (the result arrived while paused: applied on resume, so the stage is done)
  await expect(stage(page)).toHaveText('Check');
  expect((await run(page)).st.s2).toMatchObject({ o: 'done', exec: r.live.exec });
  await page.click('[data-wfact="fail"]');
  await page.fill('#sheetin', 'Wrong period');
  await page.click('#sheetok');
  r = await run(page);
  expect(r.status).toBe('failed');
  expect(r.st.s3).toMatchObject({ o: 'failed', note: 'Wrong period' });
  // Skip isn't offered for a stage that can't be: Check can't, Prepare could.
  await expect(page.locator('[data-wfact="skip"]')).toHaveCount(0);
  await page.click('[data-wfact="inbox"]');
  expect(await page.evaluate(() => S.inbox[0].text)).toBe('Process failed: Thursday report');
  expect((await run(page)).ack).toBe(1);
  expect(await page.evaluate(() => renderAttention())).not.toContain('Process failed');
  await page.click('[data-wfact="retry"]');
  expect((await run(page)).status).toBe('awaiting_user');
  await page.click('[data-wfact="cancel"]');
  await page.click('#sheetok');
  r = await run(page);
  expect(r.status).toBe('cancelled');
  expect(r.fin).toBeGreaterThan(0);
  expect(r.log.map(l => l.k)).toEqual([
    'started',
    'done',
    'launched',
    'failed',
    'retry',
    'launched',
    'paused',
    'resumed',
    'done',
    'failed',
    'retry',
    'cancelled',
  ]);
  // A cancelled run takes nothing more.
  expect(await page.evaluate(() => completeStage(S.wruns[0], 's3'))).toBe('the run is over');
  expect(app.errors).toEqual([]);
});

test('skipping needs a reason and is kept as skipped, not done; tracking off asks you to confirm a flow’s result', async ({
  app,
  page,
}) => {
  await app.open();
  await page.evaluate(seed);
  await page.evaluate(() => {
    S.track = false;
    save();
  });
  await app.processes();
  await page.click('[data-wfstart="w1"]');
  await page.click('[data-wfact="skip"]');
  await page.fill('#sheetin', 'Done yesterday');
  await page.click('#sheetok');
  let r = await run(page);
  expect(r.st.s1).toMatchObject({ o: 'skipped', note: 'Done yesterday' });
  await expect(page.locator('#v-knowledge')).toContainText('Result tracking is off');
  await page.click('#v-knowledge a[data-flow="f1"]');
  await page.evaluate(() => new Promise(r => setTimeout(r, 20)));
  r = await run(page);
  expect(r.status).toBe('awaiting_user');
  expect(r.live.exec).toBeUndefined();
  expect(r.log.find(l => l.k === 'launched').m).toBe('untracked');
  await page.click('[data-wfact="confirmflow"][data-ok="no"]');
  r = await run(page);
  expect(r.status).toBe('failed');
  expect(r.err).toBe('Failed (confirmed by hand)');
  expect(app.errors).toEqual([]);
});

test('a definition edited later is a new version; a run under way keeps its own copy; archive hides it', async ({
  app,
  page,
}) => {
  await app.open();
  await page.evaluate(seed);
  await app.processes();
  await page.click('[data-wfstart="w1"]');
  await page.click('[data-wfback]');
  await app.processes();
  await page.click('[data-wfview="w1"]');
  await page.click('[data-wfedit="w1"]');
  await page.fill('#wfname', 'Thursday report v2');
  await page.click('[data-wfdel="s1"]');
  await page.click('#wfform .btn.green');
  const s = await app.state();
  expect(s.workflows[0]).toMatchObject({ name: 'Thursday report v2', ver: 2 });
  expect(s.workflows[0].stages.map(x => x.id)[0]).toBe('s2');
  expect(s.wruns[0]).toMatchObject({ ver: 1, name: 'Thursday report', cur: 's1' });
  expect(s.wruns[0].def).toHaveLength(8);
  // A save without a change isn't a version.
  await app.processes();
  await page.click('[data-wfview="w1"]');
  await page.click('[data-wfedit="w1"]');
  await page.click('#wfform .btn.green');
  expect((await app.state()).workflows[0].ver).toBe(2);
  // The editor's stage sheet: a flow stage must name a flow; a procedure one, a procedure.
  await app.processes();
  await page.click('[data-wfview="w1"]');
  await page.click('[data-wfedit="w1"]');
  await page.click('#wfstageadd');
  await page.selectOption('#wstype', 'flow');
  await page.fill('#wstitle', 'Another flow');
  await page.click('#sheetok');
  await expect(page.locator('#toast')).toContainText('Choose the desktop automation to launch');
  await page.selectOption('#wsflow', 'f1');
  await page.click('#sheetok');
  await expect(page.locator('#sheet')).toHaveCount(0);
  await expect(page.locator('#wfstages li')).toHaveCount(8);
  await page.click('[data-wfup]:not([disabled]) >> nth=0');
  await page.click('#wfform .btn.green');
  const w = (await app.state()).workflows[0];
  expect(w.ver).toBe(3);
  expect(w.stages[7].title).toBe('Another flow');
  expect(w.stages.map(x => x.id).slice(0, 2)).toEqual(['s3', 's2']);
  // Back (Android) leaves the editor without saving.
  await app.processes();
  await page.click('[data-wfview="w1"]');
  await page.click('[data-wfedit="w1"]');
  await page.fill('#wfname', 'Unsaved');
  await page.evaluate(() => history.back());
  await expect(page.locator('#wfform')).toHaveCount(0);
  expect((await app.state()).workflows[0].name).toBe('Thursday report v2');
  await app.processes();
  await page.click('[data-wfview="w1"]');
  await page.click('[data-wfedit="w1"]');
  await page.click('[data-wfarchive="w1"]');
  await expect(page.locator('[data-wfedit="w1"]')).toHaveCount(0);
  await expect(page.locator('#wfarchd summary')).toHaveText('Archived 1');
  await page.click('#wfarchd summary');
  await expect(page.locator('#wfarchd [data-wfarchive="w1"]')).toHaveText('Unarchive');
  expect(app.errors).toEqual([]);
});

test('a recurring workflow gets one ready run per day, the same id on every device, never started on its own', async ({
  app,
  page,
}) => {
  await app.open();
  await page.evaluate(seed);
  const d = await page.evaluate(() => {
    S.workflows[0].days = [0, 1, 2, 3, 4, 5, 6];
    S.day = shift(today(), -1);
    rollover();
    return today();
  });
  let s = await app.state();
  expect(s.wruns).toHaveLength(1);
  expect(s.wruns[0]).toMatchObject({ id: 'w1-' + d, status: 'ready', wf: 'w1' });
  // A second reset (another device's, or a reload) adds no second run; nor after it's cleared.
  await page.evaluate(() => {
    S.day = shift(today(), -1);
    rollover();
  });
  expect((await app.state()).wruns).toHaveLength(1);
  await page.evaluate(d => {
    S.wruns = [];
    sync2.gone = { ['wrun:w1-' + d]: 1 };
    S.day = shift(today(), -1);
    rollover();
  }, d);
  expect((await app.state()).wruns).toHaveLength(0);
  await page.evaluate(() => {
    delete sync2.gone;
    S.day = shift(today(), -1);
    rollover();
    renderAll();
  });
  await expect(page.locator('#v-today .attn [data-wfopen]')).toContainText('Thursday report');
  await unfold(page, 'attd');
  await page.click('#v-today .attn [data-wfopen]');
  await expect(page.locator('#v-knowledge .pstep h3')).toHaveText('Ready to start');
  await page.click('[data-wfact="begin"]');
  s = await app.state();
  expect(s.wruns[0].status).toBe('awaiting_user');
  // Starting it from the list resumes that run rather than making another.
  // (back goes to Today, where it was opened from; the list is in Knowledge)
  await page.click('[data-wfback]');
  await expect(page.locator('#v-today')).toBeVisible();
  await page.evaluate(() => followRoute({ kind: 'workflows', id: '' }));
  await page.click('[data-wfstart="w1"]');
  expect((await app.state()).wruns).toHaveLength(1);
  expect(app.errors).toEqual([]);
});

test('deep links open the list and a run (opening never moves a run on); junk is refused', async ({
  app,
  page,
}) => {
  await app.open();
  await page.evaluate(seed);
  await page.evaluate(() => {
    S.wruns.push(makeRun(S.workflows[0], { id: 'r1' }));
    save();
  });
  const cold = async h => {
    await page.evaluate(() => storeDone());
    await page.goto('about:blank');
    await page.goto('/' + h);
    await page.waitForFunction(() => window.appReady === true);
  };
  await cold('#/wrun/r1');
  await expect(page.locator('#v-knowledge .kbtitle')).toHaveText('Thursday report');
  expect(await page.evaluate(() => [location.hash, S.wruns[0].cur, S.wruns[0].log.length])).toEqual([
    '',
    's1',
    1,
  ]);
  await cold('#/workflows');
  await expect(page.locator('#wfhead')).toBeVisible();
  await cold('#/wrun/nope');
  await expect.poll(() => page.locator('#toast').textContent()).toContain("process run isn't here");
  await cold('#/wrun');
  await expect.poll(() => page.locator('#toast').textContent()).toContain("isn't one the Dashboard knows");
  await app.go('account');
  await page.selectOption('#scpick', 'workflows');
  expect(await page.locator('#sclink').textContent()).toBe('http://localhost:4173/#/workflows');
  expect(app.errors).toEqual([]);
});

test('junk records are dropped or trimmed; old runs are pruned but open failures never are', async ({
  app,
  page,
}) => {
  await app.open();
  await page.evaluate(() => {
    const old = Date.now() - 200 * 864e5;
    S.workflows = [
      {
        id: 'w1',
        name: '<b>x</b>',
        stages: [
          { id: 's1', type: 'manual', title: 'A' },
          { id: 's1', type: 'manual', title: 'dup' },
          { type: 'nope' },
          5,
        ],
      },
      { id: 'bad id!', name: 'x', stages: [] },
      null,
    ];
    S.wruns = [
      { id: 'old', wf: 'w1', started: old, fin: old, status: 'succeeded', def: [], st: {} },
      { id: 'oldfail', wf: 'w1', started: old, fin: 0, status: 'failed', def: [], st: {}, err: 'boom' },
      {
        id: 'junk',
        wf: 'w1',
        started: Date.now(),
        status: 'weird',
        cur: 'zz',
        def: [{ id: 'a', type: 'manual', title: 'A' }],
        st: { zz: { o: 'done' }, a: { o: 'odd' } },
      },
    ];
    norm(S);
    save();
  });
  const s = await app.state();
  expect(s.workflows).toHaveLength(1);
  expect(s.workflows[0].stages.map(x => x.title)).toEqual(['A']);
  expect(s.workflows[0].name).toBe('<b>x</b>'); // (text; escaped when shown)
  expect(s.wruns.map(r => r.id).sort()).toEqual(['junk', 'oldfail']);
  const j = s.wruns.find(r => r.id === 'junk');
  expect(j.status).toBe('ready');
  expect(j.cur).toBe('');
  expect(j.st).toEqual({});
  await app.processes();
  expect(await page.evaluate(() => $('#v-knowledge').innerHTML.includes('<b>x</b>'))).toBe(false);
  expect(app.errors).toEqual([]);
});

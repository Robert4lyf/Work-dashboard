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

/* checkpoint 3: the header, Settings, Forecast, finding a process */

test('the header is full on Today and Focus, one line elsewhere; a running timer keeps its clock and Pause; nothing is lost moving between', async ({
  app,
  page,
}) => {
  await app.open();
  await app.setState(processDay);
  await page.reload();
  const hgt = () => page.$eval('header', h => Math.round(h.getBoundingClientRect().height));
  const full = await hgt();
  await expect(page.locator('header')).not.toHaveClass(/compact/);
  await expect(page.locator('header [data-resume]')).toBeVisible();
  for (const v of ['knowledge', 'review', 'account']) {
    await page.click(`nav [data-v=${v}]`);
    await expect(page.locator('header')).toHaveClass(/compact/);
    // One line: search, sync, and the current work as a way back to it (no tick to tap by mistake).
    await expect(page.locator('header #searchBtn')).toBeVisible();
    await expect(page.locator('header #syncBtn')).toBeVisible();
    await expect(page.locator('header .now .go')).toContainText('Review');
    await expect(page.locator('header [data-toggle]')).toHaveCount(0);
    expect(await hgt()).toBeLessThan(full - 40);
  }
  // The way back opens the task where work stopped.
  await page.click('header .now .go');
  await expect(page.locator('#v-today')).toBeVisible();
  await expect(page.locator('header')).not.toHaveClass(/compact/);
  // A focus session: the compact header keeps its clock, its label and its Pause.
  await page.evaluate(() => {
    S.timer = { id: 't1', end: Date.now() + 20 * 60e3, tag: '', mins: 25, q: 'q4b' };
    save();
    go('knowledge');
  });
  await expect(page.locator('header #hclock')).toBeVisible();
  await expect(page.locator('header .now .go small')).toBeVisible();
  await page.click('header [data-pause]');
  expect(await page.evaluate(() => S.timer.left != null)).toBe(true);
  await expect(page.locator('header [data-pause]')).toHaveText('Resume');
  // The Focus page keeps the full header.
  await page.evaluate(() => go('focus'));
  await expect(page.locator('header')).not.toHaveClass(/compact/);
  expect(app.errors).toEqual([]);
});

test('Settings is an index of groups; each opens as a page, back returns to the index; links from elsewhere open the right group', async ({
  app,
  page,
}) => {
  await app.open();
  await app.setState(processDay);
  await page.reload();
  await page.click('nav [data-v=account]');
  await expect(page.locator('#v-account [data-setgo]')).toHaveCount(7);
  await expect(page.locator('#v-account [data-setgo="rules"]')).toContainText('1 rule');
  // Rules are one tap from the index.
  await page.click('[data-setgo="rules"]');
  await expect(page.locator('#rulesec')).toHaveText('Rules');
  await expect(page.locator('#v-account .rulerow')).toHaveCount(1);
  // Android back: the index, then Today.
  await page.evaluate(() => history.back());
  await expect(page.locator('#v-account [data-setgo]')).toHaveCount(7);
  await page.evaluate(() => history.back());
  await expect(page.locator('#v-today')).toBeVisible();
  // The tab opens the index, even from inside a group.
  await app.settings('backup');
  await expect(page.locator('#exp')).toBeVisible();
  await page.click('nav [data-v=account]');
  await expect(page.locator('#exp')).toHaveCount(0);
  // Links: the sync badge, a tag's edit link, a section named by an Insights finding.
  await page.click('#syncBtn');
  await expect(page.locator('#v-account .kbtitle')).toHaveText('Sync and account');
  await page.evaluate(() => createClick({ gosec: 'execsec' }, null));
  await expect(page.locator('#v-account .kbtitle')).toHaveText('Automations and integrations');
  await expect(page.locator('#execsec')).toBeVisible();
  await page.evaluate(() => {
    const b = document.createElement('button');
    b.dataset.edittags = '1';
    document.querySelector('#v-today').append(b);
    b.click(); // (as a task's tag picker's "Edit tags" link does)
    b.remove();
  });
  await expect(page.locator('#v-account .kbtitle')).toHaveText('Tags');
  await expect(page.locator('[data-tagname="0"]')).toBeVisible();
  // A process step with tracking off links to its setting.
  await page.evaluate(() => {
    S.track = false;
    retryStage(wrunById('r1'), 's2'); // (its flow step, waiting to be launched)
    openWorkflowRun('r1');
  });
  await page.click('#v-knowledge [data-gosec="execsec"]');
  await expect(page.locator('#v-account .kbtitle')).toHaveText('Automations and integrations');
  // Preferences are untouched by the regrouping.
  await page.evaluate(() => go('today'));
  await app.settings('look');
  await page.click('[data-look="theme"][data-val="dark"]');
  await page.click('[data-setback]');
  await expect(page.locator('[data-setgo="look"]')).toContainText('Dark');
  expect(app.errors).toEqual([]);
});

test('a two-tap confirmation stays armed through a sync redraw, so the second tap does what the first asked', async ({
  app,
  page,
}) => {
  await app.open();
  await app.settings('tags');
  const n = (await app.state()).tags.length;
  await page.click('[data-deltag="0"]');
  await expect(page.locator('[data-deltag="0"]')).toHaveText('Delete?');
  await page.evaluate(() => inBackground(renderAccount));
  await expect(page.locator('[data-deltag="0"]')).toHaveText('Delete?');
  await page.click('[data-deltag="0"]');
  expect((await app.state()).tags.length).toBe(n - 1);
  // And it still lapses on its own.
  await page.click('[data-deltag="0"]');
  await page.evaluate(() => inBackground(renderAccount));
  await expect(page.locator('[data-deltag="0"]')).toHaveText('×', { timeout: 5000 });
  expect(app.errors).toEqual([]);
});

test('Forecast leads with the most significant finding; the rest and the unestimated list are a tap away', async ({
  app,
  page,
}) => {
  await app.open();
  await app.setState(processDay);
  await page.reload();
  await page.evaluate(() => {
    // An overloaded tomorrow: two big estimated tasks due then.
    const t = shift(today(), 1);
    S.quests[0].est = 400;
    S.quests[0].due = t;
    S.quests[5].est = 300;
    S.quests[5].due = t;
    S.cap = [0, 300, 300, 300, 300, 300, 0];
    save();
  });
  await page.click('nav [data-v=review]');
  await page.evaluate(() => {
    reviewSub = 'forecast';
    renderReview();
  });
  const tmr = await page.evaluate(() => dayLabel(shift(today(), 1)));
  await expect(page.locator('.fwarn')).toContainText('Overloaded: ' + tmr);
  await expect(page.locator('#v-review > .recs .rec, #v-review .recs').first()).toBeVisible();
  const shownRecs = page.locator('#v-review .recs:not(#recd .recs) .rec');
  await expect(shownRecs).toHaveCount(1);
  await expect(shownRecs.first()).toHaveClass(/over/);
  await expect(page.locator('#recd > summary')).toContainText('More suggestions');
  // Unestimated work: still said, its list folded until asked for.
  await page.click('#recd > summary');
  await expect(page.locator('#recd')).toContainText('have no estimate');
  await expect(page.locator('#fnoned .chip').first()).toBeHidden();
  await page.click('#fnoned > summary');
  expect(await page.locator('#fnoned .chip').count()).toBeGreaterThan(6);
  // Folds stay open through a redraw (once the browser's toggle event has recorded it).
  await page.waitForFunction(() => panels.fnoned === true);
  await page.evaluate(() => inBackground(renderReview));
  await expect(page.locator('#fnoned')).toHaveAttribute('open', '');
  expect(app.errors).toEqual([]);
});

test('finding a process: by name or by state; results open the right thing; archived ones are said; a sync redraw keeps the search', async ({
  app,
  page,
}) => {
  await app.open();
  await app.setState(processDay);
  await page.reload();
  await page.evaluate(() => {
    S.workflows.push({
      id: 'wfa',
      name: 'Old month-end',
      stages: [{ id: 'x', type: 'manual', title: 'X' }],
      days: [],
      ver: 1,
      archived: true,
    });
    norm(S);
    save();
  });
  await app.processes();
  await page.fill('#procq', 'month');
  await expect(page.locator('#procall')).toBeHidden();
  const res = page.locator('#procres .row');
  await expect(res).toHaveCount(4); // Month-end close, Month-end report, Old month-end (archived), the checklist guide
  await expect(page.locator('#procres')).toContainText('archived');
  // A redraw from a sync keeps the search and the keyboard.
  await page.evaluate(() => inBackground(renderKnowledge));
  await expect(page.locator('#procq')).toHaveValue('month');
  await expect(page.locator('#procq')).toBeFocused();
  await expect(res).toHaveCount(4);
  // By state: failed.
  await page.fill('#procq', '');
  await page.click('[data-procf="failed"]');
  await expect(res).toHaveCount(1);
  await expect(res.first()).toContainText('Month-end report');
  await page.click('#procres [data-wfview="wf1"]');
  await expect(page.locator('#v-knowledge .kbtitle')).toHaveText('Month-end report');
  // Back: the filter is still applied; nothing stored changed.
  await page.click('[data-wfback2]');
  await expect(page.locator('[data-procf="failed"]')).toHaveAttribute('aria-pressed', 'true');
  await page.click('[data-procf="idle"]');
  await page.fill('#procq', 'zzz');
  await expect(page.locator('#procres')).toContainText('Nothing called “zzz”');
  await page.click('[data-procclear]');
  await expect(page.locator('#procall')).toBeVisible();
  const s = await app.state();
  expect(s.workflows.find(w => w.id === 'wfa').archived).toBe(true);
  expect(app.errors).toEqual([]);
});

test('Scenario C: a complex process runs end to end (manual, guide, automation, check, wait, decision, a permitted skip) and its history says what happened', async ({
  app,
  page,
}) => {
  await app.open();
  await app.setState(processDay);
  await page.reload();
  await page.evaluate(() => {
    S.track = false; // (the automation's result confirmed by hand: a distinct, recorded outcome)
    const w = wfById('wf2');
    w.stages.splice(5, 0, {
      id: 'm5b',
      type: 'decide',
      title: 'Ready to close?',
      choices: [
        { label: 'Yes', next: '' },
        { label: 'Not yet', next: '' },
      ],
    });
    S.wruns = S.wruns.filter(r => r.wf !== 'wf2');
    S.runs = S.runs.filter(r => r.q !== 'wr-r3');
    save();
  });
  await app.processes();
  await page.click('#v-knowledge [data-wfstart="wf2"]');
  const h3 = page.locator('#v-knowledge .pstep h3');
  await expect(h3).toHaveText('Gather the statements');
  await page.click('[data-wfact="done"]');
  // The guide: followed inside the process, then back to it.
  await expect(h3).toHaveText('Follow the close checklist');
  await page.click('[data-wfact="procedure"]');
  for (let i = 0; i < 3; i++) await page.click('[data-rundone]');
  await page.click('[data-runfinish]');
  await expect(h3).toHaveText('Import the invoices');
  // The automation, tracking off: launched, then confirmed by hand.
  await page.click('#v-knowledge a[data-flow="f5"]');
  await page.click('[data-wfact="confirmflow"][data-ok="yes"]');
  await expect(h3).toHaveText('Review');
  await expect(page.locator('[data-wfact="done"]')).toBeDisabled();
  for (const c of await page.locator('.wchecks input').all()) await c.check();
  await page.click('[data-wfact="done"]');
  await expect(h3).toHaveText('Approval');
  await page.click('[data-wfact="waititem"]');
  await expect(page.locator('#v-knowledge .pstep')).toContainText('Waiting on Finance director');
  await page.click('[data-wfact="received"]');
  await expect(h3).toHaveText('Ready to close?');
  await page.click('[data-wfact="pick"][data-pick="0"]');
  // The last step allows skipping: skipped with a reason, which ends the run.
  await expect(h3).toHaveText('Close the month');
  await page.click('[data-wfact="skip"]');
  await page.fill('#sheetin', 'Closed by finance');
  await page.click('#sheetok');
  const r = await page.evaluate(() => S.wruns.find(x => x.wf === 'wf2'));
  expect(r.status).toBe('succeeded');
  expect(Object.fromEntries(Object.entries(r.st).map(([k, v]) => [k, [v.o, v.note || '']]))).toEqual({
    m1: ['done', ''],
    m2: ['done', ''],
    m3: ['done', 'Result confirmed by hand'],
    m4: ['done', ''],
    m5: ['done', ''],
    m5b: ['done', 'Yes'],
    m6: ['skipped', 'Closed by finance'],
  });
  expect(r.st.m2.run).toBeTruthy();
  expect(r.st.m5.wait).toBeTruthy();
  expect(r.log.map(l => l.k)).toEqual(
    expect.arrayContaining(['started', 'procedure', 'launched', 'waiting', 'skipped', 'succeeded']),
  );
  await expect(page.locator('#v-knowledge .pstep.done h3')).toContainText('Completed');
  await expect(page.locator('#v-knowledge [data-wfact]')).toHaveText(['Copy summary']);
  expect(app.errors).toEqual([]);
});

/* adversarial pass fixes */

test('a confirmed sheet acts only if the run still allows it: a retry after another device relaunched is refused, so that attempt’s result still counts', async ({
  app,
  page,
}) => {
  await app.open();
  await seedStates(page);
  await page.evaluate(() => openWorkflowRun('failed'));
  await page.click('.pstep.failed [data-wfact="retry"]');
  await expect(page.locator('#sheettitle')).toHaveText('Launch the automation again?');
  // Meanwhile, another device retried and launched it: the run waits on that new attempt.
  await page.evaluate(() => {
    const r = wrunById('failed');
    retryStage(r, 's2');
    S.execs.push({
      id: 'x9',
      flow: 'f1',
      at: Date.now(),
      status: 'running',
      msg: '',
      upd: Date.now(),
      ev: [],
    });
    wfLaunched(r.id, 's2', S.execs[S.execs.length - 1]);
    S.wruns = S.wruns.map(x => JSON.parse(JSON.stringify(x))); // (as a pull replaces records)
  });
  await page.click('#sheetok');
  await expect(page.locator('#toast')).toContainText('Not now');
  let r = await page.evaluate(() => wrunById('failed'));
  expect([r.status, r.live.exec]).toEqual(['awaiting_automation', 'x9']);
  // Its result moves the run on.
  await page.evaluate(() => onWorkflowEvent({ k: 'exec_succeeded', exec: 'x9', msg: '' }));
  r = await page.evaluate(() => wrunById('failed'));
  expect(r.cur).toBe('s3');
  // A skip sheet confirmed after the run moved past that step does nothing.
  await page.evaluate(() => openWorkflowRun('failskip'));
  await page.click('#wfmore summary');
  await page.click('.pstep.failed [data-wfact="skip"]');
  await page.evaluate(() => cancelRun(wrunById('failskip'), 'elsewhere'));
  await page.fill('#sheetin', 'x');
  await page.click('#sheetok');
  expect((await page.evaluate(() => wrunById('failskip'))).status).toBe('cancelled');
  expect(app.errors).toEqual([]);
});

test('a guide run or an automation attempt left by a run that ended or moved on is listed as work of its own', async ({
  app,
  page,
}) => {
  await app.open();
  await app.setState(processDay);
  await page.reload();
  await page.evaluate(() => {
    cancelRun(wrunById('r3'), 'test'); // (its guide, p1, left part-way)
    cancelRun(wrunById('r2'), 'test'); // (its automation attempt, x3, still running)
    save();
  });
  await app.processes();
  await expect(page.locator('#wfhead + .list [data-runopen="p1"]').first()).toBeVisible();
  const rows = await page.evaluate(() => opsProgress().map(r => r.text));
  expect(rows).toEqual(expect.arrayContaining(['Month-end close checklist', 'Backup']));
  expect(app.errors).toEqual([]);
});

test('re-saving a decision keeps the step it jumps to by id, when two steps share that name', async ({
  app,
  page,
}) => {
  await app.open();
  await page.evaluate(() => {
    S.workflows = [
      {
        id: 'w1',
        name: 'Twice',
        ver: 1,
        days: [],
        monthDay: 0,
        stages: [
          { id: 'q', type: 'decide', title: 'Choose', choices: [{ label: 'Go', next: 'd' }] },
          { id: 'c', type: 'manual', title: 'Check' },
          { id: 'd', type: 'manual', title: 'Check' },
        ],
      },
    ];
    save();
  });
  await app.processes();
  await page.click('[data-wfview="w1"]');
  await page.click('[data-wfedit="w1"]');
  await page.click('#wfstages [data-wfstage="q"]');
  await page.click('#sheetok');
  await page.click('#wfform .btn.green');
  expect((await app.state()).workflows[0].stages[0].choices[0].next).toBe('d');
  expect(app.errors).toEqual([]);
});

test('static audit fixes: a re-armed Delete is the same item’s; dark tags and armed buttons stay readable; the system bar follows a chosen theme; a stepless failure can be acknowledged', async ({
  app,
  page,
}) => {
  await app.open();
  await page.evaluate(() => {
    S.tags = [
      { name: 'A', color: 'var(--pink)' },
      { name: 'B', color: 'var(--yellow)' },
      { name: 'C', color: 'var(--blue)' },
    ];
    save();
  });
  await app.settings('tags');
  await page.click('[data-deltag="1"]'); // (B)
  await expect(page.locator('[data-deltag="1"]')).toHaveText('Delete?');
  // Another device removes A: index 1 is now C. A redraw mustn't leave C's × armed.
  await page.evaluate(() => {
    S.tags.splice(0, 1);
    inBackground(renderAccount);
  });
  await expect(page.locator('[data-deltag="1"]')).toHaveText('×');
  await page.click('[data-deltag="1"]');
  expect((await app.state()).tags.map(t => t.name)).toEqual(['B', 'C']); // (only armed, not deleted)
  // Dark: text on a tag's colour, and on an armed button, has AA contrast.
  await page.evaluate(() => setLook('theme', 'dark'));
  const ratio = (fg, bg) =>
    page.evaluate(
      ([fg, bg]) => {
        const p = s =>
          s
            .match(/\d+(\.\d+)?/g)
            .slice(0, 3)
            .map(Number);
        const L = c =>
          c
            .map(v => v / 255)
            .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
            .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
        const [a, b] = [L(p(fg)), L(p(bg))];
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      },
      [fg, bg],
    );
  const tag = await page.evaluate(() => {
    const s = document.createElement('span');
    s.className = 'tag';
    s.style.background = 'var(--yellow)';
    s.textContent = 'B';
    document.querySelector('#v-account').append(s);
    const cs = getComputedStyle(s);
    return [cs.color, cs.backgroundColor];
  });
  expect(await ratio(...tag)).toBeGreaterThan(4.5);
  const armedBtn = page.locator('[data-deltag="0"]');
  await armedBtn.click();
  const ab = await armedBtn.evaluate(b => [getComputedStyle(b).color, getComputedStyle(b).backgroundColor]);
  expect(await ratio(...ab)).toBeGreaterThan(4.5);
  // The system bar: dark when Dark is chosen, whatever the system says.
  expect(
    await page.evaluate(() =>
      [...document.querySelectorAll('meta[name="theme-color"]')].map(m => [m.media, m.content]),
    ),
  ).toEqual([
    ['', '#12161c'],
    ['', '#12161c'],
  ]);
  await page.evaluate(() => setLook('theme', ''));
  expect(await page.evaluate(() => document.querySelector('meta[name="theme-color"]').media)).toContain(
    'prefers-color-scheme',
  );
  // A failed run whose step is gone from its copy: acknowledged from its page.
  await page.evaluate(() => {
    S.workflows = [
      {
        id: 'w',
        name: 'Gone step',
        ver: 1,
        days: [],
        monthDay: 0,
        stages: [{ id: 's', type: 'manual', title: 'S' }],
      },
    ];
    S.wruns = [
      {
        id: 'g',
        wf: 'w',
        ver: 1,
        name: 'Gone step',
        q: '',
        def: [{ id: 's', type: 'manual', title: 'S' }],
        started: Date.now(),
        at: Date.now(),
        cur: '',
        st: {},
        live: {},
        status: 'failed',
        err: 'Lost',
        log: [],
      },
    ];
    norm(S);
    save();
    openWorkflowRun('g');
  });
  await page.click('#v-knowledge [data-wfact="ack"]');
  expect((await app.state()).wruns[0].ack).toBe(1);
  expect(app.errors).toEqual([]);
});

test('UI pass fixes: a process row’s Fix opens its failed run; the paused clock stays on one line; tabs fit with Larger text; Add to the Inbox once', async ({
  app,
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await app.open();
  await app.setState(processDay);
  await page.evaluate(() => localStorage.setItem('dashboard-look', JSON.stringify({ font: 'large' })));
  await page.reload();
  // Every tab whole and on screen at 360px with Larger text (and a two-digit Inbox count).
  await page.evaluate(() => {
    for (let i = 0; i < 12; i++) S.inbox.push({ id: 'n' + i, text: 'Item ' + i });
    save();
    renderAll();
  });
  // (each label whole, and each tab, once current, fully on screen: whether all five fit at once
  // depends on the device's font, so the strip may scroll instead)
  for (const v of ['today', 'inbox', 'knowledge', 'review', 'account']) {
    const b = page.locator(`nav [data-v=${v}]`);
    await b.click();
    const r = await b.boundingBox();
    expect(r.x >= 0 && r.x + r.width <= 360).toBe(true);
    expect(await b.evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
  }
  // Review's four tabs fit too.
  await page.click('nav [data-v=review]');
  // (on one line where the font allows, else wrapped: never cut off or scrolled out of sight)
  for (const r of await page.$$eval('#v-review .rtabs .chip', cs => cs.map(c => c.getBoundingClientRect())))
    expect(r.x >= 0 && r.x + r.width <= 360).toBe(true);
  // Fix on the process row opens the failed run, not the newer one under way.
  await app.processes();
  await page.click('#procall .row [data-wfopen="r1"].btn');
  expect(await page.evaluate(() => wfOpen)).toBe('r1');
  // Add to the Inbox, then not again (it acknowledges).
  await page.click('#wfmore summary');
  await page.click('[data-wfact="inbox"]');
  await expect(page.locator('#v-knowledge [data-wfact="inbox"]')).toHaveCount(0);
  expect((await app.state()).inbox.filter(x => /^Process failed/.test(x.text))).toHaveLength(1);
  // Another failed run's Other options start folded.
  await page.evaluate(() => {
    wrunById('r3').status = 'failed';
    wrunById('r3').err = 'x';
    openWorkflowRun('r3');
  });
  await expect(page.locator('#wfmore')).not.toHaveAttribute('open', '');
  // A paused timer in the compact header: one line.
  await page.evaluate(() => {
    S.timer = { id: 't', end: 0, left: 25 * 60e3, tag: '', mins: 25, q: 'q4b' };
    save();
    go('knowledge');
  });
  const clk = page.locator('header #hclock');
  await expect(clk).toBeVisible();
  const box = await clk.boundingBox();
  expect(box.height).toBeLessThan(32);
  // Search counts read right.
  await page.evaluate(() => {
    S.timer = null;
    wfOpen = null;
    save();
  });
  await app.processes();
  await page.fill('#procq', 'mon');
  await expect(page.locator('.procfound')).toContainText('matches');
  expect(app.errors).toEqual([]);
});

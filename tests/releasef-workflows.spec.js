// Release F, checkpoint 4: a process step's actions are bound to the step they were drawn for. A
// tap (or a sheet answered) after a sync moved the run on does nothing to the run; the rules of
// movement themselves refuse a step done the wrong way.
const { test, expect } = require('./fixtures');

const flows = [{ id: 'f1', name: 'Export', url: 'ms-powerautomate:/console/flow/run?workflowName=a' }];
const guide = {
  id: 'a1',
  cat: '',
  title: 'Extract',
  body: '',
  edited: 1,
  imgs: [],
  steps: [{ id: 'p1', title: 'Pull' }],
};
// One run (r1) of a process with these steps, opened; `prep` moves it on first (in the page).
async function seed(page, def, { track = true, prep = '' } = {}) {
  await page.evaluate(
    ({ flows, guide, def, track, prep }) => {
      S.track = track;
      S.flows = flows;
      S.kb = [guide];
      S.workflows = [{ id: 'w1', name: 'Report', ver: 1, days: [], monthDay: 0, stages: def }];
      const r = makeRun(S.workflows[0], { id: 'r1' });
      S.wruns = [r];
      if (prep) new Function('r', prep)(r);
      norm(S);
      save();
      openWorkflowRun('r1');
    },
    { flows, guide, def, track, prep },
  );
}
// Another device's change, arriving as a pull does (the records rebuilt), without a redraw yet:
// the page still shows what it showed. `redraw` draws it in the background, as a pull does.
const pull = (page, src, redraw = false) =>
  page.evaluate(
    ({ src, redraw }) => {
      new Function('r', src)(wrunById('r1'));
      norm(JSON.parse(JSON.stringify(S)));
      if (redraw) inBackground(renderAll);
    },
    { src, redraw },
  );
const run = page => page.evaluate(() => JSON.parse(JSON.stringify(wrunById('r1'))));
const title = page => page.locator('#v-knowledge .pstep h3');
const moved = page => expect(page.locator('#toast')).toContainText('That step has moved on');

const M = (id, extra = {}) => ({ id, type: 'manual', title: id.toUpperCase(), ...extra });

for (const c of [
  {
    name: 'manual → manual',
    def: [M('a'), M('b'), M('z')],
    remote: "completeStage(r, 'a', { by: 'hand' });",
    tap: '[data-wfact="done"]',
  },
  {
    // (its checks already ticked there: a stale Mark done must not pass as Verified)
    name: 'manual → verification',
    def: [M('a'), { id: 'b', type: 'verify', title: 'B', checks: ['One', 'Two'] }, M('z')],
    remote: "completeStage(r, 'a', { by: 'hand' }); r.live.checks = [true, true];",
    tap: '[data-wfact="done"]',
  },
  {
    name: 'manual → automation',
    def: [M('a'), { id: 'b', type: 'flow', title: 'B', flow: 'f1' }, M('z')],
    remote: "completeStage(r, 'a', { by: 'hand' });",
    tap: '[data-wfact="done"]',
  },
  {
    name: 'decision → waiting',
    def: [
      {
        id: 'a',
        type: 'decide',
        title: 'A',
        choices: [
          { label: 'Go', next: '' },
          { label: 'Stop', next: '' },
        ],
      },
      { id: 'b', type: 'wait', title: 'B', who: 'Sam' },
      M('z'),
    ],
    remote: "completeStage(r, 'a', { pick: 0, by: 'pick' }); stageWaitItem(r, runStage(r)); settleRun(r);",
    tap: '[data-wfact="pick"][data-pick="1"]',
  },
]) {
  test(`step A's action tapped after the run moved to step B (${c.name}) does nothing to B`, async ({
    app,
    page,
  }) => {
    await app.open();
    await seed(page, c.def);
    await expect(title(page)).toHaveText('A');
    await pull(page, c.remote);
    const before = await run(page);
    expect(before.cur).toBe('b');
    await page.click(c.tap);
    await moved(page);
    expect(await run(page)).toEqual(before); // (untouched: B not done, nothing logged)
    await expect(title(page)).toHaveText('B'); // (redrawn as it is now)
  });
}

test('a retry tapped after a sync moved the failure to a later step does not retry that one', async ({
  app,
  page,
}) => {
  await app.open();
  await seed(page, [M('a'), M('b'), M('c'), M('z')], {
    prep: "completeStage(r, 'a', { by: 'hand' }); failStage(r, 'b', 'Broke');",
  });
  await expect(page.locator('.pstep.failed h3')).toHaveText('B');
  // Another device retried B, finished it, and C failed there.
  await pull(
    page,
    "retryStage(r, 'b'); completeStage(r, 'b', { by: 'hand' }); failStage(r, 'c', 'Broke too');",
  );
  const before = await run(page);
  await page.click('.pstep.failed [data-wfact="retry"]');
  await moved(page);
  expect(await run(page)).toEqual(before);
  expect(before).toMatchObject({ status: 'failed', cur: 'c', st: { c: { o: 'failed', note: 'Broke too' } } });
  // Now drawn for C, Try again retries C.
  await expect(page.locator('.pstep.failed h3')).toHaveText('C');
  await page.click('.pstep.failed [data-wfact="retry"]');
  expect(await run(page)).toMatchObject({ status: 'awaiting_user', cur: 'c', live: { tries: 1 } });
  expect((await run(page)).st.c).toBeUndefined();
});

test('an automation retry sheet answered after a pull moved the run on is refused', async ({ app, page }) => {
  await app.open();
  await seed(page, [{ id: 'a', type: 'flow', title: 'A', flow: 'f1', skip: true }, M('b'), M('z')], {
    prep: `S.execs = [{ id: 'x0', flow: 'f1', at: Date.now(), status: 'failed', msg: 'Timeout', upd: Date.now(), ev: [] }];
      wfLaunched(r.id, 'a', S.execs[0]); failStage(r, 'a', 'Automation failed: Timeout');`,
  });
  await page.click('.pstep.failed [data-wfact="retry"]');
  await expect(page.locator('#sheettitle')).toHaveText('Launch the automation again?');
  // Another device skipped A; B then failed there. The pull redraws behind the open sheet.
  await pull(
    page,
    "completeStage(r, 'a', { o: 'skipped', note: 'by hand' }); failStage(r, 'b', 'No');",
    true,
  );
  await expect(page.locator('#sheetok')).toBeVisible();
  const before = await run(page);
  await page.click('#sheetok');
  await moved(page);
  expect(await run(page)).toEqual(before);
  expect(before).toMatchObject({
    status: 'failed',
    cur: 'b',
    st: { a: { o: 'skipped' }, b: { o: 'failed' } },
  });
});

test('a skip or failure sheet held open while a pull moves the run on lands on nothing', async ({
  app,
  page,
}) => {
  await app.open();
  await seed(page, [M('a', { skip: true }), M('b', { skip: true }), M('z')]);
  await page.click('[data-wfact="skip"]');
  await expect(page.locator('#sheettitle')).toHaveText('Skip this step?');
  await page.fill('#sheetin', 'Not needed');
  await pull(page, "completeStage(r, 'a', { by: 'hand' });", true);
  await expect(page.locator('#sheetin')).toHaveValue('Not needed'); // (still open, as typed)
  let before = await run(page);
  await page.click('#sheetok');
  await moved(page);
  expect(await run(page)).toEqual(before);
  expect(before.st).toEqual({ a: expect.objectContaining({ o: 'done' }) }); // (B not skipped)
  // Report a problem on B; B is done elsewhere meanwhile.
  await expect(title(page)).toHaveText('B');
  await page.click('[data-wfact="fail"]');
  await expect(page.locator('#sheettitle')).toHaveText('What went wrong?');
  await pull(page, "completeStage(r, 'b', { by: 'hand' });", true);
  before = await run(page);
  await page.click('#sheetok');
  await moved(page);
  expect(await run(page)).toEqual(before);
  expect(before).toMatchObject({ status: 'awaiting_user', cur: 'z' });
  expect(before.st.z).toBeUndefined();
});

test('a stale Skip opens no sheet and skips nothing', async ({ app, page }) => {
  await app.open();
  await seed(page, [M('a', { skip: true }), M('b', { skip: true }), M('z')]);
  await pull(page, "completeStage(r, 'a', { by: 'hand' });");
  const before = await run(page);
  await page.click('[data-wfact="skip"]');
  await moved(page);
  await expect(page.locator('#sheet')).toHaveCount(0);
  expect(await run(page)).toEqual(before);
});

test("a stale manual confirmation of an automation's result confirms nothing else", async ({ app, page }) => {
  await app.open();
  // Tracking off: each automation step's result is yours to confirm.
  await seed(
    page,
    [
      { id: 'a', type: 'flow', title: 'A', flow: 'f1' },
      { id: 'b', type: 'flow', title: 'B', flow: 'f1' },
      M('z'),
    ],
    { track: false },
  );
  await pull(page, "completeStage(r, 'a', { by: 'confirm', note: 'Result confirmed by hand' });");
  let before = await run(page);
  await page.click('[data-wfact="confirmflow"][data-ok="yes"]');
  await moved(page);
  expect(await run(page)).toEqual(before);
  expect(before.st.b).toBeUndefined();
  // Drawn for B now; B is confirmed elsewhere; a stale "It failed" fails nothing.
  await expect(title(page)).toHaveText('B');
  await pull(page, "completeStage(r, 'b', { by: 'confirm', note: 'Result confirmed by hand' });");
  before = await run(page);
  await page.click('[data-wfact="confirmflow"][data-ok="no"]');
  await moved(page);
  expect(await run(page)).toEqual(before);
  expect(before).toMatchObject({ status: 'awaiting_user', cur: 'z', err: '' });
  // Tracking on: the automation's own result moved A on; B (not launched yet) offers no
  // confirmation, and a stale one isn't taken as B's.
  await seed(
    page,
    [
      { id: 'a', type: 'flow', title: 'A', flow: 'f1' },
      { id: 'b', type: 'flow', title: 'B', flow: 'f1' },
    ],
    {
      prep: `S.execs = [{ id: 'x1', flow: 'f1', at: Date.now(), status: 'running', msg: '', upd: Date.now(), ev: [] }];
      wfLaunched(r.id, 'a', S.execs[0]);`,
    },
  );
  await expect(page.locator('[data-wfact="confirmflow"][data-ok="yes"]')).toHaveText(
    'It succeeded (checked by hand)',
  );
  await pull(page, "onWorkflowEvent({ k: 'exec_succeeded', exec: 'x1', msg: '' });");
  before = await run(page);
  expect(before).toMatchObject({ cur: 'b', status: 'awaiting_user' });
  await page.click('[data-wfact="confirmflow"][data-ok="yes"]');
  await moved(page);
  expect(await run(page)).toEqual(before);
  await expect(page.locator('[data-wfact="confirmflow"]')).toHaveCount(0);
});

test('a run completed or cancelled on another device: a stale step action does nothing', async ({
  app,
  page,
}) => {
  await app.open();
  await seed(page, [M('a'), M('b')], { prep: "completeStage(r, 'a', { by: 'hand' });" });
  await pull(page, "completeStage(r, 'b', { by: 'hand' });");
  let before = await run(page);
  expect(before.status).toBe('succeeded');
  await page.click('[data-wfact="done"]');
  await moved(page);
  expect(await run(page)).toEqual(before);
  await expect(page.locator('#v-knowledge .pstep h3')).toContainText('Completed');
  // Cancelled there: still on the same step, so it's the run's state that says no.
  await seed(page, [M('a'), M('b')]);
  await pull(page, "cancelRun(r, 'cancelled elsewhere');");
  before = await run(page);
  await page.click('[data-wfact="done"]');
  await expect(page.locator('#toast')).toContainText('Not now: the process is cancelled');
  expect(await run(page)).toEqual(before);
  expect(before.st).toEqual({});
});

test('every step action names its step; the run-level ones do not', async ({ app, page }) => {
  await app.open();
  const cases = [
    [[M('a', { skip: true })], {}],
    [[{ id: 'a', type: 'verify', title: 'A', checks: ['One', 'Two'], skip: true }], {}],
    [[{ id: 'a', type: 'decide', title: 'A', choices: [{ label: 'Go', next: '' }], skip: true }], {}],
    [[{ id: 'a', type: 'flow', title: 'A', flow: 'f1', skip: true }], { track: false }],
    [[{ id: 'a', type: 'wait', title: 'A', who: 'Sam', skip: true }], {}],
    [
      [{ id: 'a', type: 'wait', title: 'A', who: 'Sam' }],
      { prep: 'stageWaitItem(r, runStage(r)); settleRun(r);' },
    ],
    [[{ id: 'a', type: 'procedure', title: 'A', kb: 'a1', skip: true }], {}],
    [[M('a', { skip: true })], { prep: "failStage(r, 'a', 'x');" }],
  ];
  const stageActs = await page.evaluate(() => Object.keys(STAGE_ACTS));
  for (const [def, o] of cases) {
    await seed(page, def, o);
    await page.evaluate(
      () => document.querySelector('#wfmore') && (document.querySelector('#wfmore').open = true),
    );
    const got = await page.$$eval('#v-knowledge [data-wfact]', els =>
      els.map(e => [e.dataset.wfact, e.dataset.wstage === undefined ? null : e.dataset.wstage]),
    );
    expect(
      got.some(([a]) => stageActs.includes(a)),
      JSON.stringify(def),
    ).toBe(true);
    for (const [a, sid] of got) expect(sid, `${def[0].type}: ${a}`).toBe(stageActs.includes(a) ? 'a' : null);
  }
});

test('forged or mismatched step actions are refused at the tap', async ({ app, page }) => {
  await app.open();
  await seed(page, [M('a'), { id: 'b', type: 'verify', title: 'B', checks: ['One'] }, M('z')]);
  const before = await run(page);
  for (const d of [
    { wfact: 'done' }, // (no step named)
    { wfact: 'done', wstage: 'b' }, // (not the current step)
    { wfact: 'pick', wstage: 'a', pick: '0' }, // (not a decision)
    { wfact: 'check', wstage: 'a', i: '0' },
    { wfact: 'confirmflow', wstage: 'a', ok: 'yes' },
    { wfact: 'received', wstage: 'a' },
    { wfact: 'waititem', wstage: 'a' },
    { wfact: 'procedure', wstage: 'a' },
    { wfact: 'skip', wstage: 'a' }, // (not skippable)
    { wfact: 'retry', wstage: 'a' }, // (not failed)
  ]) {
    await page.evaluate(d => wfClick({ wrun: 'r1', ...d }, null), d);
    expect(await run(page), JSON.stringify(d)).toEqual(before);
    await expect(page.locator('#sheet')).toHaveCount(0);
  }
  // On the check: an index past its checks, and Verified with one left unticked.
  await page.evaluate(() => wfClick({ wrun: 'r1', wfact: 'done', wstage: 'a' }, null));
  const at = await run(page);
  expect(at.cur).toBe('b');
  await page.evaluate(() => wfClick({ wrun: 'r1', wfact: 'check', wstage: 'b', i: '4' }, null));
  await page.evaluate(() => wfClick({ wrun: 'r1', wfact: 'done', wstage: 'b' }, null));
  expect(await run(page)).toEqual(at);
  await page.click('[data-wfact="check"]');
  await page.click('[data-wfact="done"]');
  expect(await run(page)).toMatchObject({ cur: 'z', st: { b: { o: 'done' } } });
});

test('the rules of movement refuse a step done the wrong way, whatever calls them', async ({ app, page }) => {
  await app.open();
  await page.evaluate(
    ({ flows, guide }) => {
      S.track = true;
      S.flows = flows;
      S.kb = [guide];
    },
    { flows, guide },
  );
  const res = await page.evaluate(() => {
    const out = {},
      mk = (def, live = {}) => {
        const r = makeRun({ id: 'w', ver: 1, name: 'T', stages: def }, {});
        Object.assign(r.live, live);
        settleRun(r);
        return r;
      };
    // Verification: every check first.
    let r = mk([{ id: 'v', type: 'verify', title: 'V', checks: ['One', 'Two'] }]);
    out.verifyNone = completeStage(r, 'v', { by: 'hand' });
    r.live.checks = [true];
    out.verifyOne = completeStage(r, 'v', { by: 'hand' });
    out.verifyEngine = completeStage(r, 'v');
    r.live.checks = [true, true];
    out.verifyAll = completeStage(r, 'v', { by: 'hand' });
    // An automation step: never as a plain step; confirmed by hand only where that's offered.
    r = mk([{ id: 'f', type: 'flow', title: 'F', flow: 'f1' }]);
    out.flowEngine = completeStage(r, 'f');
    out.flowHand = completeStage(r, 'f', { by: 'hand' });
    out.flowReply = completeStage(r, 'f', { by: 'reply' });
    out.flowConfirmUnlaunched = completeStage(r, 'f', { by: 'confirm' });
    out.flowAutoNoAttempt = completeStage(r, 'f', { by: 'auto' });
    out.flowStatus = r.status;
    S.execs = [{ id: 'x1', flow: 'f1', at: Date.now(), status: 'running', msg: '', upd: Date.now(), ev: [] }];
    r.live.exec = 'x1';
    out.flowConfirmLaunched = completeStage(r, 'f', { by: 'confirm' });
    r = mk([{ id: 'f', type: 'flow', title: 'F', flow: 'f1' }]);
    S.track = false;
    out.flowConfirmUntracked = completeStage(r, 'f', { by: 'confirm' });
    S.track = true;
    r = mk([{ id: 'f', type: 'flow', title: 'F', flow: 'gone' }]);
    out.flowConfirmRemoved = completeStage(r, 'f', { by: 'confirm' });
    // A decision: a real choice, by choosing.
    const dec = [
      {
        id: 'd',
        type: 'decide',
        title: 'D',
        choices: [
          { label: 'Yes', next: '' },
          { label: 'No', next: '' },
        ],
      },
    ];
    r = mk(dec);
    out.decide = [undefined, -1, 2, 0.5, '0', 'constructor', NaN].map(pick =>
      completeStage(r, 'd', { pick, by: 'pick' }),
    );
    out.decideHand = completeStage(r, 'd', { pick: 0, by: 'hand' });
    out.decideStatus = r.status;
    out.decideOk = completeStage(r, 'd', { pick: 1, by: 'pick' });
    out.decideNote = r.st.d.note;
    out.pickOnManual = completeStage(mk([{ id: 'm', type: 'manual', title: 'M' }]), 'm', { pick: 0 });
    out.pickByOnManual = completeStage(mk([{ id: 'm', type: 'manual', title: 'M' }]), 'm', { by: 'pick' });
    // A failed step: retried, or skipped where skipping is allowed; never just done.
    r = mk([
      { id: 'm', type: 'manual', title: 'M' },
      { id: 'n', type: 'manual', title: 'N' },
    ]);
    failStage(r, 'm', 'x');
    out.failedDone = completeStage(r, 'm', { by: 'hand' });
    out.failedSkip = completeStage(r, 'm', { o: 'skipped', note: 'x' });
    out.failedOutcome = completeStage(r, 'm', { o: 'failed' });
    out.failedAgain = failStage(r, 'm', 'y');
    out.failedState = [r.status, r.cur, r.st.m.o];
    out.failedRetryOther = retryStage(r, 'n');
    out.failedRetry = retryStage(r, 'm');
    // A waiting step: only once the reply is in (its item no longer waiting).
    r = mk([
      { id: 'w', type: 'wait', title: 'W', who: 'Sam' },
      { id: 'z', type: 'manual', title: 'Z' },
    ]);
    S.wruns.push(r);
    const it = stageWaitItem(r, runStage(r));
    settleRun(r);
    out.waitStatus = r.status;
    out.waitHand = completeStage(r, 'w', { by: 'hand' });
    out.waitStill = completeStage(r, 'w', { by: 'reply' });
    out.waitEngine = completeStage(r, 'w');
    setWaiting(it.id, null); // (the reply: the run moves on from it)
    out.waitAfter = [r.cur, r.st.w && r.st.w.o];
    // A guide step: once the guide is finished.
    r = mk([{ id: 'p', type: 'procedure', title: 'P', kb: 'a1' }]);
    out.guideNone = completeStage(r, 'p', { by: 'hand' });
    S.runs.push({
      id: 'pr1',
      art: 'a1',
      q: 'wr-' + r.id,
      started: Date.now(),
      at: Date.now(),
      done: [],
      cur: '',
      fin: 0,
    });
    r.live.run = 'pr1';
    out.guideOpen = completeStage(r, 'p', { by: 'guide' });
    out.guideAuto = completeStage(r, 'p', { by: 'auto' });
    S.runs[S.runs.length - 1].fin = Date.now();
    out.guideDone = completeStage(r, 'p', { by: 'guide' });
    // Not the current step, a ready run.
    r = mk([
      { id: 'm', type: 'manual', title: 'M' },
      { id: 'n', type: 'manual', title: 'N' },
    ]);
    out.notCurrent = completeStage(r, 'n', { by: 'hand' });
    const ready = makeRun(
      { id: 'w', ver: 1, name: 'T', stages: [{ id: 'm', type: 'manual', title: 'M' }] },
      { prepared: true },
    );
    out.readyFail = failStage(ready, 'm', 'x');
    out.readyDone = completeStage(ready, 'm', { by: 'hand' });
    return out;
  });
  expect(res).toMatchObject({
    verifyNone: 'tick each check first',
    verifyOne: 'tick each check first',
    verifyEngine: 'tick each check first',
    verifyAll: '',
    flowEngine: "that isn't how this step is done",
    flowHand: "that isn't how this step is done",
    flowReply: "that isn't how this step is done",
    flowConfirmUnlaunched: 'wait for its result',
    flowAutoNoAttempt: 'no attempt to report on',
    flowStatus: 'awaiting_user',
    flowConfirmLaunched: '',
    flowConfirmUntracked: '',
    flowConfirmRemoved: '',
    decide: Array(7).fill('choose first'),
    decideHand: "that isn't how this step is done",
    decideStatus: 'awaiting_user',
    decideOk: '',
    decideNote: 'No',
    pickOnManual: 'not a decision',
    pickByOnManual: "that isn't how this step is done",
    failedDone: 'retry it first',
    failedSkip: "this step can't be skipped",
    failedOutcome: 'retry it first',
    failedAgain: 'the run is over or paused',
    failedState: ['failed', 'm', 'failed'],
    failedRetryOther: 'not the current step',
    failedRetry: '',
    waitStatus: 'waiting',
    waitHand: "that isn't how this step is done",
    waitStill: 'still waiting',
    waitEngine: 'still waiting',
    waitAfter: ['z', 'done'],
    guideNone: 'finish the guide first',
    guideOpen: 'finish the guide first',
    guideAuto: "that isn't how this step is done",
    guideDone: '',
    notCurrent: 'not the current step',
    readyFail: 'the run has not started',
    readyDone: 'the run has not started',
  });
});

/* across two devices, through the fake Supabase of sync.spec.js (a pared-down copy) */
function fakeSupabase() {
  const query = table => {
    const q = { table, filters: {} };
    const api = {
      select(cols) {
        q.cols = cols;
        return api;
      },
      in(k, vals) {
        q.keys = vals;
        return api;
      },
      eq: () => api,
      gt(k, v) {
        q.gt = v;
        return api;
      },
      not: () => api,
      is: () => api,
      lt: () => api,
      order: () => api,
      limit(n) {
        q.limit = n;
        return api;
      },
      maybeSingle: async () => ({ data: await window.srvState(), error: null }),
      upsert: rows => {
        const done =
          table === 'cockpit_state'
            ? window.srvSnapshot(rows).then(() => [])
            : window.srvUpsert(Array.isArray(rows) ? rows : [rows]);
        return {
          select: async () => ({ data: await done, error: null }),
          then: (a, b) => done.then(() => ({ error: null })).then(a, b),
        };
      },
      then(res, rej) {
        if (table !== 'cockpit_items') return Promise.resolve({ data: [], error: null }).then(res, rej);
        return window
          .srvRows(q.gt || 0, q.limit || 1000, q.cols || '', q.keys || null)
          .then(data => ({ data, error: null }))
          .then(res, rej);
      },
    };
    return api;
  };
  window.supabase = {
    createClient: () => ({
      auth: {
        onAuthStateChange(cb) {
          setTimeout(() => cb('INITIAL_SESSION', { user: { id: 'u1', email: 'me@example.com' } }), 0);
          return { data: { subscription: { unsubscribe() {} } } };
        },
        signOut: async () => ({}),
      },
      from: query,
      channel() {
        const ch = {
          on: () => ch,
          subscribe(cb) {
            if (cb) cb('SUBSCRIBED');
            return ch;
          },
        };
        return ch;
      },
      removeChannel() {},
      rpc: async () => ({ data: null, error: null }),
    }),
  };
}
async function device(browser, srv) {
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route(
    u => !u.href.startsWith('http://localhost'),
    r => r.abort(),
  );
  await page.exposeFunction('srvRows', (gt, limit, cols, keys) => {
    const rows = [...srv.rows.values()]
      .filter(r => (keys ? keys.includes(r.key) : r.seq > gt))
      .sort((a, b) => a.seq - b.seq)
      .slice(0, limit);
    return cols && !cols.split(',').includes('data') ? rows.map(({ data, ...r }) => r) : rows;
  });
  await page.exposeFunction('srvUpsert', rows => {
    const wrote = [];
    rows.forEach(r => {
      const old = srv.rows.get(r.key);
      if (old && r.edited_at < old.edited_at) return; // (newer edit wins, as the server does)
      srv.rows.set(r.key, { ...r, seq: ++srv.seq });
      wrote.push({ key: r.key, seq: srv.seq });
    });
    return wrote;
  });
  await page.exposeFunction('srvState', () => srv.state);
  await page.exposeFunction('srvSnapshot', row => (srv.state = { data: row.data, edited_at: row.edited_at }));
  await page.addInitScript(fakeSupabase);
  await page.addInitScript(() =>
    addEventListener('click', e => {
      const a = e.target.closest && e.target.closest('a[href^="ms-powerautomate:"]');
      if (a) e.preventDefault();
    }),
  );
  await page.goto('/');
  await expect(page.locator('#syncBtn')).toHaveText('Synced');
  return {
    page,
    errors,
    sync: () =>
      page.evaluate(async () => {
        await sync();
        while (syncing || again) await new Promise(r => setTimeout(r, 20));
      }),
    run: id => page.evaluate(id => JSON.parse(JSON.stringify(wrunById(id))), id),
  };
}

test('two devices: a sheet held open on one while the other completes or cancels the run acts on nothing', async ({
  browser,
}) => {
  const srv = { rows: new Map(), seq: 0, state: null };
  const a = await device(browser, srv);
  const b = await device(browser, srv);
  const both = async () => {
    for (let i = 0; i < 2; i++) for (const d of [a, b]) await d.sync();
  };
  const make = (id, def) =>
    a.page.evaluate(
      ({ id, def }) => {
        S.workflows = [{ id: 'w1', name: 'Report', ver: 1, days: [], monthDay: 0, stages: def }];
        S.wruns = S.wruns.filter(r => r.id !== id).concat(makeRun(S.workflows[0], { id }));
        norm(S);
        save();
      },
      { id, def },
    );
  await make('r1', [M('a', { skip: true }), M('b')]);
  await both();
  for (const d of [a, b]) await d.page.evaluate(() => openWorkflowRun('r1'));
  // A asks to skip A; B marks A done and then B done: the run is completed there.
  await a.page.click('[data-wfact="skip"]');
  await a.page.fill('#sheetin', 'Not needed');
  await b.page.click('[data-wfact="done"]');
  await b.page.click('[data-wfact="done"]');
  await expect(b.page.locator('#toast')).toContainText('Process completed');
  await b.sync();
  await a.sync(); // (the pull, behind A's open sheet)
  expect((await a.run('r1')).status).toBe('succeeded');
  await expect(a.page.locator('#sheetin')).toHaveValue('Not needed');
  await a.page.click('#sheetok');
  await expect(a.page.locator('#toast')).toContainText('That step has moved on');
  await both();
  for (const d of [a, b]) {
    const r = await d.run('r1');
    expect(r.status).toBe('succeeded');
    expect(r.st.a.o).toBe('done');
  }
  // Another run: A asks to report a problem on step A; B cancels the run.
  await make('r2', [M('a'), M('b')]);
  await both();
  for (const d of [a, b]) await d.page.evaluate(() => openWorkflowRun('r2'));
  await expect(b.page.locator('[data-wfact="done"]')).toBeVisible();
  await a.page.click('[data-wfact="fail"]');
  await b.page.click('[data-wfact="cancel"]');
  await b.page.click('#sheetok');
  await b.sync();
  await a.sync();
  await a.page.click('#sheetok');
  await expect(a.page.locator('#toast')).toContainText('Not now: the process is cancelled');
  await both();
  for (const d of [a, b]) {
    const r = await d.run('r2');
    expect(r.status).toBe('cancelled');
    expect(r.st).toEqual({});
  }
  expect([...a.errors, ...b.errors]).toEqual([]);
});

// Release C: regression tests for the defects the adversarial passes found.
const { test, expect, unfold } = require('./fixtures');

const seed = () => {
  // (a definition with a flow stage, made in the page)
  window.wf = (extra = {}) => ({
    id: 'w1',
    name: 'Report',
    ver: 1,
    days: [],
    monthDay: 0,
    stages: [
      { id: 's1', type: 'flow', title: 'Run', flow: 'f1' },
      { id: 's2', type: 'manual', title: 'Send' },
    ],
    ...extra,
  });
  S.track = true;
  S.flows = [{ id: 'f1', name: 'Flow', url: 'ms-powerautomate:/x' }];
  S.kb = [
    { id: 'a1', cat: '', title: 'Proc', body: '', edited: 1, imgs: [], steps: [{ id: 'p1', title: 'One' }] },
  ];
  save();
  renderAll();
};

test('audit 1: a flow result that synced in as the execution’s row (no report here) still moves the stage on', async ({
  app,
  page,
}) => {
  await app.open();
  await page.evaluate(seed);
  await page.evaluate(() => {
    S.workflows = [wf()];
    const r = makeRun(S.workflows[0]);
    r.live.exec = 'x1';
    r.status = 'awaiting_automation';
    S.wruns = [r];
    // The execution arrives from another device with its result already folded in.
    S.execs = [
      {
        id: 'x1',
        flow: 'f1',
        q: '',
        at: Date.now() - 60e3,
        status: 'succeeded',
        msg: 'Sent',
        upd: Date.now(),
        ref: '',
        ev: [{ i: 7, t: Date.now(), s: 'succeeded', m: 'Sent' }],
      },
    ];
    norm(S); // (as a sync does)
    save();
  });
  const r = (await app.state()).wruns[0];
  expect(r.cur).toBe('s2');
  expect(r.st.s1).toMatchObject({ o: 'done', exec: 'x1', note: 'Automation: Sent' });
  // Folding the same report now changes nothing (already there).
  expect(
    await page.evaluate(() =>
      foldExecEvent({
        id: 7,
        execution: 'x1',
        flow: 'f1',
        status: 'succeeded',
        message: 'Sent',
        reported_at: new Date().toISOString(),
      }),
    ),
  ).toBe(false);
  expect((await app.state()).wruns[0].cur).toBe('s2');
  // A failure synced in the same way fails the run, once, and a late success for it is ignored.
  await page.evaluate(() => {
    const r = makeRun(S.workflows[0]);
    r.live.exec = 'x2';
    r.status = 'awaiting_automation';
    S.wruns.push(r);
    S.execs.push({
      id: 'x2',
      flow: 'f1',
      q: '',
      at: Date.now(),
      status: 'failed',
      msg: 'boom',
      upd: Date.now(),
      ref: '',
      ev: [],
    });
    norm(S);
    norm(S);
  });
  const r2 = (await app.state()).wruns[1];
  expect(r2).toMatchObject({ status: 'failed', err: 'Automation failed: boom' });
  expect(r2.log.filter(l => l.k === 'failed')).toHaveLength(1);
  expect(app.errors).toEqual([]);
});

test('audit 2: the workflow editor keeps typed fields over a day toggle, a background redraw and a foreground one', async ({
  app,
  page,
}) => {
  await app.open();
  await page.evaluate(seed);
  await page.evaluate(() => {
    S.workflows = [wf()];
    save();
  });
  await app.processes();
  await app.processes();
  await page.click('[data-wfview="w1"]');
  await page.click('[data-wfedit="w1"]');
  await page.fill('#wfname', 'Typed');
  await page.fill('#wfdesc', 'Desc');
  await page.click('#wfrep summary');
  await page.selectOption('#wfmonth', '15');
  await page.click('[data-wfpreset="weekdays"]');
  await expect(page.locator('#wfname')).toHaveValue('Typed');
  await expect(page.locator('#wfdesc')).toHaveValue('Desc');
  await expect(page.locator('#wfmonth')).toHaveValue('15');
  await page.click('[data-wfday="6"]');
  await expect(page.locator('#wfname')).toHaveValue('Typed');
  await page.evaluate(() => inBackground(renderAll));
  await expect(page.locator('#wfname')).toHaveValue('Typed');
  await expect(page.locator('#wfdesc')).toHaveValue('Desc');
  await page.evaluate(() => renderAll());
  await expect(page.locator('#wfname')).toHaveValue('Typed');
  await expect(page.locator('#wfdesc')).toHaveValue('Desc');
  await page.click('#wfform .btn.green');
  expect((await app.state()).workflows[0]).toMatchObject({
    name: 'Typed',
    desc: 'Desc',
    monthDay: 15,
    days: [1, 2, 3, 4, 5, 6],
  });
  // A template's flow stage can't be saved without a flow.
  await app.processes();
  await page.click('[data-wftpl="0"]');
  await page.fill('#wfname', 'Weekly');
  await page.click('#wfform .btn.green');
  await expect(page.locator('#toast')).toContainText('Choose the automation for “Run the report automation”');
  expect((await app.state()).workflows).toHaveLength(1);
  expect(app.errors).toEqual([]);
});

test('audit 3: opening a run from Today asks before discarding an article being written', async ({
  app,
  page,
}) => {
  await app.open();
  await page.evaluate(seed);
  await page.evaluate(() => {
    S.workflows = [wf()];
    S.wruns = [makeRun(S.workflows[0], { prepared: true })];
    save();
    kbEdit = { cat: '', title: 'Draft', body: 'keep' };
    go('knowledge');
  });
  await app.go('today');
  await unfold(page, 'attd');
  await page.click('#v-today .attn [data-wfopen]');
  await expect(page.locator('#sheettitle')).toHaveText('Leave this article?');
  await page.click('#sheet [data-sheetclose]:not(.sheetback)');
  expect(await page.evaluate(() => kbEdit && kbEdit.title)).toBe('Draft');
  expect(app.errors).toEqual([]);
});

test('audit 4/6: a repeating task keeps its estimate on every copy and counts in the forecast; what’s beyond the view is not an overrun', async ({
  app,
  page,
}) => {
  await app.open();
  await page.evaluate(() => {
    S.cap = [100, 100, 100, 100, 100, 100, 100];
    S.quests = [
      fix({ id: 'q1', text: 'Standup', est: 15 }),
      fix({ id: 'big', text: 'Big undated', est: 1440 }),
    ];
    setRepeat(find('q1').n, t => (t.days = [0, 1, 2, 3, 4, 5, 6]));
    save();
  });
  const s = await app.state();
  expect(s.templates[0].est).toBe(15);
  const f = await page.evaluate(() => {
    const f = allocate(7);
    return {
      days: f.days.map(d => [d.load, d.over]),
      beyond: f.items.filter(x => x.beyond).map(x => [x.text, x.beyond]),
      recs: recommendations(f).map(r => r.text),
    };
  });
  expect(f.days.slice(1).every(d => d[0] >= 15)).toBe(true); // (the repeat on every later day)
  expect(f.days.every(d => d[1] === 0)).toBe(true); // (no overrun: the big task isn't due)
  expect(f.beyond).toEqual([['Big undated', 1440 - (700 - 15 - 6 * 15)]]);
  expect(f.recs.join('\n')).toContain('Big undated (');
  expect(f.recs.join('\n')).toContain('past the 7 days in view');
  await page.evaluate(() => {
    S.day = shift(today(), -1);
    rollover();
  });
  expect((await app.state()).quests.find(q => q.tpl).est).toBe(15);
  // Repeat off takes the estimate off the template too.
  await page.evaluate(() => {
    const c = S.quests.find(q => q.tpl); // (today's copy: the day's reset replaced the original)
    delete c.est;
    setRepeat(c, t => (t.days = [1]));
  });
  expect((await app.state()).templates[0].est).toBeUndefined();
  expect(app.errors).toEqual([]);
});

test('audit 5: yesterday’s never-started run gives way to today’s; Resume takes the newest open run', async ({
  app,
  page,
}) => {
  await app.open();
  await page.evaluate(seed);
  const ids = await page.evaluate(() => {
    S.workflows = [wf({ days: [0, 1, 2, 3, 4, 5, 6] })];
    S.wruns = [makeRun(S.workflows[0], { id: 'w1-' + shift(today(), -7), prepared: true })];
    S.day = shift(today(), -1);
    rollover();
    save();
    return S.wruns.map(r => [r.id, r.status]);
  });
  expect(ids).toEqual([
    ['w1-' + (await page.evaluate(() => shift(today(), -7))), 'cancelled'],
    ['w1-' + (await page.evaluate(() => today())), 'ready'],
  ]);
  await app.processes();
  await page.click('[data-wfstart="w1"]');
  expect(await page.evaluate(() => wfOpen)).toBe('w1-' + (await page.evaluate(() => today())));
  expect((await app.state()).wruns).toHaveLength(2);
  expect(app.errors).toEqual([]);
});

test('audit 7: a waiting stage’s item taken to Today still resolves the stage; a result while paused applies on resume', async ({
  app,
  page,
}) => {
  await app.open();
  await page.evaluate(seed);
  await page.evaluate(() => {
    S.workflows = [
      wf({
        stages: [
          { id: 's1', type: 'wait', title: 'Approval', who: 'Sam' },
          { id: 's2', type: 'manual', title: 'Send' },
        ],
      }),
    ];
    const r = makeRun(S.workflows[0]);
    S.wruns = [r];
    stageWaitItem(r, r.def[0]);
    settleRun(r);
    save();
    renderAll();
  });
  let r = (await app.state()).wruns[0];
  expect(r.status).toBe('waiting');
  const item = r.live.wait;
  // Taken to Today (triage's Today): the waiting moves to a step of the new task.
  await page.evaluate(id => {
    const it = S.inbox.find(x => x.id === id);
    S.inbox = S.inbox.filter(x => x !== it);
    S.quests.push(inboxToNode(it));
    save();
    renderAll();
  }, item);
  await page.evaluate(() => openWorkflowRun(S.wruns[0].id));
  await expect(page.locator('#v-knowledge .pstep')).toContainText('Waiting on Sam');
  expect(await page.evaluate(() => runWord(S.wruns[0]))).toBe('Waiting on someone');
  await page.click('[data-wfact="received"]');
  r = (await app.state()).wruns[0];
  expect(r.cur).toBe('s2');
  expect(r.st.s1.o).toBe('done');
  expect(app.errors).toEqual([]);
});

test('audit 9/17: rule-made runs don’t trigger rules; a duplicate’s decisions point at its own stages', async ({
  app,
  page,
}) => {
  await app.open();
  await page.evaluate(seed);
  await page.evaluate(() => {
    S.workflows = [
      wf({
        stages: [
          { id: 's1', type: 'decide', title: 'Pick', choices: [{ label: 'Go', next: 's3' }] },
          { id: 's2', type: 'manual', title: 'A' },
          { id: 's3', type: 'manual', title: 'B' },
        ],
      }),
    ];
    S.rules = [
      { id: 'r1', name: 'chain', on: { k: 'wrun_succeeded' }, do: { k: 'wrun', wf: 'w1' }, enabled: true },
    ];
    const r = makeRun(S.workflows[0], { byRule: true });
    S.wruns = [r];
    completeStage(r, 's1', { pick: 0 });
    completeStage(r, 's3');
    emitRun(r);
    S.cap = [1, 2, 3, 4, 5, 6, 7];
    save();
  });
  let s = await app.state();
  expect(s.wruns[0]).toMatchObject({ status: 'succeeded', st: { s1: { pick: 0, note: 'Go' } } });
  expect(s.wruns).toHaveLength(1); // (no second run: the first was a rule's)
  expect(s.rlog).toHaveLength(0);
  await page.evaluate(() => {
    S.inbox = [{ id: 'i1', text: 'Rule made', byRule: 1 }];
    const n = inboxToNode(S.inbox[0]);
    S.inbox = [];
    S.quests.push(n);
    save();
  });
  expect((await app.state()).quests.find(q => q.text === 'Rule made').byRule).toBe(1);
  await app.processes();
  await app.processes();
  await page.click('[data-wfview="w1"]');
  await page.click('[data-wfedit="w1"]');
  await page.click('[data-wfdup="w1"]');
  s = await app.state();
  const copy = s.workflows[1];
  expect(copy.stages[0].choices[0].next).toBe(copy.stages[2].id);
  expect(copy.stages.map(x => x.id)).not.toContain('s3');
  expect(app.errors).toEqual([]);
});

test('audit: the rules editor keeps a trigger’s details across a kind switch; accuracy reads the span asked for', async ({
  app,
  page,
}) => {
  await app.open();
  await page.evaluate(() => {
    S.rules = [
      {
        id: 'r1',
        name: 'R',
        on: { k: 'quest_done', match: 'report' },
        do: { k: 'quest', text: 'T', est: 20 },
        enabled: true,
      },
    ];
    S.log = [{ id: 'a', d: shift(today(), -20), text: 'A', trail: [], p: '', est: 60, m: 60 }];
    save();
  });
  await app.go('account');
  await page.click('[data-ruleedit="r1"]');
  await page.selectOption('#rlon', 'day');
  await page.selectOption('#rlon', 'quest_done');
  await expect(page.locator('#rlmatch')).toHaveValue('report');
  await page.selectOption('#rldo', 'note');
  await page.selectOption('#rldo', 'quest');
  await expect(page.locator('#rlest')).toHaveValue('20');
  await page.click('#sheet [data-sheetclose]:not(.sheetback)');
  expect(
    await page.evaluate(() => [
      estimateAccuracy(7).n,
      estimateAccuracy(30).n,
      accuracyText(estimateAccuracy(90)).slice(0, 21),
    ]),
  ).toEqual([0, 1, 'Over the last 90 days']);
  expect(app.errors).toEqual([]);
});

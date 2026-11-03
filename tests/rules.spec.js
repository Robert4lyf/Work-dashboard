// Release C: rules (when → then), their log, idempotency, limits and the editor.
const { test, expect } = require('./fixtures');

const seed = () => {
  S.track = true;
  S.flows = [{ id: 'f1', name: 'Report flow', url: 'ms-powerautomate:/flows/x' }];
  S.quests = [fix({ id: 'q1', text: 'Weekly reporting' }), fix({ id: 'q2', text: 'Call Dana' })];
  S.workflows = [
    {
      id: 'w1',
      name: 'Month end',
      stages: [{ id: 's1', type: 'manual', title: 'Close' }],
      days: [],
      monthDay: 0,
      ver: 1,
    },
  ];
  S.rules = [
    {
      id: 'r1',
      name: 'After reporting',
      on: { k: 'quest_done', match: 'report' },
      do: { k: 'inbox', text: 'File {name}' },
      enabled: true,
    },
    {
      id: 'r2',
      name: 'Flow failed',
      on: { k: 'exec_failed', flow: 'f1' },
      do: { k: 'wait', text: 'Ask IT about {name}: {err}', who: 'IT', days: 1 },
      enabled: true,
    },
    {
      id: 'r3',
      name: 'Prepare month end',
      on: { k: 'day', days: [new Date().getDay()] },
      do: { k: 'wrun', wf: 'w1' },
      enabled: true,
    },
    {
      id: 'r4',
      name: 'Disabled',
      on: { k: 'quest_done' },
      do: { k: 'quest', text: 'Never' },
      enabled: false,
    },
    {
      id: 'r5',
      name: 'Note it',
      on: { k: 'wrun_succeeded' },
      do: { k: 'note', text: '{name} done {day}' },
      enabled: true,
    },
  ];
  save();
  renderAll();
};
const rlog = page => page.evaluate(() => S.rlog.map(l => [l.r, l.out, l.m]));
// Tick (or untick) a quest as its check button does.
const tick = (page, id) =>
  page.evaluate(id => {
    const r = find(id),
      bf = snapshot();
    r.n.done = !r.n.done;
    settle(bf);
  }, id);

test('rules fire once per event, fill in the words, skip disabled rules, and never fire on what a rule made', async ({
  app,
  page,
}) => {
  await app.open();
  await page.evaluate(seed);
  await page.click('[aria-label="Mark done: Weekly reporting"]');
  let s = await app.state();
  expect(s.inbox.map(i => i.text)).toEqual(['File Weekly reporting']);
  expect(s.inbox[0].byRule).toBe(1);
  expect(await rlog(page)).toEqual([['r1', 'done', 'inbox: File Weekly reporting']]);
  // Un-done and done again the same day: the same event, not a second item.
  await tick(page, 'q1');
  await tick(page, 'q1');
  s = await app.state();
  expect(s.inbox).toHaveLength(1);
  expect(s.rlog).toHaveLength(1);
  // Another quest doesn't match the name filter; the disabled rule never fires.
  await page.click('[aria-label="Mark done: Call Dana"]');
  expect((await app.state()).inbox).toHaveLength(1);
  expect((await app.state()).rlog).toHaveLength(1);
  // A quest a rule made, finished: no rule fires on it (no loops).
  await page.evaluate(() => {
    S.rules.push({
      id: 'r6',
      name: 'Chain',
      on: { k: 'quest_done' },
      do: { k: 'quest', text: 'Follow-up on {name}' },
      enabled: true,
    });
    S.quests.push(fix({ id: 'q3', text: 'Reports chase' }));
    save();
    renderAll();
  });
  await page.click('[aria-label="Mark done: Reports chase"]');
  s = await app.state();
  const made = s.quests.find(q => q.byRule);
  expect(made.text).toBe('Follow-up on Reports chase');
  expect(s.inbox.map(i => i.text)).toEqual(['File Reports chase', 'File Weekly reporting']);
  await tick(page, made.id);
  s = await app.state();
  expect(s.quests.filter(q => q.byRule)).toHaveLength(1);
  expect(s.inbox).toHaveLength(2);
  expect(app.errors).toEqual([]);
});

test('a flow failure makes one waiting item on every device (same id), the day rule prepares a run once a day, limits hold', async ({
  app,
  page,
}) => {
  await app.open();
  await page.evaluate(seed);
  const ev = {
    id: 7,
    execution: 'x1',
    flow: 'f1',
    status: 'failed',
    message: 'Timeout',
    reported_at: new Date().toISOString(),
  };
  await page.evaluate(ev => {
    S.execs.push({
      id: 'x1',
      flow: 'f1',
      q: '',
      at: Date.now(),
      status: 'requested',
      msg: '',
      upd: Date.now(),
      ref: '',
      ev: [],
    });
    foldExecEvent(ev);
    save();
    renderAll();
  }, ev);
  let s = await app.state();
  expect(s.inbox).toHaveLength(1);
  expect(s.inbox[0]).toMatchObject({
    text: 'Ask IT about Report flow: Timeout',
    wait: { who: 'IT', due: await page.evaluate(() => shift(today(), 1)) },
  });
  const itemId = s.inbox[0].id;
  expect(s.follows.map(f => f.k)).toEqual(['start']);
  // The same event on "another device" (its log not here yet): the same item id, so nothing doubles.
  await page.evaluate(ev => {
    S.rlog = [];
    S.execs[0].ev = [];
    S.execs[0].status = 'requested';
    foldExecEvent(ev);
  }, ev);
  s = await app.state();
  expect(s.inbox).toHaveLength(1);
  expect(s.inbox[0].id).toBe(itemId);
  expect(s.rlog.map(l => l.m)).toEqual(['already there']);
  // The day rule, through the daily reset: a run ready, once, named by the day.
  const run = async () =>
    page.evaluate(() => {
      S.day = shift(today(), -1);
      rollover();
      return S.wruns.map(r => [r.id, r.status, r.byRule]);
    });
  const first = await run();
  expect(first).toHaveLength(1);
  expect(first[0][1]).toBe('ready');
  expect(first[0][2]).toBe(1);
  expect(await run()).toEqual(first);
  await app.go('today');
  await expect(page.locator('#v-today .attn [data-wfopen]')).toContainText('Month end');
  // A rule's own cap, then the cap for all rules: logged as limited, not done.
  await page.evaluate(() => {
    S.rules = [
      { id: 'r9', name: 'Many', on: { k: 'quest_done' }, do: { k: 'note', text: 'x' }, enabled: true },
    ];
    S.rlog = [];
    for (let i = 0; i < 25; i++) emitEvent({ k: 'quest_done', key: 'quest:' + i, text: 'q' + i });
  });
  const outs = await page.evaluate(() => S.rlog.map(l => l.out));
  expect(outs.filter(o => o === 'done')).toHaveLength(20);
  expect(outs.filter(o => o === 'limit')).toHaveLength(5);
  // An action that can't be done is logged as an error, and the rest of the app goes on.
  await page.evaluate(() => {
    S.rules = [
      { id: 'r10', name: 'Gone', on: { k: 'quest_done' }, do: { k: 'wrun', wf: 'nope' }, enabled: true },
    ];
    S.rlog = [];
    emitEvent({ k: 'quest_done', key: 'quest:zz', text: 'z' });
  });
  expect(await rlog(page)).toEqual([['r10', 'err', 'that workflow is gone']]);
  expect(app.errors).toEqual([]);
});

test('Settings: rules are added, previewed, switched off and deleted; the log shows what happened', async ({
  app,
  page,
}) => {
  await app.open();
  await page.evaluate(seed);
  await app.go('account');
  await expect(page.locator('#v-account .rulerow')).toHaveCount(5);
  await expect(page.locator('#v-account .rulerow').nth(0)).toContainText(
    'When A quest is finished (named like “report”), add an inbox item: “File {name}”',
  );
  await expect(page.locator('#v-account .rulerow').nth(0)).toContainText('Never fired');
  await page.click('[data-rulenew]');
  await page.fill('#rlname', 'Chase on Friday');
  await page.selectOption('#rlon', 'day');
  await expect(page.locator('#ruleform .days')).toBeVisible();
  await page.click('[data-rlday="5"]');
  await page.selectOption('#rldo', 'quest');
  await expect(page.locator('#rlname')).toHaveValue('Chase on Friday'); // (kept over the redraw)
  await page.fill('#rltext', 'Chase the week’s approvals');
  await page.fill('#rlest', '20');
  await expect(page.locator('.rlprev')).toContainText(
    'Preview: when The app is opened on Fri, add a quest to today: “Chase the week’s approvals”.',
  );
  await page.click('#sheetok');
  await expect(page.locator('#sheet')).toHaveCount(0);
  const r = (await app.state()).rules.find(x => x.name === 'Chase on Friday');
  expect(r).toMatchObject({
    on: { k: 'day', days: [5] },
    do: { k: 'quest', text: 'Chase the week’s approvals', est: 20 },
    enabled: true,
  });
  // The preview counts the last 30 days from the records.
  await page.evaluate(() => {
    S.log.push({ id: 'q1', d: today(), text: 'Weekly reporting', trail: [], p: '' });
    S.log.push({ id: 'q9', d: shift(today(), -40), text: 'Old report', trail: [], p: '' });
  });
  await page.click('[data-ruleedit="r1"]');
  await expect(page.locator('.rlprev')).toContainText('would have fired 1 time');
  await page.click('[data-sheetclose]:not(.sheetback)');
  // Off: nothing fires; the switch says so.
  await page.click('[data-ruleon="r1"]');
  await expect(page.locator('[data-ruleon="r1"]')).toHaveText('Off');
  await app.go('today');
  await page.click('[aria-label="Mark done: Weekly reporting"]');
  expect((await app.state()).inbox).toHaveLength(0);
  await app.go('account');
  await page.click('[data-ruleon="r1"]');
  await tick(page, 'q1');
  await tick(page, 'q1');
  await tick(page, 'q1');
  await app.go('account');
  await expect(page.locator('#v-account .rulerow').nth(0)).toContainText('inbox: File Weekly reporting');
  await page.click('#rlogd summary');
  await expect(page.locator('#rlogd li')).toHaveCount(1);
  // Delete: two taps.
  await page.click('[data-ruleedit="r1"]');
  await page.click('[data-ruledel="r1"]');
  await expect(page.locator('[data-ruledel="r1"]')).toHaveText('Delete it?');
  await page.click('[data-ruledel="r1"]');
  await expect(page.locator('#v-account .rulerow')).toHaveCount(5);
  await expect(page.locator('#rlogd li')).toContainText('removed rule');
  // A rule needs the right bits: no workflow chosen, no text, no day.
  await page.click('[data-rulenew]');
  await page.fill('#rlname', 'Half');
  await page.selectOption('#rldo', 'wrun');
  await page.selectOption('#rlwrun', '');
  await page.click('#sheetok');
  await expect(page.locator('#toast')).toContainText('Choose the workflow');
  await expect(page.locator('#sheet')).toHaveCount(1);
  await page.evaluate(() => history.back());
  await expect(page.locator('#sheet')).toHaveCount(0);
  expect(app.errors).toEqual([]);
});

test('junk rules and log rows are dropped; the wait-due and weekday events come from the daily reset once', async ({
  app,
  page,
}) => {
  await app.open();
  await page.evaluate(() => {
    S.rules = [
      { id: 'ok', name: 'x', on: { k: 'quest_done' }, do: { k: 'note' } },
      { id: 'bad', name: 'x', on: { k: 'eval' }, do: { k: 'shell', cmd: 'rm' } },
      { id: 'bad2', name: 'x', on: { k: 'quest_done' }, do: { k: 'fetch', url: 'https://x' } },
      'junk',
    ];
    S.rlog = [
      { id: 'l1', r: 'ok', t: 'soon' },
      { id: 'l2', r: 'ok', t: Date.now(), out: 'weird' },
    ];
    S.quests = [
      fix({
        id: 'q1',
        text: 'Sign-off',
        wait: { who: 'Sam', note: '', due: shift(today(), -1), since: shift(today(), -3) },
      }),
    ];
    norm(S);
    S.rules.push({
      id: 'r1',
      name: 'Chase',
      on: { k: 'wait_due' },
      do: { k: 'inbox', text: 'Chase {who} about {name}' },
      enabled: true,
    });
    save();
  });
  let s = await app.state();
  expect(s.rules.map(r => r.id)).toEqual(['ok', 'r1']);
  expect(s.rlog).toEqual([expect.objectContaining({ id: 'l2', out: 'err' })]);
  await page.evaluate(() => {
    S.day = shift(today(), -1);
    rollover();
    S.day = shift(today(), -1);
    rollover();
  });
  s = await app.state();
  expect(s.inbox.map(i => i.text)).toEqual(['Chase Sam about Sign-off']); // (the quest, not its waiting step)
  expect(s.rlog.filter(l => l.r === 'r1')).toHaveLength(1);
  expect(app.errors).toEqual([]);
});

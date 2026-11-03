// Release B: automation execution tracking: launches, reports folded in, the states shown.
const { test, expect, unfold } = require('./fixtures');

const seed = () => {
  S.flows = [
    { id: 'f1', name: 'Weekly report', url: 'ms-powerautomate:/console/flow/run?x=1', last: 0 },
    { id: 'f2', name: 'Archive', url: 'ms-powerautomate:/console/flow/run?x=2', last: 0 },
  ];
  S.quests = [fix({ id: 'q1', text: 'Reporting', links: [{ id: 'l1', kind: 'flow', ref: 'f1' }] })];
  S.track = true;
  save();
  renderAll();
};
// A report as the server would store it.
const ev = (id, flow, status, extra = {}) => ({
  id,
  execution: '',
  flow,
  status,
  message: '',
  run_ref: '',
  reported_at: new Date(2026, 10, 5, 9, 1, id).toISOString(), // (after the launch)
  ...extra,
});

test.beforeEach(async ({ app, page }) => {
  await page.clock.install({ time: new Date(2026, 10, 5, 9) });
  await app.open();
  await page.clock.pauseAt(new Date(2026, 10, 5, 9, 0, 30));
  await page.evaluate(seed);
});

test('a tap records a launch (never a result); without tracking it is only remembered on the flow', async ({
  app,
  page,
}) => {
  await unfold(page, 'flowsd');
  await page.click('#v-today a[data-flow="f1"]');
  await page.clock.runFor(10); // (the chips redraw once the link has been followed)
  let s = await app.state();
  expect(s.execs).toHaveLength(1);
  expect(s.execs[0]).toMatchObject({ flow: 'f1', q: '', status: 'requested', ev: [] });
  expect(s.flows[0].last).toBeGreaterThan(0);
  await expect(page.locator('#v-today a[data-flow="f1"] .xst')).toHaveText('…');
  await expect(page.locator('#v-today a[data-flow="f1"] .xst')).toHaveAttribute(
    'title',
    /Launched, no word yet/,
  );
  // From a quest's resources: the launch belongs to the quest.
  await app.openQuest('Reporting');
  await page.click('#resd a[data-flow="f1"]');
  await page.clock.runFor(10);
  s = await app.state();
  expect(s.execs[1]).toMatchObject({ flow: 'f1', q: 'q1', status: 'requested' });
  await expect(page.locator('#resd .xmini')).toContainText('Launched, no word yet');
  // A day of silence: unconfirmed, not succeeded.
  await page.clock.fastForward('25:00:00');
  await page.evaluate(() => renderAll());
  await expect(page.locator('#resd .xmini')).toContainText('Unconfirmed');
  expect((await app.state()).execs[1].status).toBe('requested'); // (the record itself is untouched)
  // Tracking off: a tap is just remembered.
  await page.evaluate(() => {
    S.track = false;
    save();
  });
  await page.click('#resd a[data-flow="f1"]');
  await page.clock.runFor(10);
  expect((await app.state()).execs).toHaveLength(2);
});

test('reports fold in: running then a result; duplicates and out-of-order reports are harmless; a late result replaces', async ({
  app,
  page,
}) => {
  await unfold(page, 'flowsd');
  await page.click('#v-today a[data-flow="f1"]');
  await page.clock.runFor(10);
  const x = (await app.state()).execs[0].id;
  const fold = evs => page.evaluate(evs => evs.map(e => foldExecEvent(e)), evs);
  expect(await fold([ev(1, 'f1', 'running', { execution: x })])).toEqual([true]);
  let s = await app.state();
  expect(s.execs[0]).toMatchObject({ status: 'running', ev: [{ i: 1, s: 'running' }] });
  expect(await fold([ev(1, 'f1', 'running', { execution: x })])).toEqual([false]); // (seen already)
  expect(await fold([ev(2, 'f1', 'succeeded', { execution: x, message: 'Sent 3 files' })])).toEqual([true]);
  s = await app.state();
  expect(s.execs[0]).toMatchObject({ status: 'succeeded', msg: 'Sent 3 files' });
  // An older "running" arriving after the result doesn't undo it.
  expect(
    await fold([
      ev(3, 'f1', 'running', { execution: x, reported_at: new Date(2026, 10, 5, 8, 59).toISOString() }),
    ]),
  ).toEqual([true]);
  s = await app.state();
  expect(s.execs[0].status).toBe('succeeded');
  expect(s.execs[0].ev).toHaveLength(3);
  // A later result replaces (a rerun reported against the same execution).
  await fold([ev(4, 'f1', 'failed', { execution: x, message: 'Step 4 failed' })]);
  s = await app.state();
  expect(s.execs[0]).toMatchObject({ status: 'failed', msg: 'Step 4 failed' });
  await page.evaluate(() => renderAll());
  await expect(page.locator('#v-today .attn [data-xdet]')).toContainText('Flow failed');
  await expect(page.locator('#v-today a[data-flow="f1"] .xst')).toHaveText('✗');
  // A report with no execution of its own: an execution made for it, marked as not launched here.
  await fold([ev(5, 'f2', 'succeeded')]);
  s = await app.state();
  const u = s.execs.find(e => e.flow === 'f2');
  expect(u).toMatchObject({ id: 'u5', status: 'succeeded', unreq: 1 });
  // Bad reports are ignored.
  expect(await fold([ev(6, 'f1', 'done'), ev(7, 'bad flow!', 'running'), { id: 'x' }])).toEqual([
    false,
    false,
    false,
  ]);
  expect((await app.state()).execs).toHaveLength(2);
});

test('a failure is actionable: details, run again, add to the Inbox, copy, acknowledge; history per flow', async ({
  app,
  page,
}) => {
  await unfold(page, 'flowsd');
  await page.click('#v-today a[data-flow="f1"]');
  await page.clock.runFor(10);
  const x = (await app.state()).execs[0].id;
  await page.evaluate(
    ([x, e1, e2]) => {
      foldExecEvent(e1);
      foldExecEvent(e2);
      save();
      renderAll();
    },
    [
      x,
      ev(1, 'f1', 'running', { execution: x }),
      ev(2, 'f1', 'failed', { execution: x, message: 'File not found' }),
    ],
  );
  await unfold(page, 'attd');
  await page.click('#v-today .attn [data-xdet]');
  const sheet = page.locator('#sheet .sheetbox');
  await expect(sheet.locator('#sheettitle')).toHaveText('Weekly report');
  await expect(sheet.locator('.xhead')).toContainText('Failed');
  await expect(sheet.locator('.xhead')).toContainText('File not found');
  await expect(sheet.locator('.flist li')).toHaveText([/Failed: File not found/, /Running/]);
  await expect(sheet.locator('a[data-flow="f1"]')).toHaveAttribute(
    'href',
    'ms-powerautomate:/console/flow/run?x=1',
  );
  await page.click('#sheet [data-xcopy]');
  await unfold(page, 'attd');
  await page.click('#v-today .attn [data-xdet]');
  await page.click('#sheet [data-xinbox]');
  let s = await app.state();
  expect(s.inbox[0].text).toBe('Flow failed: Weekly report');
  expect(s.inbox[0].node.notes).toContain('File not found');
  expect(s.execs[0].ack).toBe(1);
  await expect(page.locator('#v-today [data-xdet]')).toHaveCount(0); // (acknowledged by that)
  // Run again from the details: a new launch, requested, the old record kept.
  await page.evaluate(() => {
    document.querySelector('#v-today a[data-flow="f1"]').click();
  });
  await page.clock.runFor(10);
  s = await app.state();
  expect(s.execs).toHaveLength(2);
  expect(s.execs[1].status).toBe('requested');
  expect(s.execs[0].status).toBe('failed');
  // Knowledge > Flows: the latest result, details and history.
  await app.go('knowledge');
  await page.evaluate(() => (document.querySelector('#kbflows').open = true));
  await expect(page.locator('#v-knowledge .flowline').nth(1)).toContainText('Launched, no word yet'); // (flows by name: Archive, Weekly report)
  await page.click('#v-knowledge [data-xhist="f1"]');
  await expect(page.locator('#sheet .qact')).toHaveCount(2);
  await expect(page.locator('#sheet .qact').nth(1)).toContainText('Failed');
  await page.click('#sheet .qact >> nth=1');
  await expect(page.locator('#sheet .xhead')).toContainText('Failed');
  await expect(page.locator('#sheet [data-xack]')).toHaveCount(0); // (acknowledged already)
  await page.keyboard.press('Escape');
  // Offline: the status is shown as last synced, and says so.
  await page.context().setOffline(true);
  await page.click('#v-knowledge [data-xhist="f1"]');
  await expect(page.locator('#sheet .qahint')).toContainText('Offline');
  await page.context().setOffline(false);
});

test('records from a synced row or backup are checked and pruned', async ({ app, page }) => {
  await app.setState(s => {
    s.execs = [
      {
        id: 'ok',
        flow: 'f1',
        q: 'q1',
        at: Date.now(),
        status: 'weird',
        msg: 42,
        ev: [{ i: '3', t: 'x', s: 'running' }, { i: 1, s: 'nope' }, 'junk'],
        ack: 'y',
      },
      { id: 'bad id!', flow: 'f1', at: Date.now() },
      { id: 'noflow', at: Date.now() },
      ...Array.from({ length: 160 }, (_, i) => ({
        id: 'x' + i,
        flow: 'f2',
        at: 1000 + i,
        status: 'succeeded',
        ev: [],
      })),
    ];
  });
  await page.reload();
  const s = await app.state();
  expect(s.execs).toHaveLength(150);
  const ok = s.execs.find(e => e.id === 'ok');
  expect(ok).toMatchObject({
    status: 'requested',
    msg: '',
    ack: 1,
    ev: [{ i: 3, t: 0, s: 'running', m: '' }],
  });
  expect(s.execs.some(e => e.id === 'x0')).toBe(false); // (the oldest went)
});

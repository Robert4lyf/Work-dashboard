// Release G, checkpoint 2: regression tests for the concurrency and security review (one per
// confirmed defect; the SQL side is in tests/db/run.sh). Each fails without its fix.
const { test, expect } = require('@playwright/test');
const { server, device, settle, report } = require('./fakesb');

const flows = [{ id: 'f1', name: 'SSRS report', url: 'ms-powerautomate:/console/flow/run?x=1', last: 0 }];
const M = (id, title, extra = {}) => ({ id, type: 'manual', title, ...extra });
async function twoDevices(browser, stages, { prep = '', srvOpts = {}, one = false } = {}) {
  const srv = Object.assign(server(), srvOpts);
  const a = await device(browser, srv);
  await a.page.evaluate(
    ({ stages, prep, flows }) => {
      S.track = true;
      S.flows = flows;
      S.workflows = [{ id: 'w1', name: 'Weekly report', ver: 1, days: [], monthDay: 0, stages }];
      const r = makeRun(S.workflows[0], { id: 'r1' });
      S.wruns = [r];
      if (prep) new Function('r', prep)(r);
      norm(S);
      save();
    },
    { stages, prep, flows },
  );
  await a.sync();
  if (one) return { srv, a };
  const b = await device(browser, srv);
  await settle(a, b);
  return { srv, a, b };
}
const open = d => d.page.evaluate(() => openWorkflowRun('r1'));
const box = d => d.page.locator('#v-knowledge .wconf');
const srvRun = srv => srv.rows.get('wrun:r1').data;
const noErrors = (...ds) => ds.forEach(d => expect(d.errors).toEqual([]));
const more = async d => {
  if (!(await d.page.locator('#wfmore[open]').count())) await d.page.click('#wfmore summary');
};
// Many check boxes: a verification step with `n` checks.
const checks = n => [
  { id: 's1', type: 'verify', title: 'Check', checks: Array.from({ length: n }, (_, i) => 'C' + i) },
];

test('1: a late report from an attempt a retry set aside never completes the newer attempt', async ({
  browser,
}) => {
  const { srv, a } = await twoDevices(
    browser,
    [{ id: 's1', type: 'flow', title: 'Run SSRS', flow: 'f1' }, M('s2', 'Send')],
    {
      one: true,
    },
  );
  const token = await a.page.evaluate(async () => (await sb.rpc('cockpit_new_exec_token')).data);
  await open(a);
  await a.page.click('a[data-flow="f1"][data-wstage="s1"]');
  const x1 = (await a.run('r1')).live.exec;
  // Said to have failed by hand, while the automation still hasn't reported; tried again.
  await a.page.click('[data-wfact="confirmflow"][data-ok="no"]');
  await a.page.click('[data-wfact="retry"]');
  await a.page.click('#sheetok');
  await a.page.click('a[data-flow="f1"][data-wstage="s1"]');
  const x2 = (await a.run('r1')).live.exec;
  expect(x2).not.toBe(x1);
  // The first attempt is set aside on its own record, synced (no longer flagged as waiting).
  const s = await a.state();
  expect(s.execs.find(x => x.id === x1)).toMatchObject({ status: 'requested', aside: 1, ack: 1 });
  expect(s.execs.find(x => x.id === x2).aside).toBeUndefined();
  await a.sync();
  expect(srv.rows.get('exec:' + x1).data.aside).toBe(1);
  // The first attempt's late report, with no execution id: two launches are waiting (x1, set
  // aside, and x2), so it is paired with neither (Release H; Release G took the oldest). The step
  // still waits for x2, and says a result came that it didn't take.
  const r1 = await report(a, { token, flow: 'f1', status: 'succeeded', message: 'attempt 1 finished' });
  expect(r1.data.execution).toBe('');
  await settle(a);
  expect(await a.run('r1')).toMatchObject({ cur: 's1', status: 'awaiting_automation', live: { exec: x2 } });
  await expect(a.page.locator('#v-knowledge .wstray')).toContainText('names no attempt');
  // x2's own report, naming it, then completes the step, as x2.
  const r2 = await report(a, { token, flow: 'f1', status: 'succeeded', message: 'attempt 2', execution: x2 });
  expect(r2.data.execution).toBe(x2);
  await settle(a);
  expect(await a.run('r1')).toMatchObject({
    cur: 's2',
    st: { s1: { o: 'done', exec: x2, note: 'Automation: attempt 2' } },
  });
  noErrors(a);
});

test('2: failure ids are unique across devices: each failure gets its own Inbox item', async ({
  browser,
}) => {
  const { a, b } = await twoDevices(browser, [M('s1', 'Prepare'), M('s2', 'Send')]);
  for (const d of [a, b]) {
    await open(d);
    await d.offline(true);
  }
  // Both fail the same step by hand, offline; A adds its failure to the Inbox.
  for (const [d, why] of [
    [a, 'Printer jammed'],
    [b, 'Missing file'],
  ]) {
    await d.page.click('[data-wfact="fail"][data-wstage="s1"]');
    await d.page.fill('#sheetin', why);
    await d.page.click('#sheetok');
  }
  await more(a);
  await a.page.click('[data-wfact="inbox"]');
  await b.offline(false);
  await b.sync();
  await a.offline(false);
  await a.sync();
  // A keeps the server's run: B's failure. Its Add to the Inbox is B's failure's own item.
  await a.page.click('[data-wcact="keep"]');
  expect((await a.run('r1')).err).toBe('Missing file');
  await more(a);
  await a.page.click('[data-wfact="inbox"]');
  await expect.poll(async () => (await a.toasts()).filter(t => t === 'Added to inbox').length).toBe(2); // (A's own failure's, then the server's)
  const notes = (await a.state()).inbox.map(i => i.node.notes);
  expect(notes).toHaveLength(2);
  expect(notes.filter(n => n.includes('Error: Missing file'))).toHaveLength(1);
  expect(notes.filter(n => n.includes('Error: Printer jammed'))).toHaveLength(1);
  noErrors(a, b);
});

test('3: a run changed back while its change is being sent: the change back follows it', async ({
  browser,
}) => {
  // (the run as synced: its first check unticked)
  const { srv, a } = await twoDevices(browser, checks(2), { one: true, prep: 'r.live.checks = [false];' });
  await open(a);
  // A ticks; while that change is on its way (taken, not yet answered), the tick is undone: the
  // run is just as it was last synced.
  srv.beforeAnswer = page =>
    page.evaluate(() => {
      checkStage(wrunById('r1'), 's1', 0, false);
      save();
      clearTimeout(pushT);
    });
  await a.page.click('[data-wfact="check"][data-i="0"]');
  await a.page.evaluate(() => clearTimeout(pushT));
  await a.sync();
  await a.sync();
  // The server has the undo too: device and server agree.
  expect(srvRun(srv).live.checks).toEqual([false]);
  expect((await a.run('r1')).live.checks).toEqual([false]);
  expect(await a.page.evaluate(() => !!sync2.dirty['wrun:r1'])).toBe(false);
  expect((await a.run('r1')).rev).toBe(srvRun(srv).rev);
  noErrors(a);
});

test('4: a run the server refuses for its size is said on its page and holds up nothing else', async ({
  browser,
}) => {
  const { srv, a } = await twoDevices(browser, [M('s1', 'Prepare')], { one: true });
  // A 30-step verification process with CJK text at the caps: under the caps in characters,
  // over 256 KB in bytes.
  await a.page.evaluate(() => {
    const t = n => '検'.repeat(n),
      r = wrunById('r1');
    r.def = Array.from({ length: 30 }, (_, i) => ({
      id: 'v' + i,
      type: 'verify',
      title: t(120),
      text: t(1000),
      checks: Array.from({ length: 12 }, () => t(160)),
    }));
    r.cur = 'v0';
    norm(S);
    S.quests.push(fix({ id: 'q1', text: 'Something else' }));
    save();
  });
  expect(await a.page.evaluate(() => JSON.stringify(wrunById('r1')).length)).toBeLessThan(262144);
  await a.sync();
  await expect(a.page.locator('#syncBtn')).toHaveText('Synced');
  expect(srv.rows.get('quest:q1')).toBeTruthy(); // (the rest still went)
  await open(a);
  await expect(a.page.locator('.runprog .wsync')).toHaveText('Not synced');
  await expect(a.page.locator('#v-knowledge .wconf')).toContainText(
    /Not synced: too large to sync \(\d+ KB; at most 256 KB\)/,
  );
  // Not sent again each sync while it's unchanged.
  const puts = srv.puts.length;
  await a.sync();
  expect(srv.puts.length).toBe(puts);
  // Use the server's: the server's run back here, what wasn't sent said in its history.
  await a.page.click('[data-wtake="r1"]');
  await expect(a.page.locator('#v-knowledge .wconf')).toHaveCount(0);
  const r = await a.run('r1');
  expect(r.def).toHaveLength(1);
  expect(r.log[r.log.length - 1]).toMatchObject({ k: 'conflict' });
  expect(r.log[r.log.length - 1].m).toContain('not synced from this device (too large to sync');
  await a.sync();
  expect(srvRun(srv).def).toHaveLength(1);
  // Refused by the server for what it sends (here a revision past the server's range): the same,
  // and the rest goes on.
  await a.page.evaluate(() => {
    sync2.wrev['wrun:r1'] = 999999999;
    completeStage(wrunById('r1'), 's1', { by: 'hand' });
    S.quests.push(fix({ id: 'q2', text: 'And another' }));
    save();
    clearTimeout(pushT);
  });
  await a.sync();
  await expect(a.page.locator('#syncBtn')).toHaveText('Synced');
  expect(srv.rows.get('quest:q2')).toBeTruthy();
  await open(a);
  await expect(a.page.locator('#v-knowledge .wconf')).toContainText(
    'Not synced: base revision out of range.',
  );
  noErrors(a);
});

test('6: a backup restored while the run changed elsewhere is a conflict, never dropped in silence', async ({
  browser,
}) => {
  const { srv, a, b } = await twoDevices(browser, [M('s1', 'Prepare'), M('s2', 'Send'), M('s3', 'File')]);
  const backup = await a.page.evaluate(() => JSON.stringify(S));
  await open(a);
  await a.page.click('[data-wfact="done"][data-wstage="s1"]');
  await settle(a, b);
  // A, offline, restores the backup (before s1); meanwhile B moves the run on.
  await a.offline(true);
  await a.page.evaluate(j => {
    pending = JSON.parse(j);
    openSettings('backup');
  }, backup);
  await a.page.click('#doRestore');
  await open(b);
  await b.page.click('[data-wfact="done"][data-wstage="s2"]');
  await b.sync();
  await a.offline(false);
  await a.sync();
  await open(a);
  await expect(box(a)).toContainText('This device: replaced it (restored from a backup, say).');
  expect((await a.run('r1')).cur).toBe('s3'); // (the server's, for now)
  await a.page.click('[data-wcact="mine"]');
  await settle(a, b);
  expect(srvRun(srv)).toMatchObject({ cur: 's1', st: {} });
  noErrors(a, b);
});

test('7: a run new here that the server has too, with steps done here, is a conflict', async ({
  browser,
}) => {
  const { a, b } = await twoDevices(browser, [M('s1', 'Prepare'), M('s2', 'Send')]);
  // B, offline, makes run r9 and does its first step (its journal lost, as after signing in);
  // A makes a run with the same id and syncs first.
  await b.offline(true);
  await b.page.evaluate(() => {
    S.wruns.push(makeRun(S.workflows[0], { id: 'r9' }));
    completeStage(wrunById('r9'), 's1', { by: 'hand' });
    save();
    delete sync2.wjour.r9;
    saveSyncState();
  });
  await a.page.evaluate(() => {
    S.wruns.push(makeRun(S.workflows[0], { id: 'r9' }));
    save();
  });
  await a.sync();
  await b.offline(false);
  await b.sync();
  const s = await b.state();
  expect(s.wconflicts.map(c => c.run)).toEqual(['r9']);
  expect(s.wconflicts[0].mine.st.s1.o).toBe('done');
  noErrors(a, b);
});

test('8: what a change sent held is known by number, however the journal was trimmed', async ({
  browser,
}) => {
  const { a } = await twoDevices(browser, checks(2), { one: true });
  const left = await a.page.evaluate(() => {
    const r = wrunById('r1');
    for (let i = 0; i < 45; i++) checkStage(r, 's1', 0, i % 2 === 0);
    const j = sync2.wjour.r1,
      p = { op: 'opxxxxxxxx', base: 1, data: JSON.parse(JSON.stringify(r)), upto: j[j.length - 1].q };
    // Three more while it was on its way.
    checkStage(r, 's1', 1, true);
    checkStage(r, 's1', 1, false);
    checkStage(r, 's1', 1, true);
    sync2.wop['wrun:r1'] = p;
    acceptedRun('wrun:r1', p, 2, null);
    return sync2.wjour.r1.map(e => [e.a, e.i, e.v]);
  });
  expect(left).toEqual([
    ['check', 1, true],
    ['check', 1, false],
    ['check', 1, true],
  ]);
  noErrors(a);
});

test('9: a conflict dropped for room is written into its run first; a run with a conflict isn’t pruned', async ({
  browser,
}) => {
  const { a } = await twoDevices(browser, [M('s1', 'Prepare')], { one: true });
  const got = await a.page.evaluate(() => {
    for (let i = 0; i < 21; i++) S.wruns.push(makeRun(S.workflows[0], { id: 'c' + i }));
    const mine = id => JSON.parse(JSON.stringify(wrunById(id)));
    for (let i = 0; i < 21; i++)
      wfConflict('c' + i, mine('c' + i), { ...mine('c' + i), status: 'paused' }, 1, 2, [
        { a: 'pause', q: i + 1 },
      ]);
    // (and a finished run long ago, with a conflict, kept through the tidy-up)
    const old = wrunById('c5');
    old.status = 'succeeded';
    old.fin = Date.now() - 400 * 864e5;
    save();
    return {
      n: S.wconflicts.length,
      first: S.wconflicts[0].run,
      note: wrunById('c0').log.slice(-1)[0],
      kept: !!wrunById('c5'),
    };
  });
  expect(got.n).toBe(20);
  expect(got.first).toBe('c1');
  expect(got.note).toMatchObject({
    k: 'conflict',
    m: 'not applied from this device (too many conflicts): paused it',
  });
  expect(got.kept).toBe(true);
  noErrors(a);
});

test('10: with the guard but not the function, a run change refused is kept as a conflict', async ({
  browser,
}) => {
  const { srv, a } = await twoDevices(browser, [M('s1', 'Prepare'), M('s2', 'Send')], {
    srvOpts: { wrunFn: false, guard: true },
    one: true,
  });
  await open(a);
  await a.page.click('[data-wfact="done"][data-wstage="s1"]');
  await a.sync();
  expect(srv.refused).toContain('wrun:r1');
  const s = await a.state();
  expect(s.wconflicts.map(c => c.run)).toEqual(['r1']);
  expect(s.wconflicts[0].mine.st.s1.o).toBe('done');
  await expect(box(a)).toContainText('This device: marked “Prepare” done.');
  noErrors(a);
});

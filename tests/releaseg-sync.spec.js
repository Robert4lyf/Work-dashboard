// Release G, checkpoint 2: process runs are written through the server's revision check
// (cockpit_put_wrun, emulated in fakesb.js with the same rules as supabase/release-g-runs.sql).
// Two devices can't overwrite each other's changes to a run: the second is refused, kept, and
// shown as a conflict to settle. A change sent twice is applied once. Without the function, runs
// sync as before.
const { test, expect } = require('@playwright/test');
const { server, device, settle, report } = require('./fakesb');

const flows = [{ id: 'f1', name: 'SSRS report', url: 'ms-powerautomate:/console/flow/run?x=1', last: 0 }];
const M = (id, title, extra = {}) => ({ id, type: 'manual', title, ...extra });
// A process and one run (r1) of it, started, made on A and synced; then B signs in.
async function twoDevices(browser, stages, { prep = '', track = true, srvOpts = {} } = {}) {
  const srv = Object.assign(server(), srvOpts);
  const a = await device(browser, srv);
  await a.page.evaluate(
    ({ stages, prep, track, flows }) => {
      S.track = track;
      S.flows = flows;
      S.workflows = [{ id: 'w1', name: 'Weekly report', ver: 1, days: [], monthDay: 0, stages }];
      const r = makeRun(S.workflows[0], { id: 'r1' });
      S.wruns = [r];
      if (prep) new Function('r', prep)(r);
      norm(S);
      save();
    },
    { stages, prep, track, flows },
  );
  await a.sync();
  const b = await device(browser, srv);
  await settle(a, b);
  return { srv, a, b };
}
const open = d => d.page.evaluate(() => openWorkflowRun('r1'));
const conflictBox = d => d.page.locator('#v-knowledge .wconf');
const wsync = d => d.page.locator('#v-knowledge .runprog .wsync');
const srvRun = srv => srv.rows.get('wrun:r1').data;
const noErrors = (...ds) => ds.forEach(d => expect(d.errors).toEqual([]));
// A toast said (from the log of every toast: another may have replaced it on screen since).
const said = (d, text) =>
  expect.poll(async () => (await d.toasts()).filter(t => t.includes(text)).length).toBeGreaterThan(0);
// A failed step's less common options, opened.
const more = async d => {
  if (!(await d.page.locator('#wfmore[open]').count())) await d.page.click('#wfmore summary');
};

test('two devices complete the same step offline: the second is refused and shown, never merged silently', async ({
  browser,
}) => {
  const { srv, a, b } = await twoDevices(browser, [M('s1', 'Prepare'), M('s2', 'Send')]);
  expect(srvRun(srv).rev).toBe(1);
  for (const d of [a, b]) {
    await open(d);
    await expect(wsync(d)).toHaveText('Synced, checked by the server');
    await d.offline(true);
    await d.page.click('[data-wfact="done"][data-wstage="s1"]');
    // (saved here, not yet taken by the server)
    await expect(wsync(d)).toHaveText('Saved on this device, not yet synced');
  }
  await a.offline(false);
  await a.sync();
  await expect(wsync(a)).toHaveText('Synced, checked by the server');
  expect(srvRun(srv)).toMatchObject({ rev: 2, cur: 's2' });
  await b.offline(false);
  await b.sync();
  // B's change was made to revision 1: refused; B has the server's run now, and its own kept.
  expect(srvRun(srv).rev).toBe(2);
  await expect(wsync(b)).toHaveText('Conflict: needs your choice');
  await expect(conflictBox(b)).toContainText('This device: marked “Prepare” done.');
  await expect(conflictBox(b)).toContainText('Server: Your turn at “Send”.');
  // (the step has moved on there: doing it again on top isn't offered)
  await expect(b.page.locator('[data-wcact="mine"]')).toHaveCount(0);
  await expect(conflictBox(b)).toContainText('Mine can’t be applied: not the current step.');
  const s = await b.state();
  expect(s.wconflicts).toHaveLength(1);
  expect(s.wconflicts[0]).toMatchObject({ run: 'r1', base: 1, srev: 2 });
  expect(s.wconflicts[0].mine.st.s1.o).toBe('done');
  // The conflict is this device's: it stays across a reload, and syncing doesn't change it.
  await b.page.reload();
  await open(b);
  await b.sync();
  await expect(conflictBox(b)).toHaveCount(1);
  // Keep the server's: what B did goes into the run's history, the conflict goes.
  await b.page.click('[data-wcact="keep"]');
  await expect(conflictBox(b)).toHaveCount(0);
  await settle(a, b);
  expect(srvRun(srv).rev).toBe(3);
  for (const d of [a, b]) {
    const r = await d.run('r1');
    expect(r.rev).toBe(3);
    expect(r.cur).toBe('s2');
    expect(r.log.map(l => l.k)).toEqual(['started', 'done', 'conflict']);
    expect(r.log[2].m).toBe('kept the server’s; not applied from this device: marked “Prepare” done');
  }
  await expect(wsync(b)).toHaveText('Synced, checked by the server');
  // Nothing left to send back and forth.
  const before = srv.writes;
  await settle(a, b);
  expect(srv.writes).toBe(before);
  noErrors(a, b);
});

test('two different changes from the same stale revision: the second applies on top once checked again', async ({
  browser,
}) => {
  const { srv, a, b } = await twoDevices(browser, [
    { id: 's1', type: 'verify', title: 'Check', checks: ['Right period', 'All rows'] },
    M('s2', 'Send'),
  ]);
  for (const d of [a, b]) {
    await open(d);
    await d.offline(true);
  }
  await a.page.click('[data-wfact="check"][data-i="0"]');
  await b.page.click('[data-wfact="check"][data-i="1"]');
  for (const d of [a, b]) {
    await d.offline(false);
    await d.sync();
  }
  await expect(conflictBox(b)).toContainText('This device: ticked “All rows”.');
  await expect(conflictBox(b)).toContainText('Server: Your turn at “Check”.');
  // Apply mine on top: B's tick, on A's version (A's tick kept).
  await b.page.click('[data-wcact="mine"]');
  await expect(conflictBox(b)).toHaveCount(0);
  await settle(a, b);
  for (const d of [a, b]) expect((await d.run('r1')).live.checks).toEqual([true, true]);
  expect(srvRun(srv).rev).toBe(3);
  // A pause on one and a step done on the other: the step done on a paused run isn't applied.
  for (const d of [a, b]) await d.offline(true);
  await a.page.click('[data-wfact="pause"]');
  await b.page.click('[data-wfact="done"][data-wstage="s1"]');
  for (const d of [a, b]) {
    await d.offline(false);
    await d.sync();
  }
  await expect(conflictBox(b)).toContainText('This device: marked “Check” done.');
  await expect(conflictBox(b)).toContainText('Server: Paused at “Check”.');
  await expect(conflictBox(b)).toContainText('Mine can’t be applied: the run is paused.');
  expect((await b.run('r1')).status).toBe('paused');
  noErrors(a, b);
});

test('offline on one device: several changes go as one, accepted on reconnecting; the completion says it is only here', async ({
  browser,
}) => {
  const { srv, a, b } = await twoDevices(browser, [M('s1', 'Prepare'), M('s2', 'Send')]);
  await open(a);
  await a.offline(true);
  await a.page.click('[data-wfact="done"][data-wstage="s1"]');
  await a.page.click('[data-wfact="done"][data-wstage="s2"]');
  await said(a, 'Completed on this device; not synced yet');
  await expect(wsync(a)).toHaveText('Saved on this device, not yet synced');
  expect(srvRun(srv).status).toBe('awaiting_user');
  const puts = srv.puts.length;
  await a.offline(false);
  await a.sync();
  await expect(wsync(a)).toHaveText('Synced, checked by the server');
  // One change: revision 1 to 2, holding both steps.
  expect(srvRun(srv)).toMatchObject({ rev: 2, status: 'succeeded' });
  expect(srv.puts.slice(puts).filter(p => p.p_key === 'wrun:r1')).toHaveLength(1);
  await settle(a, b);
  expect(await b.run('r1')).toMatchObject({ rev: 2, status: 'succeeded' });
  expect((await b.state()).wconflicts).toEqual([]);
  // Online, the completion is just completed.
  noErrors(a, b);
});

test('a cancel on one device while the other continues: refused, then applied on top when chosen', async ({
  browser,
}) => {
  const { srv, a, b } = await twoDevices(browser, [M('s1', 'Prepare'), M('s2', 'Send'), M('s3', 'File')]);
  for (const d of [a, b]) await open(d);
  await a.offline(true);
  await a.page.click('[data-wfact="cancel"]');
  await a.page.click('#sheetok');
  expect((await a.run('r1')).status).toBe('cancelled');
  await b.page.click('[data-wfact="done"][data-wstage="s1"]');
  await b.sync();
  await a.offline(false);
  await a.sync();
  // The server kept B's: A's run is running again here, its cancel waiting on a choice.
  expect((await a.run('r1')).status).toBe('awaiting_user');
  await expect(conflictBox(a)).toContainText('This device: cancelled it.');
  await expect(conflictBox(a)).toContainText('Server: Your turn at “Send” · “Prepare” done.');
  await a.page.click('[data-wcact="mine"]');
  await settle(a, b);
  for (const d of [a, b]) {
    const r = await d.run('r1');
    expect(r.status).toBe('cancelled');
    expect(r.st.s1.o).toBe('done'); // (B's step kept: the cancel came on top of it)
    expect(r.log.map(l => l.k)).toEqual(['started', 'done', 'cancelled', 'conflict']);
  }
  expect(srvRun(srv).rev).toBe(3);
  noErrors(a, b);
});

test('an automation retried on one device while the other records its success: shown, and nothing launched again', async ({
  browser,
}) => {
  const { srv, a, b } = await twoDevices(
    browser,
    [M('s1', 'Prepare'), { id: 's2', type: 'flow', title: 'Run SSRS', flow: 'f1' }, M('s3', 'Send')],
    {
      prep: "completeStage(r, 's1', { by: 'hand' });",
    },
  );
  const token = await a.page.evaluate(async () => (await sb.rpc('cockpit_new_exec_token')).data);
  await open(a);
  await a.page.click('a[data-flow="f1"][data-wstage="s2"]');
  await settle(a, b);
  const x1 = (await a.run('r1')).live.exec;
  expect((await b.run('r1')).live.exec).toBe(x1);
  // A, offline: says it failed, and tries again. B hears the automation's success.
  await a.offline(true);
  await a.page.click('[data-wfact="confirmflow"][data-ok="no"]');
  await a.page.click('[data-wfact="retry"]');
  await a.page.click('#sheetok');
  expect((await a.run('r1')).status).toBe('awaiting_user');
  await report(b, { token, flow: 'f1', execution: x1, status: 'succeeded', message: '12 rows' });
  await settle(b);
  expect(srvRun(srv)).toMatchObject({ cur: 's3', st: { s2: { o: 'done', exec: x1 } } });
  const execs = (await a.state()).execs.length,
    last = (await a.state()).flows[0].last;
  await a.offline(false);
  await a.sync();
  await open(a);
  await expect(conflictBox(a)).toContainText(
    'This device: “Run SSRS” failed: Failed (confirmed by hand), tried “Run SSRS” again.',
  );
  await expect(conflictBox(a)).toContainText('“Run SSRS” done');
  await expect(a.page.locator('[data-wcact="mine"]')).toHaveCount(0);
  await a.page.click('[data-wcact="keep"]');
  await settle(a, b);
  for (const d of [a, b]) expect(await d.run('r1')).toMatchObject({ cur: 's3', status: 'awaiting_user' });
  // Nothing was launched or recorded as launched while it was settled.
  expect((await a.state()).execs.length).toBe(execs);
  expect((await a.state()).flows[0].last).toBe(last);

  // The other way round: the retry reaches the server first; the success heard on the other
  // device is about the attempt the retry set aside. It isn't dropped in silence either.
  const t2 = await twoDevices(browser, [
    { id: 's2', type: 'flow', title: 'Run SSRS', flow: 'f1' },
    M('s3', 'Send'),
  ]);
  await open(t2.a);
  await t2.a.page.click('a[data-flow="f1"][data-wstage="s2"]');
  await settle(t2.a, t2.b);
  const y1 = (await t2.a.run('r1')).live.exec;
  await t2.b.offline(true);
  await t2.a.page.click('[data-wfact="confirmflow"][data-ok="no"]');
  await t2.a.page.click('[data-wfact="retry"]');
  await t2.a.page.click('#sheetok');
  await t2.a.sync();
  // (B folds the report while still on the version that waits for that attempt)
  await t2.b.page.evaluate(x => {
    foldExecEvent({
      id: 999,
      execution: x,
      flow: 'f1',
      status: 'succeeded',
      message: 'done',
      reported_at: new Date().toISOString(),
    });
    save();
  }, y1);
  expect((await t2.b.run('r1')).cur).toBe('s3');
  await t2.b.offline(false);
  await t2.b.sync();
  await open(t2.b);
  await expect(conflictBox(t2.b)).toContainText('This device: “Run SSRS” done by the automation.');
  expect(await t2.b.run('r1')).toMatchObject({ cur: 's2', status: 'awaiting_user', live: { tries: 1 } });
  noErrors(a, b, t2.a, t2.b);
});

test('automation reports delayed, sent twice or out of order complete a step once, and never a newer attempt', async ({
  browser,
}) => {
  const { srv, a, b } = await twoDevices(browser, [
    { id: 's1', type: 'flow', title: 'Run SSRS', flow: 'f1' },
    { id: 's2', type: 'flow', title: 'Run again', flow: 'f1' },
    M('s3', 'Send'),
  ]);
  const token = await a.page.evaluate(async () => (await sb.rpc('cockpit_new_exec_token')).data);
  await open(a);
  await a.page.click('a[data-flow="f1"][data-wstage="s1"]');
  await settle(a, b);
  const x1 = (await a.run('r1')).live.exec;
  // Running, then succeeded: the step is done once, on both devices (each folds the report;
  // the second device's identical move is settled without a conflict).
  await report(a, { token, flow: 'f1', execution: x1, status: 'running' });
  await report(a, { token, flow: 'f1', execution: x1, status: 'succeeded', message: 'ok' });
  await settle(a, b);
  for (const d of [a, b]) {
    const r = await d.run('r1');
    expect(r).toMatchObject({ cur: 's2', st: { s1: { o: 'done', exec: x1 } } });
    expect(r.log.filter(l => l.k === 'done')).toHaveLength(1);
    expect((await d.state()).wconflicts).toEqual([]);
  }
  const rev = srvRun(srv).rev;
  // The same success sent again, and a late "running": nothing moves.
  await report(a, { token, flow: 'f1', execution: x1, status: 'succeeded', message: 'ok' });
  await report(b, { token, flow: 'f1', execution: x1, status: 'running' });
  await settle(a, b);
  for (const d of [a, b]) expect((await d.run('r1')).cur).toBe('s2');
  expect(srvRun(srv).rev).toBe(rev);
  // The next step's attempt (x2) launched; a delayed failure of x1 doesn't touch it.
  await a.page.click('a[data-flow="f1"][data-wstage="s2"]');
  await settle(a, b);
  const x2 = (await a.run('r1')).live.exec;
  expect(x2).not.toBe(x1);
  await report(b, { token, flow: 'f1', execution: x1, status: 'failed', message: 'late' });
  await settle(a, b);
  for (const d of [a, b])
    expect(await d.run('r1')).toMatchObject({ cur: 's2', status: 'awaiting_automation' });
  // x2's success completes s2 only, once.
  await report(a, { token, flow: 'f1', execution: x2, status: 'succeeded' });
  await settle(a, b);
  for (const d of [a, b]) {
    const r = await d.run('r1');
    expect(r).toMatchObject({ cur: 's3', st: { s2: { o: 'done', exec: x2 } } });
    expect(r.log.filter(l => l.k === 'done')).toHaveLength(2);
  }
  // A launch request on its own is never a result: no report, no completion.
  expect((await a.state()).execs.filter(x => x.status === 'requested')).toHaveLength(0);
  noErrors(a, b);
});

test('the answer lost after the server took the change: sent again with the same op id, applied once', async ({
  browser,
}) => {
  const { srv, a, b } = await twoDevices(browser, [M('s1', 'Prepare'), M('s2', 'Send')]);
  await open(a);
  srv.dropAnswers = 1;
  await a.page.click('[data-wfact="done"][data-wstage="s1"]');
  await a.page.evaluate(() => clearTimeout(pushT)); // (the test syncs)
  // (and no sync of the device's own before the test's next: the failed one saves, which would
  // otherwise send it again 1.2s later, and under a loaded machine before the checks below)
  await a.page.evaluate(async () => {
    await sync();
    while (syncing || again) await new Promise(r => setTimeout(r, 20));
    clearTimeout(pushT);
  });
  // The server has it; this device doesn't know yet (the sync failed).
  expect(srvRun(srv)).toMatchObject({ rev: 2, cur: 's2' });
  await expect(a.page.locator('#syncBtn')).toHaveText('Sync error');
  await expect(wsync(a)).toHaveText('Not synced: the last sync failed');
  const writes = srv.writes,
    op = srv.puts[srv.puts.length - 1].p_op;
  await a.sync();
  const again = srv.puts[srv.puts.length - 1];
  expect(again.p_op).toBe(op); // (the same change, asked about again)
  expect(srv.writes).toBe(writes); // (not written twice)
  await expect(wsync(a)).toHaveText('Synced, checked by the server');
  expect(await a.run('r1')).toMatchObject({ rev: 2, cur: 's2' });
  expect(srvRun(srv).rev).toBe(2);
  expect(srvRun(srv).log.filter(l => l.k === 'done')).toHaveLength(1);
  // And across a reload in between: the op is kept with the change.
  srv.dropAnswers = 1;
  await a.page.click('[data-wfact="done"][data-wstage="s2"]');
  await a.page.evaluate(() => clearTimeout(pushT));
  await a.sync();
  await a.page.reload();
  await a.sync();
  expect(srv.ops.size).toBe(3); // (r1 made, s1, s2: each once)
  expect(srvRun(srv)).toMatchObject({ rev: 3, status: 'succeeded' });
  await settle(a, b);
  expect(await b.run('r1')).toMatchObject({ rev: 3, status: 'succeeded' });
  expect((await a.state()).wconflicts).toEqual([]);
  noErrors(b);
});

test('without the function on the server: the newer edit wins as before, and the health check says so once', async ({
  browser,
}) => {
  const { srv, a, b } = await twoDevices(browser, [M('s1', 'Prepare'), M('s2', 'Send')], {
    srvOpts: { wrunFn: false },
  });
  expect(srv.rows.get('wrun:r1').data.rev).toBeUndefined(); // (sent as before)
  for (const d of [a, b]) {
    await open(d);
    await d.offline(true);
  }
  await a.page.click('[data-wfact="done"][data-wstage="s1"]');
  await b.page.waitForTimeout(5);
  await b.page.click('[data-wfact="cancel"]');
  await b.page.click('#sheetok');
  for (const d of [a, b]) {
    await d.offline(false);
    await d.sync();
  }
  await settle(a, b);
  // B's was the newer edit: it wins everywhere, with no conflict.
  for (const d of [a, b]) {
    expect((await d.run('r1')).status).toBe('cancelled');
    expect((await d.state()).wconflicts).toEqual([]);
  }
  await expect(conflictBox(b)).toHaveCount(0);
  // Said in Settings > Health check, not in toasts.
  for (const d of [a, b])
    expect((await d.toasts()).filter(t => /check|install|function/i.test(t))).toEqual([]);
  await a.page.click('nav [data-v=account]');
  await a.page.click('[data-setgo="health"]');
  await a.page.click('#healthrun');
  const row = a.page.locator('.hrow2', { hasText: 'Process run checks' });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Not installed: the newer edit wins');
  await expect(row).toContainText('Run supabase/release-g-runs.sql');
  // Installed later: the next sync after it's asked again uses it.
  srv.wrunFn = true;
  await a.page.click('#healthrun');
  await expect(a.page.locator('.hrow2', { hasText: 'Process run checks' })).toContainText('On');
  noErrors(a, b);
});

test('backups keep runs with their revision; a restore is sent on top of the server’s revision', async ({
  browser,
}) => {
  const { srv, a } = await twoDevices(browser, [M('s1', 'Prepare'), M('s2', 'Send')]);
  await open(a);
  await a.page.click('[data-wfact="done"][data-wstage="s1"]');
  await a.sync();
  expect(srvRun(srv).rev).toBe(2);
  const backup = await a.page.evaluate(() => JSON.stringify(S));
  expect(JSON.parse(backup).wruns[0].rev).toBe(2);
  await a.page.click('[data-wfact="done"][data-wstage="s2"]');
  await a.sync();
  expect(srvRun(srv)).toMatchObject({ rev: 3, status: 'succeeded' });
  // Restore the backup (taken at revision 2): it replaces the run, as revision 4.
  const restore = async json => {
    await a.page.evaluate(j => {
      pending = JSON.parse(j);
      openSettings('backup');
    }, json);
    await a.page.click('#doRestore');
    await a.sync();
  };
  await restore(backup);
  expect(srvRun(srv)).toMatchObject({ rev: 4, cur: 's2', status: 'awaiting_user' });
  expect(await a.run('r1')).toMatchObject({ rev: 4, cur: 's2' });
  // A backup from before revisions: read as revision 0, restored the same way.
  const old = JSON.parse(backup);
  delete old.wruns[0].rev;
  old.wruns[0].cur = 's1';
  old.wruns[0].st = {};
  await restore(JSON.stringify(old));
  expect(srvRun(srv)).toMatchObject({ rev: 5, cur: 's1' });
  expect((await a.state()).wconflicts).toEqual([]);
  noErrors(a);
});

test('Acknowledge and Add to the Inbox drawn for one failure refuse a newer one; the Inbox item is made once', async ({
  browser,
}) => {
  const { a, b } = await twoDevices(browser, [M('s1', 'Prepare'), M('s2', 'Send')], {
    prep: "failStage(r, 's1', 'Missing file');",
  });
  for (const d of [a, b]) await open(d);
  const f1 = (await a.run('r1')).fid;
  expect(f1).toMatch(/^f/);
  await expect(a.page.locator('[data-wfact="ack"]')).toHaveAttribute('data-wocc', f1);
  // B retries and it fails again (failure 2); A's page still shows failure 1's controls.
  await b.page.click('[data-wfact="retry"]');
  await b.page.click('[data-wfact="fail"][data-wstage="s1"]');
  await b.page.fill('#sheetin', 'Wrong period');
  await b.page.click('#sheetok');
  await b.sync();
  await a.sync();
  expect(await a.run('r1')).toMatchObject({ occ: 2, err: 'Wrong period' });
  const f2 = (await a.run('r1')).fid;
  expect(f2).not.toBe(f1);
  // A tap on A's page as drawn for failure 1 (its data-wocc), arriving after the pull. (Played
  // as that tap: a background redraw could otherwise draw failure 2 before the click lands.)
  await a.page.evaluate(f => wfClick({ wrun: 'r1', wfact: 'ack', wocc: f }), f1);
  await said(a, 'That failure has changed');
  expect((await a.run('r1')).ack).toBeUndefined();
  await expect(a.page.locator('[data-wfact="ack"]')).toHaveAttribute('data-wocc', f2);
  // Add to the Inbox: failure 2's details, a link to the run, a stable id.
  await more(a);
  await a.page.click('[data-wfact="inbox"]');
  await said(a, 'Added to the Inbox');
  let s = await a.state();
  const item = s.inbox[0];
  expect(item.text).toBe('Process failed: Weekly report · Prepare');
  expect(item.node.notes).toContain('Error: Wrong period');
  expect(item.node.notes).toContain('(failure 2 of this run)');
  expect(item.node.links[0].url).toMatch(/#\/wrun\/r1$/);
  expect(s.wruns[0].ack).toBe(f2);
  expect(s.wruns[0].fails.map(f => [f.occ, f.fid, f.err])).toEqual([
    [1, f1, 'Missing file'],
    [2, f2, 'Wrong period'],
  ]);
  // B, before hearing of it, adds the same failure to the Inbox: one item, on both devices.
  await more(b);
  await b.page.click('[data-wfact="inbox"]');
  await settle(a, b);
  for (const d of [a, b]) {
    s = await d.state();
    expect(s.inbox.filter(i => i.id === item.id)).toHaveLength(1);
    expect(s.inbox).toHaveLength(1);
    expect(s.wconflicts).toEqual([]); // (the same acknowledgement on both: nothing to choose)
  }
  // Asked again on a stale page: no second item.
  await a.page.evaluate(f => wfFailAct(wrunById('r1'), 'inbox', f), f2);
  await said(a, 'Already in the Inbox');
  expect((await a.state()).inbox).toHaveLength(1);
  noErrors(a, b);
});

test('an automation failure’s Acknowledge and Add to the Inbox are bound to the failure report', async ({
  browser,
}) => {
  const { a } = await twoDevices(browser, [M('s1', 'Prepare')]);
  const token = await a.page.evaluate(async () => (await sb.rpc('cockpit_new_exec_token')).data);
  await a.page.evaluate(() => {
    const x = startExec('f1', '');
    save();
    return x.id;
  });
  await a.sync();
  const x = (await a.state()).execs[0].id;
  await report(a, { token, flow: 'f1', execution: x, status: 'failed', message: 'Login failed' });
  await a.sync();
  await a.page.evaluate(id => openExecDetail(id), x);
  const occ1 = await a.page.locator('[data-xack]').getAttribute('data-xocc');
  // Reported failing again while the sheet is open.
  await report(a, { token, flow: 'f1', execution: x, status: 'failed', message: 'Timeout' });
  await a.sync();
  // (the sheet's Acknowledge, as drawn for the first failure)
  await a.page.evaluate(([id, o]) => execClick({ xack: id, xocc: o }), [x, occ1]);
  await said(a, 'That failure has changed');
  expect((await a.state()).execs[0].ack).toBeUndefined();
  await a.page.evaluate(id => openExecDetail(id), x);
  expect(await a.page.locator('[data-xinbox]').getAttribute('data-xocc')).not.toBe(occ1);
  await a.page.click('[data-xinbox]');
  await a.page.evaluate(id => openExecDetail(id), x);
  await a.page.click('[data-xinbox]');
  await said(a, 'Already in the Inbox');
  const s = await a.state();
  expect(s.inbox).toHaveLength(1);
  expect(s.execs[0].ack).toBe(1);
  noErrors(a);
});

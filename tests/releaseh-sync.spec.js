// Release H, checkpoint 3: trustworthy synchronisation. One regression test (or more) per finding
// of the sync audit, each failing without its fix; the SQL side is in tests/db/run.sh. Runs with
// the fake Supabase of tests/fakesb.js (the same rules as supabase/release-g-runs.sql and
// supabase/release-h.sql).
const { test, expect } = require('@playwright/test');
const { server, device, settle, report } = require('./fakesb');
const { unfold } = require('./fixtures');

const URL1 = 'ms-powerautomate:/console/flow/run?environmentid=e1&workflowid=w1&source=Other';
const flows = [
  { id: 'f1', name: 'SSRS report', url: URL1, last: 0 },
  { id: 'f2', name: 'Other flow', url: 'ms-powerautomate:/console/flow/run?workflowid=w2', last: 0 },
];
const M = (id, title, extra = {}) => ({ id, type: 'manual', title, ...extra });
const FLOW = (id, title, flow = 'f1') => ({ id, type: 'flow', title, flow });
const day = n => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// A process and runs of it (`runs`: their ids, or `{ id, prepared }`), made on A and synced; then B
// signs in (unless `one`).
async function setup(
  browser,
  stages,
  { runs = ['r1'], srvOpts = {}, one = false, days = [], prep = '' } = {},
) {
  const srv = Object.assign(server(), srvOpts);
  const a = await device(browser, srv);
  await a.page.evaluate(
    ({ stages, flows, runs, days, prep }) => {
      S.track = true;
      S.flows = flows;
      S.workflows = [{ id: 'w1', name: 'Weekly report', ver: 1, days, monthDay: 0, stages }];
      S.wruns = runs.map(x => makeRun(S.workflows[0], typeof x === 'string' ? { id: x } : x));
      if (prep) new Function(prep)();
      norm(S);
      save();
    },
    { stages, flows, runs, days, prep },
  );
  await a.sync();
  if (one) return { srv, a };
  const b = await device(browser, srv);
  await settle(a, b);
  return { srv, a, b };
}
const open = (d, id = 'r1') => d.page.evaluate(id => openWorkflowRun(id), id);
const box = d => d.page.locator('#v-knowledge .wconf');
const wsync = d => d.page.locator('#v-knowledge .runprog .wsync');
const srvRun = (srv, id = 'r1') => srv.rows.get('wrun:' + id).data;
const noErrors = (...ds) => ds.forEach(d => expect(d.errors).toEqual([]));
const said = (d, text) =>
  expect.poll(async () => (await d.toasts()).filter(t => t.includes(text)).length).toBeGreaterThan(0);
// Every flow link's href at the moment it was tapped (after the app's own handler: what the
// browser would follow).
const watchLinks = d =>
  d.page.evaluate(() => {
    window.__hrefs = [];
    addEventListener('click', e => {
      const a = e.target.closest && e.target.closest('a[data-flow]');
      if (a) window.__hrefs.push(a.getAttribute('href'));
    });
  });
const hrefs = d => d.page.evaluate(() => window.__hrefs.slice());
const withId = (url, x) => url + '&inputArguments=' + encodeURIComponent(JSON.stringify({ ExecId: x }));

test('HIGH-1: a report naming no attempt, with two launches waiting, completes neither; the steps wait to be confirmed', async ({
  browser,
}) => {
  const { srv, a } = await setup(browser, [FLOW('s1', 'Run SSRS'), M('s2', 'Send')], {
    runs: ['r1', 'r2'],
    one: true,
  });
  const token = await a.page.evaluate(async () => (await sb.rpc('cockpit_new_exec_token')).data);
  // Two runs launch the same flow: one launch never ran (PAD asked to confirm, say), the other did.
  for (const id of ['r1', 'r2']) {
    await open(a, id);
    await a.page.click('a[data-flow="f1"][data-wstage="s1"]');
  }
  await a.sync();
  const x1 = (await a.run('r1')).live.exec,
    x2 = (await a.run('r2')).live.exec;
  expect(x1).not.toBe(x2);
  // The one that ran reports, naming no attempt: not paired (Release G took the oldest, r1's).
  const r = await report(a, { token, flow: 'f1', status: 'succeeded', message: 'for r2' });
  expect(r.data.execution).toBe('');
  await settle(a);
  for (const id of ['r1', 'r2']) {
    expect(await a.run(id)).toMatchObject({ cur: 's1', status: 'awaiting_automation' });
    await open(a, id);
    // (said on the step, with the way to confirm it by hand)
    await expect(a.page.locator('#v-knowledge .wstray')).toContainText('names no attempt');
    await expect(a.page.locator('[data-wfact="confirmflow"][data-ok="yes"]')).toHaveCount(1);
  }
  const s = await a.state();
  expect(s.execs.find(x => x.id === 'u' + r.data.event)).toMatchObject({ status: 'succeeded', unreq: 1 });
  expect(s.execs.filter(x => [x1, x2].includes(x.id)).map(x => x.status)).toEqual(['requested', 'requested']);
  // A report naming r2's attempt completes r2 only.
  await report(a, { token, flow: 'f1', status: 'succeeded', execution: x2 });
  await settle(a);
  expect(await a.run('r2')).toMatchObject({ cur: 's2', st: { s1: { o: 'done', exec: x2 } } });
  expect(await a.run('r1')).toMatchObject({ cur: 's1', status: 'awaiting_automation' });
  // With one launch left waiting, a report naming none is paired with it.
  const r3 = await report(a, { token, flow: 'f1', status: 'succeeded' });
  expect(r3.data.execution).toBe(x1);
  expect(srv.events.length).toBe(3);
  noErrors(a);
});

test('HIGH-2: a flow set to pass the attempt id gets it in its Run URL on every launch path; off, the URL is as saved', async ({
  browser,
}) => {
  const { srv, a, b } = await setup(browser, [FLOW('s1', 'Run SSRS'), FLOW('s2', 'Other', 'f2')]);
  const token = await a.page.evaluate(async () => (await sb.rpc('cockpit_new_exec_token')).data);
  // Off unless chosen: an older flow record reads (and hashes) the same.
  expect(srv.rows.get('flow:f1').data.passId).toBeUndefined();
  // Turned on where flows are edited (Knowledge > Processes > Manage automations), and synced.
  await a.page.click('nav [data-v=knowledge]');
  await a.page.evaluate(() => {
    kbView = 'proc';
    panels.kbflows = true;
    renderKnowledge();
  });
  await a.page.check('[data-flowpass="f1"]');
  await a.sync();
  expect(srv.rows.get('flow:f1').data.passId).toBe(true);
  expect(srv.rows.get('flow:f2').data.passId).toBeUndefined();
  await b.sync();
  expect((await b.state()).flows.find(f => f.id === 'f1').passId).toBe(true);
  await watchLinks(a);
  // The process run's Launch: the attempt made at the tap is the id the link carries.
  await open(a);
  await a.page.click('a[data-flow="f1"][data-wstage="s1"]');
  const x1 = (await a.run('r1')).live.exec;
  expect((await hrefs(a))[0]).toBe(withId(URL1, x1));
  // (sent at once, so the server knows the attempt before the flow reports)
  await expect.poll(() => !!srv.rows.get('exec:' + x1)).toBe(true);
  // The flow reports naming it (its input ExecId): paired by id, the step done.
  const rep = await report(a, { token, flow: 'f1', status: 'succeeded', execution: x1 });
  expect(rep.data.execution).toBe(x1);
  await settle(a);
  expect(await a.run('r1')).toMatchObject({ cur: 's2', st: { s1: { o: 'done', exec: x1 } } });
  // A flow not set to: its link is as saved.
  await open(a);
  await a.page.click('a[data-flow="f2"][data-wstage="s2"]');
  expect((await hrefs(a))[1]).toBe(flows[1].url);
  // Today's chips, the automations list, and an attempt's "Run again": each a new attempt's id.
  await a.page.click('nav [data-v=today]');
  await unfold(a.page, 'flowsd');
  await a.page.click('#v-today a[data-flow="f1"]');
  await a.page.click('nav [data-v=knowledge]');
  await a.page.evaluate(() => {
    kbView = 'proc';
    wfOpen = null;
    renderKnowledge();
  });
  await a.page.click('#v-knowledge .kbsec a[data-flow="f1"]');
  await a.page.evaluate(id => openExecDetail(id), x1);
  await a.page.click('#sheet a[data-flow="f1"]');
  const s = await a.state(),
    ids = s.execs
      .filter(x => x.flow === 'f1')
      .sort((p, q) => p.at - q.at)
      .map(x => x.id);
  expect(ids).toHaveLength(4);
  const h = await hrefs(a);
  expect(h.slice(2)).toEqual(ids.slice(1).map(x => withId(URL1, x)));
  // A report naming f1's attempt for another flow is never taken as that attempt (server, and
  // the app folding a report that was).
  const bad = await report(a, { token, flow: 'f2', status: 'failed', execution: ids[3] });
  expect(bad.data.execution).toBe('');
  const moved = await a.page.evaluate(x => {
    foldExecEvent({
      id: 9999,
      execution: x,
      flow: 'f2',
      status: 'failed',
      reported_at: new Date().toISOString(),
    });
    return S.execs.find(e => e.id === x).status;
  }, ids[3]);
  expect(moved).toBe('requested');
  expect((await a.state()).execs.find(x => x.id === 'u9999')).toMatchObject({ flow: 'f2', status: 'failed' });
  noErrors(a, b);
});

test('MED-3: the day’s tidy-up on one device doesn’t beat a start made offline on another; nor tidy a run with changes here', async ({
  browser,
}) => {
  const y = 'w1-' + day(-1);
  const { srv, a, b } = await setup(browser, [M('s1', 'Prepare'), M('s2', 'Send')], {
    runs: [{ id: y, prepared: true }],
    days: [0, 1, 2, 3, 4, 5, 6],
  });
  // B, offline, starts yesterday's run and does its first step.
  await b.offline(true);
  await open(b, y);
  await b.page.click('[data-wfact="begin"]');
  await b.page.click('[data-wfact="done"][data-wstage="s1"]');
  // A, online, runs the day's reset: yesterday's run never started there, so it gives way.
  await a.page.evaluate(() => {
    rolloverWorkflows(today());
    save();
  });
  await a.sync();
  expect(srvRun(srv, y)).toMatchObject({ status: 'cancelled', err: 'not started that day' });
  await b.offline(false);
  await b.sync();
  await open(b, y);
  await expect(box(b)).toContainText('Server: Cancelled by the day’s tidy-up');
  // B's work can go on top (Release G offered only Keep: "the run is over").
  await b.page.click('[data-wcact="mine"]');
  await settle(a, b);
  for (const d of [a, b])
    expect(await d.run(y)).toMatchObject({ status: 'awaiting_user', cur: 's2', st: { s1: { o: 'done' } } });
  expect((await b.state()).wconflicts).toEqual([]);

  // And a device with a change of its own to a ready run, not yet synced, doesn't tidy it away.
  const t2 = await setup(browser, [M('s1', 'Prepare')], {
    runs: [{ id: y, prepared: true }],
    days: [0, 1, 2, 3, 4, 5, 6],
    one: true,
  });
  await t2.a.offline(true);
  const st = await t2.a.page.evaluate(id => {
    noteRun(wrunById(id), 'note', 'call Sam first');
    rolloverWorkflows(today());
    save();
    return wrunById(id).status;
  }, y);
  expect(st).toBe('ready');
  noErrors(a, b, t2.a);
});

test('MED-4: a run deleted on another device while it changed here is a conflict, not dropped in silence', async ({
  browser,
}) => {
  const { srv, a, b } = await setup(browser, [M('s1', 'Prepare'), M('s2', 'Send')]);
  await b.offline(true);
  await open(b);
  await b.page.click('[data-wfact="done"][data-wstage="s1"]');
  // A deletes the run (as a backup restored without it would).
  await a.page.evaluate(() => {
    S.wruns = S.wruns.filter(r => r.id !== 'r1');
    save();
  });
  await a.sync();
  expect(srv.rows.get('wrun:r1').deleted).toBe(true);
  await b.offline(false);
  await b.sync();
  // B keeps its run (with its step done), unsent, and asks.
  expect(await b.run('r1')).toMatchObject({ cur: 's2', st: { s1: { o: 'done' } } });
  await expect(box(b)).toContainText('Server: Deleted on another device.');
  await expect(wsync(b)).toHaveText('Conflict: needs your choice');
  // Across a reload and further syncs, it stays (and isn't sent).
  const writes = srv.writes;
  await b.page.reload();
  await settle(b);
  await open(b);
  await expect(box(b)).toHaveCount(1);
  expect(srv.writes).toBe(writes);
  expect(srv.rows.get('wrun:r1').deleted).toBe(true);
  // Apply mine: back on the server, on top of the deletion, and on A.
  await b.page.click('[data-wcact="mine"]');
  await settle(b, a);
  expect(srvRun(srv)).toMatchObject({ rev: 3, cur: 's2' });
  expect(srv.rows.get('wrun:r1').deleted).toBe(false);
  expect(await a.run('r1')).toMatchObject({ cur: 's2', st: { s1: { o: 'done' } } });

  // The other way out: Keep the server's deletes it here too, and sends nothing.
  await b.offline(true);
  await b.page.click('[data-wfact="done"][data-wstage="s2"]');
  await a.page.evaluate(() => {
    S.wruns = S.wruns.filter(r => r.id !== 'r1');
    save();
  });
  await a.sync();
  await b.offline(false);
  await b.sync();
  await open(b);
  await b.page.click('[data-wcact="keep"]');
  await said(b, 'Deleted, as on the other device');
  const w2 = srv.writes;
  await settle(a, b);
  expect(await b.run('r1')).toBeNull();
  expect((await b.state()).wconflicts).toEqual([]);
  expect(srv.rows.get('wrun:r1').deleted).toBe(true);
  expect(srv.writes).toBe(w2);
  noErrors(a, b);
});

test('MED-4: a finished run tidied away on another device still settles on its own', async ({ browser }) => {
  const { srv, a, b } = await setup(browser, [M('s1', 'Prepare')], {
    prep: "completeStage(S.wruns[0], 's1', { by: 'hand' });",
  });
  expect(srvRun(srv).status).toBe('succeeded');
  await b.offline(true);
  await b.page.evaluate(() => {
    noteRun(wrunById('r1'), 'note', 'filed');
    save();
  });
  await a.page.evaluate(() => {
    S.wruns = [];
    save();
  });
  await a.sync();
  await b.offline(false);
  await b.sync();
  expect((await b.state()).wconflicts).toEqual([]);
  expect(await b.run('r1')).toBeNull();
  noErrors(a, b);
});

test('MED-5: a run’s page says whether its sync is checked by the server, and warns at a Launch when it isn’t', async ({
  browser,
}) => {
  // Without the function: the newer edit wins, and the page says so.
  const t1 = await setup(browser, [FLOW('s1', 'Run SSRS'), M('s2', 'Send')], {
    srvOpts: { wrunFn: false },
    one: true,
  });
  await open(t1.a);
  await expect(wsync(t1.a)).toHaveText('Synced, but the server’s check isn’t installed: the newer edit wins');
  await expect(t1.a.page.locator('.wunprot')).toContainText('Not protected');
  // (a line, not a block: Launch still works offline)
  await t1.a.offline(true);
  await t1.a.page.click('a[data-flow="f1"][data-wstage="s1"]');
  await expect(wsync(t1.a)).toHaveText('Saved on this device, not yet synced');
  expect((await t1.a.run('r1')).live.exec).toBeTruthy();
  // A Try again on a failed run warns too.
  await t1.a.page.evaluate(() => {
    failStage(wrunById('r1'), 's1', 'Timeout');
    save();
    renderKnowledge();
  });
  await expect(t1.a.page.locator('[data-wfact="retry"]')).toHaveCount(1);
  await expect(t1.a.page.locator('.wunprot')).toHaveCount(1);
  await t1.a.offline(false);
  // The migration installed meanwhile (the cache still says missing): the next change, turned
  // away by the guard, makes the app ask again, and it goes through the function. No conflict.
  t1.srv.wrunFn = true;
  await t1.a.page.click('[data-wfact="retry"]');
  await t1.a.page.click('#sheetok');
  await t1.a.sync();
  await t1.a.sync();
  expect(t1.srv.refused).toContain('wrun:r1');
  expect((await t1.a.state()).wconflicts).toEqual([]);
  expect(srvRun(t1.srv)).toMatchObject({ status: 'awaiting_user', live: { tries: 1 } });
  expect(srvRun(t1.srv).rev).toBeGreaterThan(0); // (through the function: it has a revision)
  await expect(wsync(t1.a)).toHaveText('Synced, checked by the server');
  await expect(t1.a.page.locator('.wunprot')).toHaveCount(0);

  // The health check tells a partial install, with what to do.
  const t2 = await setup(browser, [M('s1', 'Prepare')], {
    srvOpts: { wrunFn: false, guard: true },
    one: true,
  });
  const health = async (d, text) => {
    await d.page.click('nav [data-v=account]');
    await d.page.click('[data-setgo="health"]');
    await d.page.click('#healthrun');
    const row = d.page.locator('.hrow2', { hasText: 'Process run checks' });
    await expect(row).toContainText(text);
    return row;
  };
  let row = await health(t2.a, 'Partly installed: the guard is there but not the function');
  await expect(row).toContainText('Run supabase/release-g-runs.sql, then supabase/release-h.sql');
  t2.srv.wrunFn = true;
  t2.srv.guard = false;
  await t2.a.page.click('#healthrun');
  row = t2.a.page.locator('.hrow2', { hasText: 'Process run checks' });
  await expect(row).toContainText('Partly installed: the function is there but not the guard');
  t2.srv.guard = true;
  await t2.a.page.click('#healthrun');
  await expect(row).toContainText('On: run changes are checked by the server');
  // Without release-h.sql's probe: the Release G check, said as such.
  t2.srv.checksFn = false;
  await t2.a.page.click('#healthrun');
  await expect(row).toContainText('On (run supabase/release-h.sql to check the guard too)');
  noErrors(t1.a, t2.a);
});

test('MED-6: a refused change’s set-aside of an attempt is undone where the server’s run still waits for it', async ({
  browser,
}) => {
  const { srv, a, b } = await setup(browser, [FLOW('s1', 'Run SSRS'), M('s2', 'Send')]);
  await open(a);
  await a.page.click('a[data-flow="f1"][data-wstage="s1"]');
  await settle(a, b);
  const x1 = (await a.run('r1')).live.exec;
  // A, offline, tries again (setting x1 aside); B pauses the run meanwhile.
  await a.offline(true);
  await a.page.evaluate(() => {
    retryStage(wrunById('r1'), 's1');
    save();
  });
  expect((await a.state()).execs.find(x => x.id === x1)).toMatchObject({ aside: 1, ack: 1 });
  await open(b);
  await b.page.click('[data-wfact="pause"]');
  await b.sync();
  await a.offline(false);
  await a.sync();
  await settle(a, b);
  // Refused: the server's run (paused) still waits for x1, and x1's own record says so again.
  expect(srvRun(srv).live.exec).toBe(x1);
  expect((await a.state()).wconflicts).toHaveLength(1);
  for (const d of [a, b]) {
    const x = (await d.state()).execs.find(e => e.id === x1);
    expect(x.aside).toBeUndefined();
    expect(x.ack).toBeUndefined();
  }
  expect(srv.rows.get('exec:' + x1).data.aside).toBeUndefined();
  noErrors(a, b);
});

test('MED-7: a failure reported for an attempt the server has confirmed done by hand is a conflict, not settled', async ({
  browser,
}) => {
  const { a } = await setup(browser, [FLOW('s1', 'Run SSRS'), M('s2', 'Send')], { one: true });
  const got = await a.page.evaluate(() => {
    const r = wrunById('r1'),
      mine = JSON.parse(JSON.stringify(r)),
      theirs = JSON.parse(JSON.stringify(r));
    theirs.st.s1 = { o: 'done', at: 1, exec: 'x1', note: 'Result confirmed by hand' };
    theirs.cur = 's2';
    const fail = [{ a: 'fail', sid: 's1', x: 'x1', eng: 1, q: 1 }];
    const settles = t => conflictSettles(mine, t, 1, fail);
    const failed = JSON.parse(JSON.stringify(theirs));
    failed.st.s1 = { o: 'failed', at: 1, exec: 'x1' };
    return { done: settles(theirs), failed: settles(failed) };
  });
  // (the same failure there: settles; the step confirmed done there: yours to choose)
  expect(got).toEqual({ done: false, failed: true });
  noErrors(a);
});

test('LOW: an answer lost, then asked again after its op id was forgotten, is accepted, not a conflict', async ({
  browser,
}) => {
  const { srv, a } = await setup(browser, [M('s1', 'Prepare'), M('s2', 'Send')], { one: true });
  await open(a);
  srv.dropAnswers = 1;
  await a.page.click('[data-wfact="done"][data-wstage="s1"]');
  await a.page.evaluate(() => clearTimeout(pushT));
  await a.sync();
  expect(srvRun(srv).rev).toBe(2);
  // (30 days on: the server no longer remembers the op)
  srv.ops.clear();
  await a.sync();
  expect((await a.state()).wconflicts).toEqual([]);
  await expect(wsync(a)).toHaveText('Synced, checked by the server');
  expect(await a.run('r1')).toMatchObject({ rev: 2, cur: 's2' });
  expect(srvRun(srv).log.filter(l => l.k === 'done')).toHaveLength(1);
  noErrors(a);
});

// Checkpoint 5's sync review: confirmed findings, each failing without its fix.
const MM = (id, title) => ({ id, type: 'manual', title });
async function setupGone(browser) {
  const srv = server();
  const a = await device(browser, srv);
  await a.page.evaluate(
    stages => {
      S.track = true;
      S.workflows = [{ id: 'w1', name: 'Weekly report', ver: 1, days: [], monthDay: 0, stages }];
      S.wruns = [makeRun(S.workflows[0], { id: 'r1' })];
      norm(S);
      save();
    },
    [MM('s1', 'Prepare'), MM('s2', 'Send'), MM('s3', 'File')],
  );
  await a.sync();
  const b = await device(browser, srv);
  await settle(a, b);
  return { srv, a, b };
}
const openRun = (d, id = 'r1') => d.page.evaluate(id => openWorkflowRun(id), id);
async function restoreFrom(d, json) {
  await d.page.evaluate(j => {
    pending = JSON.parse(j);
    go('account');
    renderAccount();
  }, json);
  await d.page.click('#doRestore');
}

test('review 5: a run deleted there, then restored there: Keep the server’s here takes it back, rather than staying without it', async ({
  browser,
}) => {
  const { srv, a, b } = await setupGone(browser);
  // A starts the run and syncs, B takes it.
  await openRun(a);
  await a.page.click('[data-wfact="done"][data-wstage="s1"]');
  await settle(a, b);
  const backup = await a.page.evaluate(() => JSON.stringify(S));
  // B offline: does s2.
  await b.offline(true);
  await openRun(b);
  await b.page.click('[data-wfact="done"][data-wstage="s2"]');
  // A deletes the run.
  await a.page.evaluate(() => {
    S.wruns = S.wruns.filter(r => r.id !== 'r1');
    save();
  });
  await a.sync();
  expect(srv.rows.get('wrun:r1').deleted).toBe(true);
  await b.offline(false);
  await b.sync();
  expect((await b.state()).wconflicts.length).toBe(1);
  // A restores a backup holding the run (from before the deletion).
  await restoreFrom(a, backup);
  await settle(a);
  expect(srv.rows.get('wrun:r1').deleted).toBe(false);
  await settle(b);
  // the account's other writes meanwhile (a busy day on another device: 300 rows)
  for (let i = 0; i < 300; i++)
    srv.rows.set('zz:' + i, {
      key: 'zz:' + i,
      kind: 'zz',
      data: {},
      deleted: false,
      edited_at: Date.now(),
      seq: ++srv.seq,
    });
  await settle(b);
  await openRun(b);
  await b.page.click('[data-wcact="keep"]');
  await settle(a, b);
  const bRun = await b.run('r1'),
    aRun = await a.run('r1');
  await b.page.reload();
  await settle(b);
  expect(!!(await b.run('r1'))).toBe(!srv.rows.get('wrun:r1').deleted);
});

test('review 5: a task page field with the keyboard, not typed in, shows an edit synced from elsewhere; the next key press keeps it', async ({
  browser,
}) => {
  const srv = server();
  const a = await device(browser, srv);
  await a.page.evaluate(() => {
    S.quests.push({
      id: 'q1',
      text: 'Quarterly report',
      children: [{ id: 'c1', text: 'Step', children: [], done: false }],
      done: false,
      notes: 'old notes',
    });
    norm(S);
    save();
    renderAll();
  });
  await a.sync();
  const b = await device(browser, srv);
  await settle(a, b);
  // A opens the task's page and puts the keyboard in its Notes (not typing yet).
  await a.page.evaluate(() => openPath(['q1']));
  await a.page.evaluate(() => {
    const t = $('#fnotes');
    let d = t.closest('details');
    while (d) {
      d.open = true;
      d = d.parentElement.closest('details');
    }
  });
  await a.page.click('#fnotes');
  await expect(a.page.locator('#fnotes')).toHaveValue('old notes');
  // B edits the notes; A hears of it (a background redraw).
  await b.page.evaluate(() => {
    find('q1').n.notes = 'new notes from the desktop';
    save();
  });
  await b.sync();
  await a.sync();
  await a.page.waitForTimeout(200);
  // A types one letter at the end.
  await a.page.keyboard.press('End');
  await a.page.keyboard.type('!');
  await settle(a, b);
  expect((await b.state()).quests.find(q => q.id === 'q1').notes).toContain('new notes from the desktop');
});

// Release B: the three journeys the features are for, end to end.
const { test, expect, unfold } = require('./fixtures');

test('Workflow A: recurring report: task → procedure → flow launched by hand → verified result → back to the task, still open', async ({
  app,
  page,
}) => {
  await page.clock.install({ time: new Date(2026, 10, 5, 9) });
  await app.open();
  await page.clock.pauseAt(new Date(2026, 10, 5, 9, 0, 30));
  await page.evaluate(() => {
    S.kbcats = [{ id: 'c1', name: 'Finance', parent: '' }];
    S.kb = [
      {
        id: 'a1',
        cat: 'c1',
        title: 'Weekly report procedure',
        body: 'Every Monday.',
        edited: 1,
        imgs: [],
        steps: [
          { id: 'p1', title: 'Pull the extract' },
          { id: 'p2', title: 'Run the report automation', flow: 'f1' },
          { id: 'p3', title: 'Check the totals', verify: true },
        ],
      },
    ];
    S.flows = [{ id: 'f1', name: 'Weekly report', url: 'ms-powerautomate:/console/flow/run?x=1', last: 0 }];
    S.track = true;
    S.quests = [
      fix({
        id: 'q1',
        text: 'Weekly reporting',
        children: [fix({ id: 's1', text: 'Send to Pat' })],
        links: [
          { id: 'l1', kind: 'kb', ref: 'a1' },
          { id: 'l2', kind: 'flow', ref: 'f1' },
        ],
      }),
    ];
    setRepeat(S.quests[0], t => (t.days = [1]));
    save();
    renderAll();
  });
  // 1-3. The task links its procedure and flow; open the procedure from the task.
  await app.openQuest('Weekly reporting');
  await expect(page.locator('#resd .resrow')).toHaveCount(2);
  await page.click('#resd [data-runstart="a1"]');
  await expect(page.locator('#v-knowledge .kbtrail')).toContainText('For: Weekly reporting');
  // 4. The preparation step.
  await page.click('#v-knowledge [data-rundone]');
  await expect(page.locator('#v-knowledge .pstep h3')).toHaveText('Run the report automation');
  // 5-6. The flow is launched by a tap, and only by a tap: an execution, requested, for this task.
  let s = await app.state();
  expect(s.execs).toHaveLength(0);
  await page.click('#v-knowledge .pstep a[data-flow="f1"]');
  await page.clock.runFor(10);
  s = await app.state();
  expect(s.execs).toHaveLength(1);
  expect(s.execs[0]).toMatchObject({ flow: 'f1', q: 'q1', status: 'requested' });
  expect(s.runs[0].done).toEqual(['p1']); // (tapping Run ticked nothing)
  await expect(page.locator('#v-knowledge .pstep .xline')).toContainText('Launched, no word yet');
  // 7-8. The flow reports back (as the server would hand it on): the step shows the verified result.
  const x = s.execs[0].id;
  await page.evaluate(x => {
    foldExecEvent({
      id: 1,
      execution: x,
      flow: 'f1',
      status: 'running',
      message: '',
      run_ref: '',
      reported_at: new Date(2026, 10, 5, 9, 1).toISOString(),
    });
    foldExecEvent({
      id: 2,
      execution: x,
      flow: 'f1',
      status: 'succeeded',
      message: '3 files sent',
      run_ref: '',
      reported_at: new Date(2026, 10, 5, 9, 4).toISOString(),
    });
    save();
    inBackground(renderAll);
  }, x);
  await expect(page.locator('#v-knowledge .pstep .xline')).toContainText('Succeeded');
  await expect(page.locator('#v-knowledge .pstep .xline')).toContainText('3 files sent');
  await page.click('#v-knowledge [data-rundone]');
  // 9. The manual check needs an explicit confirmation.
  await expect(page.locator('#v-knowledge .pstep .pverify')).toBeVisible();
  await page.click('#v-knowledge [data-rundone]');
  await page.click('[data-runfinish]');
  // 10. Back to the quest: the procedure done, the flow verified, the task still yours to finish.
  await page.click('#v-knowledge .pstep.done [data-open="q1"]');
  await expect(page.locator('#v-today h1')).toHaveText('Weekly reporting');
  await expect(page.locator('#resd .procline')).toContainText('Done Today');
  await expect(page.locator('#resd .xmini')).toContainText('Succeeded');
  s = await app.state();
  expect(s.quests[0].done).toBe(false);
  expect(s.quests[0].children[0].done).toBe(false);
  // Next week's copy: the same procedure and flow, a fresh run, no execution carried over.
  await page.evaluate(() => {
    S.quests = [];
    S.day = '2026-11-08';
    rollover();
    renderAll();
  });
  await page.clock.setSystemTime(new Date(2026, 10, 9, 9));
  await page.evaluate(() => {
    S.day = '2026-11-08';
    rollover();
    renderAll();
  });
  s = await app.state();
  const fresh = s.quests.find(q => q.text === 'Weekly reporting');
  expect(fresh.links.map(l => l.kind)).toEqual(['kb', 'flow']);
  await page.evaluate(() => openPath([]));
  await app.openQuest('Weekly reporting');
  await expect(page.locator('#resd .procline')).toContainText('Not started');
  await expect(page.locator('#resd [data-runstart]')).toHaveText('Start');
});

test('Workflow B: chasing an approval: waiting step → chase date → follow-up → reply → resolved, task actionable', async ({
  app,
  page,
}) => {
  await page.clock.install({ time: new Date(2026, 10, 2, 9) }); // Monday 2 Nov
  await app.open();
  await page.clock.pauseAt(new Date(2026, 10, 2, 9, 0, 30));
  await app.addQuest('Q3 report');
  await app.addQuest('Other work');
  await app.openQuest('Q3 report');
  // 1-2. A waiting step with the chase date and the expected reply.
  await page.click('#waitd summary');
  await page.fill('#wwho', 'Sarah');
  await page.fill('#wnote', 'Budget approval');
  await page.fill('#wdue', '2026-11-04');
  await page.fill('#wexp', '2026-11-06');
  await page.click('[data-waitsave]');
  let s = await app.state();
  const step = () => app.state().then(s => s.quests.find(q => q.text === 'Q3 report').children[0]);
  expect(await step()).toMatchObject({
    text: 'Budget approval',
    wait: { who: 'Sarah', due: '2026-11-04', expect: '2026-11-06' },
  });
  expect(s.follows.map(f => f.k)).toEqual(['start']);
  // The task is blocked: Next up moves on; Today says 0 to chase yet.
  await page.click('[data-crumb="-1"]');
  await expect(page.locator('#hnow')).toContainText('Other work');
  await expect(page.locator('#v-today .attn')).toContainText('Nothing needs attention');
  // 3-4. The chase date arrives: Today's chip, the Centre's "To chase", the 9am notice.
  await page.clock.setSystemTime(new Date(2026, 10, 4, 9));
  await page.reload();
  await expect(page.locator('#v-today .attn [data-wgo]')).toContainText('Chase Sarah today');
  await unfold(page, 'attd');
  await page.click('#v-today .attn [data-wgo]');
  await expect(page.locator('#v-waiting .wgroup').first()).toContainText('To chase');
  expect(
    await page.evaluate(() =>
      wantedNotices(new Date(2026, 10, 4, 8).getTime()).some(
        n => n.key === 'chase:' + S.quests[0].children[0].id + ':2026-11-04',
      ),
    ),
  ).toBe(true);
  // 5-7. A follow-up, with the next chase date: history kept, the item out of "To chase".
  await page.click('#v-waiting [data-wact]');
  await page.click('#sheet [data-chase]');
  await page.fill('#funote', 'Emailed Sarah, she will confirm by Friday');
  await page.fill('#fudue', '2026-11-09');
  await page.click('#sheetok');
  s = await app.state();
  expect((await step()).wait).toMatchObject({ due: '2026-11-09', last: '2026-11-04' });
  expect(s.follows.map(f => f.k)).toEqual(['start', 'chase']);
  await expect(page.locator('#v-waiting .wgroup').first()).toContainText('Reply promised'); // (by Friday; chased recently comes after)
  expect(
    await page.evaluate(() =>
      wantedNotices(new Date(2026, 10, 4, 10).getTime())
        .map(n => n.key)
        .filter(k => k.startsWith('chase:')),
    ),
  ).toEqual(['chase:' + (await step()).id + ':2026-11-09']);
  // 8-10. The reply arrives: resolved from the Centre; the task's step is back on the list, and
  // the task is Next up again; the history says what happened.
  await page.click('#v-waiting [data-waitclear]');
  s = await app.state();
  expect((await step()).wait).toBeUndefined();
  expect(s.follows.map(f => f.k)).toEqual(['start', 'chase', 'resolve']);
  await expect(page.locator('#v-waiting .empty')).toContainText('Nothing to chase');
  await app.go('today');
  await expect(page.locator('#hnow')).toContainText('Budget approval');
  await app.openQuest('Q3 report');
  await page.click('#v-today .open >> text="Budget approval"');
  await page.evaluate(() => (document.querySelector('#waitd').open = true));
  await expect(page.locator('#waitd .flist li')).toHaveText([
    /Resolved/,
    /Followed up: Emailed Sarah/,
    /Asked: Budget approval/,
  ]);
});

test('Workflow C: an NFC card opens Today: top 3 → task workspace → resume deliberately, nothing run by the link', async ({
  app,
  page,
}) => {
  await app.open();
  await page.evaluate(() => {
    S.flows = [{ id: 'f1', name: 'Morning flow', url: 'ms-powerautomate:/console/flow/run?x=1', last: 0 }];
    S.track = true;
    S.quests = [
      fix({
        id: 'q1',
        text: 'Weekly reporting',
        children: [fix({ id: 's1', text: 'Reconcile' })],
        links: [{ id: 'l2', kind: 'flow', ref: 'f1' }],
        resume: { note: 'Check the supplier credits', at: Date.now(), step: 's1' },
      }),
      fix({ id: 'q2', text: 'Call Sam' }),
    ];
    S.top3 = { day: today(), ids: ['q1', 'q2'] };
    save();
    renderAll();
  });
  await page.evaluate(() => storeDone());
  // 1-3. The card's automation opens the start-of-work link; the app opens on Today.
  await page.goto('about:blank');
  await page.goto('/#/today');
  await page.waitForFunction(() => window.appReady === true);
  // 4. The top 3 is there; nothing was launched, started or changed by opening the link.
  await expect(page.locator('#v-today .top3 .t3row')).toHaveCount(2);
  let s = await app.state();
  expect(s.execs).toHaveLength(0);
  expect(s.timer).toBeNull();
  expect(s.flows[0].last).toBe(0);
  // 5-6. The task opens with its resources and saved place.
  await page.click('.t3row[data-t3="q1"] .open');
  await expect(page.locator('#v-today h1')).toHaveText('Weekly reporting');
  await expect(page.locator('#placecard')).toContainText('Check the supplier credits');
  await expect(page.locator('#resd .resrow')).toContainText('Morning flow');
  // 7. Resuming is a deliberate tap, into single-task mode, with the note; the timer starts only on Start.
  await page.click('.qfoot [data-resume]');
  await expect(page.locator('#v-zen .zt')).toHaveText('Reconcile');
  await expect(page.locator('#v-zen .zplace')).toContainText('supplier credits');
  expect((await app.state()).timer).toBeNull();
  await page.click('[data-zstart]');
  s = await app.state();
  expect(s.timer.q).toBe('s1');
  // The "Continue" shortcut, too, goes straight to that task.
  await page.click('#v-zen [data-pause]');
  await page.keyboard.press('Escape');
  await page.evaluate(() => storeDone());
  await page.goto('about:blank');
  await page.goto('/#/continue');
  await page.waitForFunction(() => window.appReady === true);
  await expect(page.locator('#v-today h1')).toHaveText('Weekly reporting');
  expect((await app.state()).execs).toHaveLength(0);
});

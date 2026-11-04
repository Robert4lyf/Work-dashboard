// Release E: scheduled work and waiting on Today, and one rule for what can be acted on now.
const { test, expect } = require('./fixtures');
const { eDay } = require('./releaseedata');

// 10:00 local on a weekday (the page's clock), the Release E day loaded.
async function day(app, page, at = new Date(2026, 10, 4, 10, 0)) {
  await page.clock.install({ time: at });
  await app.open();
  await app.setState(eDay);
  await page.reload();
}
const sched = page => page.locator('#v-today .schedrow');
const waitRows = page => page.locator('#v-today .wrow');
const listNames = page => page.$$eval('#v-today .list .row .open > span', x => x.map(e => e.textContent));

test('1–2: a 14:00 meeting is under Scheduled, never the next task; after 14:00 it waits for you to record it', async ({
  app,
  page,
}) => {
  await day(app, page);
  await expect(page.locator('#schedhead')).toHaveText('Scheduled 3');
  await expect(sched(page).locator('.stime')).toHaveText(['10:30', '14:00', 'Any time']);
  await expect(sched(page).nth(0)).toContainText('Later today');
  await expect(sched(page).nth(1)).toContainText('Later today');
  await expect(sched(page).nth(2)).toContainText('Today');
  // Not in Today's tasks, not recommended, not in the Focus picker, not offered for Top 3.
  expect(await listNames(page)).not.toContain('Supplier review call');
  const rec = await page.evaluate(() => recommend().q.text);
  expect(['Team meeting', 'Supplier review call', 'First-aid training']).not.toContain(rec);
  await page.evaluate(() => go('focus'));
  expect(await page.$$eval('#fq option', o => o.map(x => x.textContent).join('|'))).not.toContain(
    'Supplier review call',
  );
  await page.evaluate(() => go('today'));
  await page.click('[data-top3pick]');
  await expect(page.locator('#sheet [data-t3tog="m2"]')).toHaveCount(0);
  await expect(page.locator('#sheet .t3held')).toContainText('Supplier review call (scheduled)');
  await page.keyboard.press('Escape');
  // Its row's actions: done, reschedule, back to ordinary work; no Focus.
  await page.click('#v-today .schedrow[data-qid="m2"] .qmore');
  await expect(page.locator('#sheet .qact')).toHaveText([
    'Open',
    /^Mark done/,
    /^Reschedule/,
    'Unschedule',
    /^Delete/,
  ]);
  await page.keyboard.press('Escape');
  // 14:05: still there, unfinished, asking for the outcome. Nothing completes it on its own.
  await page.clock.setFixedTime(new Date(2026, 10, 4, 14, 5));
  await page.evaluate(() => renderAll());
  await expect(sched(page).nth(0)).toContainText('Time passed');
  await expect(sched(page).nth(1)).toContainText('Time passed');
  expect((await app.state()).quests.find(q => q.id === 'm2').done).toBe(false);
  await page.click('#v-today .schedrow[data-qid="m2"] [data-toggle]');
  const s = await app.state();
  expect(s.quests.find(q => q.id === 'm2').done).toBe(true);
  expect(s.quests.find(q => q.id === 'm2').scheduled).toEqual({ date: '2026-11-04', time: '14:00' });
  await expect(sched(page)).toHaveCount(2);
  expect(app.errors).toEqual([]);
});

test('3–4: scheduled for tomorrow from the task’s actions: on Upcoming with its time, under Scheduled the next morning; rescheduled, then done', async ({
  app,
  page,
}) => {
  await day(app, page);
  await page.click('#v-today .row[data-qid="q8"] .qmore'); // Office move
  await page.click('#sheet [data-schedset="q8"]');
  await expect(page.locator('#scheddate')).toHaveValue('2026-11-04');
  await page.fill('#scheddate', '2026-11-05');
  await page.fill('#schedtime', '16:30');
  await page.click('#sheetok');
  let s = await app.state();
  const moved = s.later.find(n => n.id === 'q8');
  expect(moved).toMatchObject({ start: '2026-11-05', scheduled: { date: '2026-11-05', time: '16:30' } });
  expect(moved.due).toBeFalsy(); // (an appointment isn't a deadline)
  expect(s.quests.some(q => q.id === 'q8')).toBe(false);
  expect(moved.children.map(c => c.id)).toEqual(['q8a', 'q8b', 'q8c', 'q8w']); // (steps, waiting one too, kept)
  await page.click('#upd > summary');
  await expect(page.locator('#upd .uprow', { hasText: 'Office move' })).toContainText(
    'Scheduled 5 Nov 16:30',
  );
  // The next morning: back on Today, schedule and all, under Scheduled.
  await page.clock.setFixedTime(new Date(2026, 10, 5, 8, 0));
  await page.evaluate(() => {
    rollover();
    renderAll();
  });
  s = await app.state();
  expect(s.quests.find(q => q.id === 'q8').scheduled).toEqual({ date: '2026-11-05', time: '16:30' });
  expect(s.quests.find(q => q.id === 'q8').start).toBeUndefined();
  await expect(page.locator('#v-today .schedrow[data-qid="q8"] .stime')).toHaveText('16:30');
  await expect(page.locator('#v-today .schedrow[data-qid="m4"] .stime')).toHaveText('09:15');
  // Rescheduled to later today, then done.
  await page.click('#v-today .schedrow[data-qid="q8"] .qmore');
  await page.click('#sheet [data-schedset="q8"]');
  await page.fill('#schedtime', '17:45');
  await page.click('#sheetok');
  await expect(page.locator('#v-today .schedrow[data-qid="q8"] .stime')).toHaveText('17:45');
  await page.evaluate(() => openPath(['q8']));
  await expect(page.locator('.qfoot .btn:not(.qmore)').first()).toHaveText('Reschedule');
  expect(app.errors).toEqual([]);
});

test('5–8: a task only waiting is under Waiting and out of the list, its place kept; one with work left stays; the reply brings it back', async ({
  app,
  page,
}) => {
  await day(app, page);
  const order0 = (await app.state()).quests.map(q => q.id);
  // Fully waiting: under Waiting, not in Today's tasks.
  expect(await listNames(page)).not.toContain('Finance system access');
  const it = waitRows(page).filter({ hasText: 'IT to grant access' });
  await expect(it).toContainText('Finance system access');
  await expect(it).toContainText('on IT');
  await expect(it).toContainText('Chase today');
  await expect(it.locator('[data-chase]')).toHaveText('Follow up'); // (one action: a follow-up is due)
  // Partly waiting: still in the list (work left), and its waiting step under Waiting, with its task.
  expect(await listNames(page)).toContain('Megan finance queries');
  await expect(waitRows(page).filter({ hasText: 'Hear back on figures' })).toContainText(
    'Megan finance queries',
  );
  expect(await page.evaluate(() => taskState(S.quests.find(q => q.id === 'q3')))).toBe('actionable');
  // The reply: the step is resolved (not the task finished), and the task is back in the list.
  await page.click('#v-today .wrow[data-wid="b1a"] .qmore');
  await page.click('#sheet [data-waitclear="b1a"]');
  const s = await app.state();
  const b1 = s.quests.find(q => q.id === 'b1');
  expect(b1.done).toBe(false);
  expect(b1.children[0].wait).toBeUndefined();
  expect(s.follows.filter(f => f.n === 'b1a').map(f => f.k)).toContain('resolve');
  expect(await listNames(page)).toContain('Finance system access');
  expect(s.quests.map(q => q.id)).toEqual(order0); // (its place in the order never moved)
  expect(app.errors).toEqual([]);
});

test('9: Top 3, the header and Focus skip scheduled and waiting work; a chosen one that becomes scheduled is set aside, not replaced', async ({
  app,
  page,
}) => {
  await day(app, page);
  await page.evaluate(() => {
    S.top3 = { day: today(), ids: ['m2', 'b1', 'q4'] };
    S.quests.forEach(q => delete q.resume); // (no saved place: Top 3 leads)
    save();
    renderAll();
  });
  await expect(page.locator('.top3 .t3row')).toHaveCount(1);
  await expect(page.locator('.top3 .t3row')).toContainText('Q4 budget report');
  await expect(page.locator('.top3 .t3out')).toContainText(
    'Set aside (scheduled or waiting): Supplier review call, Finance system access',
  );
  expect((await app.state()).top3.ids).toEqual(['m2', 'b1', 'q4']); // (still chosen)
  await expect(page.locator('#hnow small')).toContainText('Top 3 priority 1');
  await expect(page.locator('#hnow b')).toHaveText('Draft');
  expect(await page.evaluate(() => focusTarget())).toBe('q4a');
  // Everything left scheduled or waiting: the header says so, not that all is done.
  await page.evaluate(() => {
    S.quests.forEach(q => {
      if (!q.scheduled && taskState(q) !== 'waiting') {
        q.children.forEach(c => (c.done = true));
        q.done = true;
      }
    });
    save();
    renderAll();
  });
  await expect(page.locator('#hnow b')).toHaveText('Nothing to act on right now');
  await expect(page.locator('#hnow small')).toContainText('3 scheduled · 1 waiting');
  await expect(page.locator('#v-today .nowork')).toBeHidden(); // (Done today still has rows)
  expect(app.errors).toEqual([]);
});

test('11–12: a schedule is checked, kept through reload, backup and restore, and read as local dates across month ends and clock changes', async ({
  app,
  page,
}) => {
  await day(app, page, new Date(2026, 9, 24, 23, 50)); // (the night before the clocks go back in Europe)
  const clean = await page.evaluate(() =>
    [
      { date: '2026-02-30' },
      { date: '2026-11-31', time: '10:00' },
      { date: '2026-11-05', time: '25:00' },
      { date: '2026-11-05', time: '9:00' },
      { date: 'x' },
      'junk',
      { date: '2026-12-31', time: '23:59' },
    ].map(cleanSched),
  );
  expect(clean).toEqual([
    null,
    null,
    { date: '2026-11-05' },
    { date: '2026-11-05' },
    null,
    null,
    { date: '2026-12-31', time: '23:59' },
  ]);
  await page.evaluate(async () => {
    setSchedule('q5', '2026-10-25', '01:30'); // (the hour the clocks change)
    setSchedule('q6', '2026-10-31', '09:00'); // (the month's last day)
    S.quests.push(fix({ id: 'bad', text: 'Bad', scheduled: { date: '2026-13-01', time: '10:00' } }));
    save();
    persistLocal();
    await storeDone(); // (written before the reload, whatever the load on the machine)
  });
  await page.reload();
  let s = await app.state();
  expect(s.later.find(n => n.id === 'q5').scheduled).toEqual({ date: '2026-10-25', time: '01:30' });
  expect(s.later.find(n => n.id === 'q6').scheduled).toEqual({ date: '2026-10-31', time: '09:00' });
  expect(s.quests.find(q => q.id === 'bad').scheduled).toBeUndefined();
  // Backup and restore: the same values back.
  const json = await page.evaluate(() => JSON.stringify(S));
  await page.evaluate(j => {
    pending = JSON.parse(j);
    S.later = [];
    save();
  }, json);
  await app.settings('backup');
  await page.click('#doRestore');
  s = await app.state();
  expect(s.later.find(n => n.id === 'q5').scheduled).toEqual({ date: '2026-10-25', time: '01:30' });
  // Past midnight into the 25th: the meeting is on Today, at 01:30, never shifted an hour.
  await page.clock.setFixedTime(new Date(2026, 9, 25, 0, 30));
  await page.evaluate(() => {
    rollover();
    renderAll();
  });
  await expect(page.locator('#v-today .schedrow[data-qid="q5"] .stime')).toHaveText('01:30');
  await expect(page.locator('#v-today .schedrow[data-qid="q5"]')).toContainText('Later today');
  // On the 31st's eve, the next day is the 31st, not the 1st.
  await page.clock.setFixedTime(new Date(2026, 9, 31, 7, 0));
  await page.evaluate(() => {
    rollover();
    renderAll();
  });
  await expect(page.locator('#v-today .schedrow[data-qid="q6"] .stime')).toHaveText('09:00');
  expect(app.errors).toEqual([]);
});

test('13–14: a scheduled copy of a repeating task isn’t doubled or swept away; a past one stays to be resolved, without being called overdue', async ({
  app,
  page,
}) => {
  await day(app, page);
  await page.evaluate(() => {
    const t = { id: 'tp', text: 'Weekly sync', days: [0, 1, 2, 3, 4, 5, 6], monthDay: 0, children: [] };
    S.templates.push(t);
    S.quests.push({
      ...inst(t),
      id: 'tp-' + today(),
      tpl: 'tp',
      scheduled: { date: today(), time: '15:00' },
    });
    save();
  });
  await page.clock.setFixedTime(new Date(2026, 10, 5, 9, 0));
  await page.evaluate(() => {
    rollover();
    renderAll();
  });
  const s = await app.state();
  // Yesterday's unresolved meeting is still there to resolve; no second copy made beside it.
  expect(s.quests.filter(q => q.tpl === 'tp').map(q => q.id)).toEqual(['tp-2026-11-04']);
  const past = page.locator('#v-today .schedrow[data-qid="tp-2026-11-04"]');
  await expect(past).toContainText('Yesterday: not marked done');
  await expect(past).not.toContainText('Overdue');
  const att = await page.evaluate(() => attentionItems().filter(i => i.text === 'Weekly sync'));
  expect(att.map(i => [i.sev, i.sub])).toEqual([[3, 'Scheduled yesterday: not marked done']]);
  // Nor is it a carried-over task to keep, move or drop.
  expect(await page.evaluate(() => carried().map(q => q.id))).not.toContain('tp-2026-11-04');
  // Back to ordinary work: on Today's list again.
  await past.locator('.qmore').click();
  await page.click('#sheet [data-schedclear="tp-2026-11-04"]');
  expect(await listNames(page)).toContain('Weekly sync');
  expect(app.errors).toEqual([]);
});

test('15: the board holds the same tasks as the list; Scheduled and Waiting are beside it in both', async ({
  app,
  page,
}) => {
  await day(app, page);
  const listed = (await listNames(page)).filter(Boolean);
  await page.click('[data-tview="board"]');
  const tiles = await page.$$eval('#v-today .qtopen > span', x => x.map(e => e.textContent));
  expect([...tiles].sort()).toEqual([...listed].sort());
  await expect(sched(page)).toHaveCount(3);
  await expect(waitRows(page)).toHaveCount(3);
  await expect(page.locator('#v-today .blane[data-lane="wait"]')).toHaveCount(0);
  expect(app.errors).toEqual([]);
});

test('race: a schedule sheet confirmed after the task was finished elsewhere, or during a focus session on it, changes nothing', async ({
  app,
  page,
}) => {
  await day(app, page);
  await page.click('#v-today .row[data-qid="q5"] .qmore');
  await page.click('#sheet [data-schedset="q5"]');
  await page.evaluate(() => {
    const q = S.quests.find(x => x.id === 'q5');
    q.children.forEach(c => (c.done = true));
    q.done = true;
    S.quests = S.quests.map(x => JSON.parse(JSON.stringify(x))); // (as a pull replaces records)
    inBackground(renderAll);
  });
  await page.click('#sheetok');
  await expect(page.locator('#toast')).toContainText('That task is finished');
  expect((await app.state()).quests.find(q => q.id === 'q5').scheduled).toBeUndefined();
  // A focus session on it: the session is yours to end first, so its time isn't lost.
  await page.evaluate(() => {
    S.timer = { id: 't', end: Date.now() + 10 * 60e3, left: 10 * 60e3, tag: '', mins: 25, q: 'q6a' };
    save();
    setSchedule('q6', today(), '16:00');
  });
  await expect(page.locator('#toast')).toContainText('Pause or finish the focus session');
  const s = await app.state();
  expect(s.quests.find(q => q.id === 'q6').scheduled).toBeUndefined();
  expect(s.timer.q).toBe('q6a');
  expect(app.errors).toEqual([]);
});

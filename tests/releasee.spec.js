// Release E: scheduled work and waiting on Projects, and one rule for what can be acted on now.
const { test, expect } = require('./fixtures');
const { eDay } = require('./releaseedata');

// 10:00 local on a weekday (the page's clock), the Release E day loaded.
async function day(app, page, at = new Date(2026, 10, 4, 10, 0)) {
  await page.clock.install({ time: at });
  await app.open();
  await app.setState(eDay);
  await page.reload();
}
const card = (page, id) => page.locator(`#v-projects .project-card[data-qid="${id}"]`);
// A scheduled project's tag on its card ("Scheduled 14:00").
const when = (page, id) => card(page, id).locator('.project-meta .tag.sched');
// The cards of work that isn't finished or put off, scheduled ones among them.
const openCards = page => page.locator('#active-project-grid .project-card');
// Where each scheduled task stands (later today, its time gone, today with no time...).
const stands = (page, ...ids) => page.evaluate(ids => ids.map(id => schedStatus(find(id).n).k), ids);
const moreActions = page => page.click('.qfoot [aria-label="More actions"]');

test('1–2: a 14:00 meeting says when on its card, and is never the next task; after 14:00 it waits for you to record it', async ({
  app,
  page,
}) => {
  await day(app, page);
  await expect(openCards(page).locator('.tag.sched')).toHaveCount(3);
  await expect(when(page, 'm1')).toHaveText('Scheduled 10:30');
  await expect(when(page, 'm2')).toHaveText('Scheduled 14:00');
  await expect(when(page, 'm3')).toHaveText('Scheduled today');
  // Later today: nothing to tick on its card yet. A day with no time can be ticked any time.
  expect(await stands(page, 'm1', 'm2', 'm3')).toEqual(['soon', 'soon', 'today']);
  await expect(card(page, 'm1').locator('.check')).toHaveCount(0);
  await expect(card(page, 'm2').locator('.check')).toHaveCount(0);
  await expect(card(page, 'm3').locator('.check')).toHaveCount(1);
  // Not recommended, and not in the Focus picker.
  const rec = await page.evaluate(() => recommend().q.text);
  expect(['Team meeting', 'Supplier review call', 'First-aid training']).not.toContain(rec);
  await page.evaluate(() => go('focus'));
  expect(await page.$$eval('#fq option', o => o.map(x => x.textContent).join('|'))).not.toContain(
    'Supplier review call',
  );
  // Its actions: done, reschedule, back to ordinary work; no Focus.
  await app.openQuest('Supplier review call');
  await expect(page.locator('.qfoot .btn:not(.qmore)')).toHaveText(['Mark done']);
  await moreActions(page);
  await expect(page.locator('#sheet .qact')).toHaveText([
    /^Mark done/,
    /^Reschedule/,
    'Unschedule',
    'Rename',
    /^Delete/,
  ]);
  await page.keyboard.press('Escape');
  await page.click('[data-crumb="-1"]');
  // 14:05: still there, unfinished, asking for the outcome. Nothing completes it on its own.
  await page.clock.setFixedTime(new Date(2026, 10, 4, 14, 5));
  await page.evaluate(() => renderAll());
  expect(await stands(page, 'm1', 'm2', 'm3')).toEqual(['passed', 'passed', 'today']);
  await expect(card(page, 'm1').locator('.check')).toHaveCount(1);
  expect((await app.state()).quests.find(q => q.id === 'm2').done).toBe(false);
  await card(page, 'm2').locator('.check[data-toggle]').click();
  const s = await app.state();
  expect(s.quests.find(q => q.id === 'm2').done).toBe(true);
  expect(s.quests.find(q => q.id === 'm2').scheduled).toEqual({ date: '2026-11-04', time: '14:00' });
  await expect(openCards(page).locator('.tag.sched')).toHaveCount(2);
  await expect(page.locator('#projects-done .project-card[data-qid="m2"]')).toHaveCount(1);
  expect(app.errors).toEqual([]);
});

test('3–4: scheduled for tomorrow from the task’s actions: on Upcoming with its time, among the day’s work the next morning; then rescheduled', async ({
  app,
  page,
}) => {
  await day(app, page);
  await app.openQuest('Office move'); // (q8)
  await moreActions(page);
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
  // (its page closed with the move: back on the board, where it's under Upcoming)
  const upcoming = page.locator('#v-projects .project-group', {
    has: page.getByRole('heading', { name: 'Upcoming' }),
  });
  await expect(upcoming.locator('.project-card[data-qid="q8"] .tag.sched')).toHaveText(
    'Scheduled 5 Nov 16:30',
  );
  await expect(openCards(page).filter({ hasText: 'Office move' })).toHaveCount(0);
  // Its record says when, and offers to reschedule.
  await upcoming.locator('.project-card[data-qid="q8"] .project-open').click();
  await expect(page.locator('#v-project-record .project-record > .hint').first()).toHaveText(
    'Starts 5 Nov · 16:30',
  );
  await expect(page.locator('#v-project-record [data-schedset="q8"]')).toHaveText('Reschedule');
  await page.click('[data-project-record-back]');
  // The next morning: back among the day's work, schedule and all.
  await page.clock.setFixedTime(new Date(2026, 10, 5, 8, 0));
  await page.evaluate(() => {
    rollover();
    renderAll();
  });
  s = await app.state();
  expect(s.quests.find(q => q.id === 'q8').scheduled).toEqual({ date: '2026-11-05', time: '16:30' });
  expect(s.quests.find(q => q.id === 'q8').start).toBeUndefined();
  await expect(openCards(page).filter({ hasText: 'Office move' })).toHaveCount(1);
  await expect(when(page, 'q8')).toHaveText('Scheduled 16:30');
  await expect(when(page, 'm4')).toHaveText('Scheduled 09:15');
  // Rescheduled to later today, from its page.
  await app.openQuest('Office move');
  await moreActions(page);
  await expect(page.locator('#sheet [data-schedset="q8"]')).toContainText('Reschedule');
  await page.click('#sheet [data-schedset="q8"]');
  await page.fill('#schedtime', '17:45');
  await page.click('#sheetok');
  await expect(page.locator('.facts .tag.sched')).toHaveText('Scheduled 17:45');
  await expect(page.locator('.qfoot .btn:not(.qmore)').first()).toHaveText('Reschedule');
  await page.click('[data-crumb="-1"]');
  await expect(when(page, 'q8')).toHaveText('Scheduled 17:45');
  expect(app.errors).toEqual([]);
});

test('5–8: a task only waiting says so on its card, its place kept; one with work left doesn’t; the reply brings it back', async ({
  app,
  page,
}) => {
  await day(app, page);
  const order0 = (await app.state()).quests.map(q => q.id),
    board0 = await app.order();
  const state = id => page.evaluate(id => taskState(S.quests.find(q => q.id === id)), id);
  // Fully waiting: its card says so, with who and when to chase; there is nothing to tick.
  const b1 = card(page, 'b1'); // Finance system access
  expect(await state('b1')).toBe('waiting');
  await expect(b1.locator('.project-meta > span').first()).toHaveText('Waiting');
  await expect(b1.locator('.project-step[data-qid="b1a"]')).toContainText('IT to grant access');
  await expect(b1.locator('.project-step[data-qid="b1a"] .project-wait')).toHaveText(
    'Waiting on IT · Chase today',
  );
  await expect(b1.locator('.check')).toHaveCount(0);
  // (one action on its page: a follow-up is due)
  await app.openQuest('Finance system access');
  await expect(page.locator('.qnext')).toContainText('Nothing until you hear back');
  await expect(page.locator('.qfoot .btn:not(.qmore)')).toHaveText(['Follow up: IT to grant access']);
  // The Waiting page has it, with its task.
  await app.go('waiting');
  const it = page.locator('#v-waiting .row[data-wid="b1a"]');
  await expect(it).toContainText('IT to grant access');
  await expect(it).toContainText('in Finance system access');
  await expect(it).toContainText('from IT');
  await expect(it).toContainText('Chase today');
  // Partly waiting: ordinary work (there are steps to do), its waiting step shown with its task.
  await expect(page.locator('#v-waiting .row[data-wid="q3w"]')).toContainText('in Megan finance queries');
  await app.go('projects');
  expect(await state('q3')).toBe('actionable');
  await expect(card(page, 'q3').locator('.project-meta')).not.toContainText('Waiting');
  await expect(card(page, 'q3').locator('.project-step[data-qid="q3w"] .project-wait')).toHaveText(
    'Waiting on Emily · Chase now',
  );
  await expect(card(page, 'q3').locator('.check')).toHaveCount(2); // (its two steps to do)
  // The reply: the step is resolved (not the task finished), and the task is ordinary work again.
  await b1.locator('.project-wait[data-wact="b1a"]').click();
  await page.click('#sheet [data-waitclear="b1a"]');
  const s = await app.state();
  const q = s.quests.find(q => q.id === 'b1');
  expect(q.done).toBe(false);
  expect(q.children[0].wait).toBeUndefined();
  expect(s.follows.filter(f => f.n === 'b1a').map(f => f.k)).toContain('resolve');
  expect(await state('b1')).toBe('actionable');
  await expect(b1.locator('.project-meta')).not.toContainText('Waiting');
  await expect(b1.locator('.project-wait')).toHaveCount(0);
  await expect(b1.locator('.project-step[data-qid="b1a"] .check')).toHaveAttribute(
    'aria-label',
    'Mark done: IT to grant access',
  );
  expect(s.quests.map(q => q.id)).toEqual(order0); // (its place in the order never moved)
  expect(await app.order()).toEqual(board0);
  await app.go('waiting');
  await expect(page.locator('#v-waiting .row[data-wid="q3w"]')).toHaveCount(1);
  await expect(page.locator('#v-waiting .row[data-wid="b1a"]')).toHaveCount(0);
  expect(app.errors).toEqual([]);
});

test('9: Focus skips scheduled and waiting work; with nothing else left there is nothing to recommend', async ({
  app,
  page,
}) => {
  await day(app, page);
  await page.evaluate(() => {
    S.quests.forEach(q => delete q.resume); // (no saved place: the list's order leads)
    save();
    renderAll();
  });
  expect(await page.evaluate(() => recommend()?.why)).toBe('list');
  expect(await page.evaluate(() => recommend()?.q.text)).toBe('Walsingham sale');
  expect(await page.evaluate(() => focusTarget())).toBe('q0b');
  // A task chosen for Focus that is scheduled, or a step that is waiting: not the one focused on.
  for (const id of ['m2', 'b1', 'b1a', 'q3w']) {
    await page.evaluate(id => {
      S.focusQ = id;
      save();
    }, id);
    expect(await page.evaluate(() => focusTarget())).toBe('q0b');
  }
  // A saved place on a scheduled task doesn't lead either.
  await page.evaluate(() => {
    S.focusQ = '';
    S.quests.find(q => q.id === 'm2').resume = { note: 'Agenda half read', at: Date.now(), step: '' };
    save();
    renderAll();
  });
  expect(await page.evaluate(() => recommend()?.q.text)).toBe('Walsingham sale');
  // Everything left is scheduled or waiting.
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
  expect(await page.evaluate(() => recommend())).toBeNull();
  expect(await page.evaluate(() => focusTarget())).toBeNull();
  expect(
    await openCards(page).evaluateAll(cs => cs.map(c => c.dataset.qid)),
    'the scheduled and the waiting are all that is left on the board',
  ).toEqual(['m1', 'm2', 'm3', 'b1']);
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
  // Past midnight into the 25th: the meeting is among the day's work, at 01:30 and still to come,
  // never shifted an hour.
  await page.clock.setFixedTime(new Date(2026, 9, 25, 0, 30));
  await page.evaluate(() => {
    rollover();
    renderAll();
  });
  await app.go('projects');
  await expect(openCards(page).filter({ hasText: 'Team rota' })).toHaveCount(1);
  await expect(when(page, 'q5')).toHaveText('Scheduled 01:30');
  expect(await stands(page, 'q5')).toEqual(['soon']);
  await expect(card(page, 'q5').locator('.check')).toHaveCount(0); // (later today: not to tick yet)
  // On the 31st's eve, the next day is the 31st, not the 1st.
  await page.clock.setFixedTime(new Date(2026, 9, 31, 7, 0));
  await page.evaluate(() => {
    rollover();
    renderAll();
  });
  await expect(openCards(page).filter({ hasText: 'Client onboarding' })).toHaveCount(1);
  await expect(when(page, 'q6')).toHaveText('Scheduled 09:00');
  expect(app.errors).toEqual([]);
});

test('13–14: a scheduled copy of a repeating task isn’t swept away, and the next day’s copy still comes; a past one stays to be resolved, without being called overdue', async ({
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
  // Yesterday's unresolved meeting is still there to resolve, and today's copy is made (once).
  expect(s.quests.filter(q => q.tpl === 'tp').map(q => q.id)).toEqual(['tp-2026-11-04', 'tp-2026-11-05']);
  await page.evaluate(() => rollover());
  expect((await app.state()).quests.filter(q => q.tpl === 'tp')).toHaveLength(2);
  const past = card(page, 'tp-2026-11-04');
  await expect(past.locator('.tag.sched')).toHaveText('Scheduled 4 Nov 15:00');
  expect(await stands(page, 'tp-2026-11-04')).toEqual(['past']);
  await expect(past.locator('.check')).toHaveCount(1); // (there to be recorded)
  await expect(past).not.toContainText('Overdue');
  const att = await page.evaluate(() => attentionItems().filter(i => i.text === 'Weekly sync'));
  expect(att.map(i => [i.sev, i.sub])).toEqual([[3, 'Scheduled yesterday: not marked done']]);
  await app.go('ops');
  const item = page.locator('#v-ops .attlist .attrow', { hasText: 'Weekly sync' });
  await expect(item).toHaveCount(1);
  await expect(item).toContainText('Scheduled yesterday: not marked done · Open task');
  await expect(item).not.toContainText('Overdue');
  // Nor is it a carried-over task to keep, move or drop.
  expect(await page.evaluate(() => carried().map(q => q.id))).not.toContain('tp-2026-11-04');
  // Back to ordinary work: no longer scheduled, and one to focus on.
  await item.locator('[data-open="tp-2026-11-04"]').click();
  await expect(page.locator('.facts .tag.sched')).toHaveText('Scheduled 4 Nov 15:00');
  await moreActions(page);
  await page.click('#sheet [data-schedclear="tp-2026-11-04"]');
  expect((await app.state()).quests.find(q => q.id === 'tp-2026-11-04').scheduled).toBeUndefined();
  expect(await page.evaluate(() => taskState(find('tp-2026-11-04').n))).toBe('actionable');
  await expect(page.locator('.facts .tag.sched')).toHaveCount(0);
  await expect(page.locator('.qfoot [data-zen]')).toHaveText('Focus on this');
  expect(await page.evaluate(() => attentionItems().filter(i => i.text === 'Weekly sync'))).toEqual([]);
  await app.go('projects');
  await expect(past.locator('.tag.sched')).toHaveCount(0);
  expect(app.errors).toEqual([]);
});

test('race: a schedule sheet confirmed after the task was finished elsewhere, or during a focus session on it, changes nothing', async ({
  app,
  page,
}) => {
  await day(app, page);
  await app.openQuest('Team rota'); // (q5)
  await moreActions(page);
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

test('sync: a task in both Today and Upcoming after a move raced an edit is kept once: the finished copy, else where the newest Today order puts it', async ({
  app,
  page,
}) => {
  await day(app, page);
  const r = await page.evaluate(() => {
    const build = (todayHasIt, todayDone, laterDone) => {
      const s = JSON.parse(JSON.stringify(S));
      const x = s.quests.find(q => q.id === 'q7');
      x.done = todayDone;
      x.notes = 'edited on B';
      const moved = {
        ...JSON.parse(JSON.stringify(x)),
        done: laterDone,
        notes: '',
        start: shift(today(), 1),
        scheduled: { date: shift(today(), 1), time: '09:30' },
      };
      s.later.push(moved);
      const m = toRecords(s);
      const o = m.get('meta:order');
      m.set('meta:order', { ...o, quests: todayHasIt ? o.quests : o.quests.filter(id => id !== 'q7') });
      const out = fromRecords(m, today());
      return [out.quests.filter(q => q.id === 'q7').length, out.later.filter(q => q.id === 'q7').length];
    };
    return {
      movedLater: build(false, false, false), // (A moved it to tomorrow; B edited the Today copy)
      movedToday: build(true, false, false), // (A brought it to Today; B edited the Upcoming copy)
      doneOnB: build(false, true, false), // (B finished it meanwhile)
    };
  });
  expect(r).toEqual({ movedLater: [0, 1], movedToday: [1, 0], doneOnB: [1, 0] });
  expect(app.errors).toEqual([]);
});

test('audit fixes: review, Focus, Resume, Continue and Forecast use the same rule; the Inbox drops a schedule', async ({
  app,
  page,
}) => {
  await day(app, page);
  const r = await page.evaluate(() => {
    const m2 = S.quests.find(q => q.id === 'm2'),
      b1 = S.quests.find(q => q.id === 'b1');
    m2.since = shift(today(), -5); // (on Today for days, but scheduled: not carried over)
    b1.resume = { note: 'Asked IT', at: Date.now(), step: 'b1a' };
    save();
    go('focus');
    const focusOpts = [...document.querySelectorAll('#fq option')].map(o => o.value);
    go('today');
    const acts = questActions('b1', true).map(a => a.label);
    location.hash = '';
    followRoute({ kind: 'continue', id: '' });
    const cont = path[0];
    go('today');
    // A scheduled task with steps, every one ticked: Finish task, not Reschedule.
    S.quests.push(
      fix({
        id: 'ms',
        text: 'Agenda meeting',
        scheduled: { date: today(), time: '16:00' },
        children: [{ id: 'ms1', text: 'Agenda', done: true }],
      }),
    );
    const msAct = primaryAction(S.quests.find(q => q.id === 'ms')).label;
    const cov = coverage(allocate(7));
    moveToInbox('m3');
    const inboxed = S.inbox.find(i => i.text === 'First-aid training').node;
    return {
      stale: carried().map(q => q.id),
      reviewHasM2: renderReview
        ? ((reviewSub = 'week'),
          renderReview(),
          document.querySelector('#v-review').textContent.includes('Supplier review call 5 days'))
        : null,
      focusOpts,
      acts,
      cont,
      msAct,
      cov: [cov.est, cov.total],
      inboxedSched: inboxed.scheduled,
    };
  });
  expect(r.stale).not.toContain('m2');
  expect(r.reviewHasM2).toBe(false);
  expect(r.focusOpts).not.toContain('b1');
  expect(r.focusOpts).not.toContain('b1a');
  expect(r.acts).not.toContain('Resume work');
  expect(r.cont).not.toBe('b1');
  expect(r.msAct).toBe('Finish task');
  expect(r.cov[0]).toBeGreaterThanOrEqual(1); // (the estimated meeting counts as estimated)
  expect(r.inboxedSched).toBeUndefined();
  expect(app.errors).toEqual([]);
});

test('UI fixes: a scheduled task’s page says when; an earlier day’s card shows its date; a waiting line opens its task and back returns to Projects', async ({
  app,
  page,
}) => {
  await day(app, page);
  await app.openQuest('Supplier review call');
  await expect(page.locator('.facts .tag.sched')).toHaveText('Scheduled 14:00');
  await page.click('.facts [data-schedset="m2"]');
  await expect(page.locator('#schedtime')).toHaveValue('14:00');
  await page.keyboard.press('Escape');
  await page.evaluate(() => history.back());
  await expect(page.locator('#v-projects')).toBeVisible();
  // A waiting line on a card: its task's page, and back to Projects in one step.
  await card(page, 'b1').locator('.project-wait[data-wact="b1a"]').click();
  await page.click('#sheet [data-open="b1"]');
  expect(await page.evaluate(() => path)).toEqual(['b1']);
  await expect(page.locator('.node.facts > h1')).toHaveText('Finance system access');
  await page.evaluate(() => history.back());
  await expect(page.locator('#v-projects')).toBeVisible();
  await expect(page.locator('#v-today')).toBeHidden();
  // Next day: an earlier day's card shows its date with its time.
  await page.clock.setFixedTime(new Date(2026, 10, 5, 9, 0));
  await page.evaluate(() => {
    rollover();
    renderAll();
  });
  await expect(when(page, 'm1')).toHaveText('Scheduled 4 Nov 10:30');
  await expect(when(page, 'm4')).toHaveText('Scheduled 09:15');
  // Schedule isn't offered during a focus session on the task.
  await page.evaluate(() => {
    S.timer = { id: 't', end: Date.now() + 6e5, left: 6e5, tag: '', mins: 25, q: 'q6a' };
    save();
  });
  expect(await page.evaluate(() => questActions('q6').map(a => a.label))).not.toContain('Schedule');
  expect(app.errors).toEqual([]);
});

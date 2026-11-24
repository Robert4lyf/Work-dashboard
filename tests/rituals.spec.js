const { test, expect } = require('./fixtures');

// Wednesday 23 Sep 2026, 9am; the clock only moves when a test moves it.
test.beforeEach(async ({ app, page }) => {
  await page.clock.install({ time: new Date(2026, 8, 23, 9) });
  await app.open();
  await page.clock.pauseAt(new Date(2026, 8, 23, 9, 0, 30));
});

// The weekly review's Carried over step (Review > Week, its second step).
const carriedStep = async (app, page) => {
  await app.go('review');
  const step = page.locator('#v-review .wstep', { has: page.locator('h2', { hasText: 'Carried over' }) });
  await expect(page.locator('#v-review .wstepno')).toBeVisible();
  if (!(await step.count())) await page.click('#v-review [data-rstep="1"]');
  await expect(page.locator('#v-review .wstepno')).toHaveText('Step 2 of 5');
  return step;
};

test('tasks carried over for 3+ days ask for a decision in the weekly review', async ({ app, page }) => {
  for (const t of ['Old report', 'Old email', 'Old call', 'Old idea', 'Fresh']) await app.addQuest(t);
  expect((await app.state()).quests.every(q => q.since === '2026-09-23')).toBe(true);
  await app.setState(s => s.quests.slice(0, 4).forEach(q => (q.since = '2026-09-19')));
  await page.reload();
  // The cards on the board don't carry an age badge; the review's step counts them, a row each.
  await expect(page.locator('#v-projects .project-card')).toHaveCount(5);
  await expect(page.locator('#v-projects .tag.old')).toHaveCount(0);
  let card = await carriedStep(app, page);
  await expect(card.locator('h2 small')).toHaveText('4');
  await expect(card.locator('.crow')).toHaveCount(4);
  await expect(card).toContainText('Old report 4 days');

  await card.locator('[data-keep]').first().click(); // Keep: off the card until tomorrow
  await card.locator('.crow', { hasText: 'Old email' }).locator('[data-sched]').first().click();
  await card.locator('[data-toinbox]').first().click(); // Old call
  // Old idea: Delete takes two taps (Release H), as deleting a task does elsewhere.
  await expect(card.locator('[data-drop]').first()).toHaveText('Delete');
  await card.locator('[data-drop]').first().click();
  await expect(card.locator('[data-drop]').first()).toHaveText('Delete?');
  expect((await app.state()).quests.some(q => q.text === 'Old idea')).toBe(true);
  await card.locator('[data-drop]').first().click();
  await expect(page.locator('#toast')).toContainText('Deleted Old idea');
  await expect(card.locator('.crow')).toHaveCount(0);
  await expect(card).toContainText('All clear.');
  let s = await app.state();
  expect(s.quests.map(q => q.text)).toEqual(['Old report', 'Fresh']);
  expect(s.quests[0].kept).toBe('2026-09-23');
  expect(s.later).toMatchObject([{ text: 'Old email', start: '2026-09-24' }]);
  expect(s.later[0].since).toBeUndefined();
  expect(s.inbox[0].text).toBe('Old call');

  // Back on Projects, a moved task starts counting again; a kept one asks again tomorrow.
  await page.clock.setSystemTime(new Date(2026, 8, 24, 9));
  await page.reload();
  s = await app.state();
  expect(s.quests.find(q => q.text === 'Old email').since).toBe('2026-09-24');
  card = await carriedStep(app, page);
  await expect(card.locator('.crow')).toHaveCount(1);
  await expect(card).toContainText('Old report 5 days');
});

test('waiting is on a step: set from the task, shown on its card and the Waiting page, not Next up', async ({
  app,
  page,
}) => {
  await app.addQuest('Budget review');
  await app.addQuest('Write report');
  await app.openQuest('Budget review');
  // On a task, "Waiting on someone?" adds a step (named by "For what") that waits.
  await page.click('#waitd summary');
  await page.fill('#wwho', 'Sam');
  await page.fill('#wnote', 'Q3 figures');
  await page.fill('#wdue', '2026-09-23');
  await page.click('[data-waitsave]');
  let s = await app.state();
  expect(s.quests[0].wait).toBeUndefined();
  expect(s.quests[0].children).toHaveLength(1);
  expect(s.quests[0].children[0]).toMatchObject({
    text: 'Q3 figures',
    wait: { who: 'Sam', note: '', due: '2026-09-23', since: '2026-09-23' },
  });
  await expect(page.locator('#v-today .list .row')).toContainText('Q3 figures');
  await expect(page.locator('#waitd summary')).toContainText('Add it as a step'); // (ready for another)
  // The step's own page edits its waiting.
  await page.click('#v-today .list .open >> text="Q3 figures"');
  await expect(page.locator('#waitd summary')).toHaveText('Waiting on Sam');
  // Once waiting there's no Save: each changed detail is saved straight away, and moving on
  // with Tab keeps the keyboard where it went.
  await page.fill('#wwho', 'Sam B');
  await page.press('#wwho', 'Tab');
  await expect(page.locator('#wnote')).toBeFocused();
  expect((await app.state()).quests[0].children[0].wait.who).toBe('Sam B');
  await expect(page.locator('#waitd summary')).toHaveText('Waiting on Sam B');
  await page.fill('#wwho', 'Sam');
  await page.press('#wwho', 'Tab');
  // A date being typed is saved once the field is left, not a part at a time.
  await page.click('#wdue');
  await page.keyboard.type('10152026');
  await page.press('#wdue', 'Tab');
  expect((await app.state()).quests[0].children[0].wait.due).toBe('2026-10-15');
  // A date picked (the field keeping the keyboard, as on Android) survives a redraw before it's
  // left, and is then saved.
  await page.fill('#wdue', '2026-10-05');
  await page.evaluate(() => inBackground(renderToday));
  await expect(page.locator('#wdue')).toHaveValue('2026-10-05');
  // (left for another field: since Release H the redraw leaves the field exactly as it was, the
  // keyboard on the part of the date it was on, so Tab would move to its next part)
  await page.focus('#wexp');
  expect((await app.state()).quests[0].children[0].wait.due).toBe('2026-10-05');
  await page.fill('#wdue', '2026-09-23');
  await page.press('#wdue', 'Tab');
  // Once waiting there's no Save: each changed detail is saved straight away.
  await expect(page.locator('[data-waitsave]')).toHaveCount(0);
  await page.fill('#wnote', 'Q3 and Q4 figures');
  await page.press('#wnote', 'Tab');
  expect((await app.state()).quests[0].children[0].wait.note).toBe('Q3 and Q4 figures');
  await page.fill('#wnote', '');
  await page.press('#wnote', 'Tab');
  await page.click('[data-crumb="-1"]');
  // (its only step waits, so its card says Waiting, with who and its chase date on the step)
  await expect(page.locator('#v-projects')).toBeVisible();
  const card = page.locator('#v-projects .project-card', { hasText: 'Budget review' });
  await expect(page.locator('#v-projects .project-wait')).toHaveCount(1);
  await expect(card.locator('.project-meta')).toContainText('Waiting');
  await expect(card.locator('.project-step', { hasText: 'Q3 figures' }).locator('.project-wait')).toHaveText(
    'Waiting on Sam · Chase today',
  );
  // It's blocked, so Next up moves on to the next task.
  expect(await page.evaluate(() => recommend()?.n.text)).toBe('Write report');
  // The Command Centre's attention list has it, for today, and leads to the Waiting page.
  await app.go('ops');
  await expect(page.locator('#v-ops .attlist .attrow')).toHaveCount(1);
  await expect(page.locator('#v-ops .attlist [data-wgo]')).toContainText('Chase Sam today');
  await page.click('#v-ops .attlist [data-wgo]');

  const v = page.locator('#v-waiting');
  await expect(v).toBeVisible();
  await expect(v.locator('.row')).toHaveCount(1);
  await expect(v.locator('.row')).toContainText('Q3 figures');
  await expect(v.locator('.row')).toContainText('from Sam · in Budget review');
  await expect(v.locator('.row')).toContainText('Chase today');

  // Add from the Waiting tab: it lands in the Inbox, already waiting, and is listed here.
  // The add box starts closed: the tab opens on the list.
  await expect(page.locator('#wwhat')).toBeHidden();
  await page.click('#waddd > summary');
  await page.fill('#wwhat', 'Signed contract');
  await page.fill('#wfrom', 'Legal');
  await page.press('#wwhat', 'Enter');
  s = await app.state();
  expect(s.inbox[0]).toMatchObject({ text: 'Signed contract', wait: { who: 'Legal', due: '' } });
  await expect(v.locator('.row')).toHaveCount(2);
  await expect(v.locator('.row', { hasText: 'Signed contract' })).toContainText('from Legal · in Inbox');
  // Moving it to Projects keeps it waiting, through a step of its own.
  await app.go('inbox');
  await expect(page.locator('#v-inbox .tag.wait')).toHaveText('Waiting on Legal');
  await page.click('#v-inbox [data-promote]');
  s = await app.state();
  const sc = s.quests.find(q => q.text === 'Signed contract');
  expect(sc.wait).toBeUndefined();
  expect(sc.children[0]).toMatchObject({ text: 'Hear back', wait: { who: 'Legal' } });
  await app.go('waiting');

  // "Got it" puts it back on the list as a normal task.
  await v.locator('.row', { hasText: 'Budget review' }).locator('[data-waitclear]').click();
  s = await app.state();
  expect(s.quests[0].children[0].wait).toBeUndefined();
  expect(await page.evaluate(() => recommend()?.n.text)).toBe('Q3 figures');
  await expect(v.locator('.row')).toHaveCount(1);
  // Ticking one off from the Waiting tab finishes it (and its task, its only step).
  await v.locator('[data-toggle]').click();
  expect((await app.state()).quests.find(q => q.text === 'Signed contract').children[0].done).toBe(true);
  await expect(v.locator('.empty')).toContainText('Nothing to chase');
});

test('an inbox item can be marked waiting from its details', async ({ app, page }) => {
  await app.go('inbox');
  await page.fill('#iin', 'Invoice approval');
  await page.press('#iin', 'Enter');
  const id = (await app.state()).inbox[0].id;
  await page.click(`[data-steps="${id}"]`);
  await page.fill(`[data-iwait="${id}"]`, 'Finance');
  await page.dispatchEvent(`[data-iwait="${id}"]`, 'change');
  expect((await app.state()).inbox[0].wait).toMatchObject({ who: 'Finance' });
  await app.go('waiting');
  await expect(page.locator('#v-waiting .row')).toContainText('from Finance · in Inbox');
  await page.click('#v-waiting [data-waitclear]');
  expect((await app.state()).inbox[0].wait).toBeUndefined();
});

test('a task set waiting before this waits through a step; it gets a chase notification, and skips the carried-over step', async ({
  app,
  page,
}) => {
  await app.addQuest('Budget review');
  await app.setState(s => {
    s.quests[0].since = '2026-09-10';
    s.quests[0].wait = { who: 'Sam', note: '', due: '2026-09-25', since: '2026-09-10' };
  });
  await page.reload();
  const s = await app.state();
  expect(s.quests[0].wait).toBeUndefined();
  expect(s.quests[0].children).toMatchObject([
    { id: s.quests[0].id + '-w', text: 'Hear back', wait: { who: 'Sam', due: '2026-09-25' } },
  ]);
  // (on Projects since the 10th, but only waiting: nothing to decide in the weekly review)
  const card = await carriedStep(app, page);
  await expect(card.locator('.crow')).toHaveCount(0);
  await expect(card).toContainText('All clear.');
  const want = await page.evaluate(() => wantedNotices(new Date(2026, 8, 23, 9).getTime()));
  expect(want.find(n => n.key.startsWith('chase:'))).toMatchObject({
    title: 'Time to chase',
    body: 'Budget review / Hear back (Sam)',
  });
});

test('old promises become quests: waiting ones with a waiting step, "I owe" ones plain', async ({
  app,
  page,
}) => {
  await page.evaluate(() => save());
  await app.setState(s => {
    s.promises = [
      { id: 'a', dir: 'wait', what: 'Budget figures', who: 'Sam', due: '2026-09-25', done: '', t: 1 },
      { id: 'b', dir: 'owe', what: 'Send the deck', who: 'Sarah', due: '2026-09-24', done: '', t: 2 },
      { id: 'c', dir: 'owe', what: 'Old one', who: '', due: '', done: '2026-09-20', t: 3 },
    ];
  });
  await page.reload();
  const s = await app.state();
  expect(s.promises).toBeUndefined();
  expect(s.quests).toMatchObject([
    {
      id: 'p-a',
      text: 'Budget figures',
      children: [{ id: 'p-a-w', wait: { who: 'Sam', due: '2026-09-25' } }],
    },
    { id: 'p-b', text: 'Send the deck (for Sarah)', due: '2026-09-24' },
  ]);
  expect(s.quests[1].wait).toBeUndefined();
});

test('interruptions sync as their own rows; waiting travels with its task', async ({ app, page }) => {
  const r = await page.evaluate(() => {
    S.interrupts.push({ id: 'i1', t: Date.now(), q: null, why: 'Call' });
    S.quests.push(fix({ id: 'q1', text: 'x', children: [{ id: 's1', text: 'y', wait: { who: 'Sam' } }] }));
    const m = toRecords(S),
      back = fromRecords(m, S.day);
    return { keys: [...m.keys()].filter(k => /^(interrupt|promise):/.test(k)), back };
  });
  expect(r.keys).toEqual(['interrupt:i1']);
  expect(r.back.interrupts[0].why).toBe('Call');
  expect(r.back.quests[0].children[0].wait.who).toBe('Sam');
});

test('a task with a step waiting on someone shows as waiting too', async ({ app, page }) => {
  await app.addQuest('Budget');
  await app.openQuest('Budget');
  await app.addSub('Get figures');
  await app.addSub('Write summary');
  await app.setState(
    s => (s.quests[0].children[0].wait = { who: 'Sam', note: '', due: '', since: '2026-09-23' }),
  );
  await page.reload();
  // Its card says so on the step, and its page among its facts.
  const card = page.locator('#v-projects .project-card', { hasText: 'Budget' });
  await expect(card.locator('.project-step', { hasText: 'Get figures' }).locator('.project-wait')).toHaveText(
    'Waiting on Sam',
  );
  await expect(card.locator('.project-step-clock')).toHaveCount(1);
  await app.openQuest('Budget');
  await expect(page.locator('#v-today .factsrow .tag.wait')).toHaveText('Waiting on Sam');
  await expect(page.locator('#v-today .row', { hasText: 'Get figures' })).toHaveClass(/waiting/);
  // The rest of the task carries on: Next up skips the waiting step.
  expect(await page.evaluate(() => recommend()?.n.text)).toBe('Write summary');
  // Once the step is back, the task isn't waiting.
  await app.setState(s => delete s.quests[0].children[0].wait);
  await page.reload();
  await expect(card).toBeVisible();
  await expect(card.locator('.project-wait')).toHaveCount(0);
  await expect(card.locator('.project-step-clock')).toHaveCount(0);
  await app.openQuest('Budget');
  await expect(page.locator('#v-today .factsrow .tag.wait')).toHaveCount(0);
  await expect(page.locator('#v-today .row', { hasText: 'Get figures' })).not.toHaveClass(/waiting/);
});

test('a waiting project keeps its place on the board, marked Waiting, through a reorder', async ({
  app,
  page,
}) => {
  for (const t of ['Budget', 'Report', 'Email']) await app.addQuest(t);
  await app.setState(
    s =>
      (s.quests[0].children = [
        fix({ id: 'bw', text: 'Figures', wait: { who: 'Sam', note: '', due: '', since: '2026-09-23' } }),
      ]),
  );
  await page.reload();
  // (the board keeps the real order: a waiting project isn't moved below the rest, it says Waiting)
  expect(await app.order()).toEqual(['Budget', 'Report', 'Email']);
  const card = t => page.locator('#v-projects .project-card', { hasText: t });
  await expect(card('Budget').locator('.project-meta')).toContainText('Waiting');
  await expect(card('Budget').locator('.project-wait')).toHaveText('Waiting on Sam');
  await expect(card('Report').locator('.project-meta')).toHaveCount(0);
  // A move among the others keeps it where it was.
  const move = async (t, how) => {
    await card(t).locator('[data-project-reorder]').click();
    await page.locator('#sheet .qact', { hasText: how }).click();
  };
  await move('Report', 'Move later');
  expect((await app.state()).quests.map(q => q.text)).toEqual(['Budget', 'Email', 'Report']);
  expect(await app.order()).toEqual(['Budget', 'Email', 'Report']);
  await move('Report', 'Move earlier');
  expect((await app.state()).quests.map(q => q.text)).toEqual(['Budget', 'Report', 'Email']);
  await app.setState(s => delete s.quests[0].children[0].wait);
  await page.reload();
  expect(await app.order()).toEqual(['Budget', 'Report', 'Email']);
  await expect(card('Budget').locator('.project-wait')).toHaveCount(0);
  await expect(card('Budget').locator('.project-meta')).not.toContainText('Waiting');
});

test("a task's steps keep their order on its page, a waiting one too; only finished ones go last", async ({
  app,
  page,
}) => {
  await app.addQuest('Proposal');
  await app.setState(
    s =>
      (s.quests[0].children = [
        fix({
          id: 'w',
          text: 'Final proposal',
          wait: { who: 'Emily', note: '', due: '', since: '2026-09-23' },
        }),
        fix({ id: 'r', text: 'Respond to Megan' }),
        fix({ id: 'd', text: 'Kickoff', done: true }),
      ]),
  );
  await page.reload();
  await app.openQuest('Proposal');
  const rows = page.locator('#v-today .list .row .open > span');
  await expect(rows).toHaveText(['Final proposal', 'Respond to Megan', 'Kickoff']);
  await page.click('#reorder');
  await expect(rows).toHaveText(['Final proposal', 'Respond to Megan', 'Kickoff']);
});

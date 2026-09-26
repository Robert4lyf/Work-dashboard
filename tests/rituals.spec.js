const { test, expect } = require('./fixtures');

// Wednesday 23 Sep 2026, 9am; the clock only moves when a test moves it.
test.beforeEach(async ({ app, page }) => {
  await page.clock.install({ time: new Date(2026, 8, 23, 9) });
  await app.open();
  await page.clock.pauseAt(new Date(2026, 8, 23, 9, 0, 30));
});

test('after stopping a session, a note on where you left off shows on that step', async ({ app, page }) => {
  await app.addQuest('Report');
  await app.go('focus');
  await page.click('#start');
  await page.clock.fastForward('10:00');
  await page.click('#v-zen [data-stop="save"]');
  await page.fill('#leftin', 'Halfway through section 2');
  await page.press('#leftin', 'Enter');
  let s = await app.state();
  expect(s.quests[0].left).toEqual({ text: 'Halfway through section 2', d: '2026-09-23' });
  // It shows in single-task mode, the Focus tab and the quest's page.
  await expect(page.locator('#v-zen .leftnote')).toContainText('Halfway through section 2');
  await page.click('#zenexit');
  await expect(page.locator('#v-focus .leftnote')).toContainText('Halfway through section 2');
  await app.go('today');
  await app.openQuest('Report');
  await expect(page.locator('#v-today .leftnote')).toContainText('Halfway through section 2');
  await page.click('#v-today [data-clearleft]');
  expect((await app.state()).quests[0].left).toBeUndefined();

  // Skip leaves no note, and a session that ends on its own asks too.
  await app.go('focus');
  await page.click('#start');
  await page.clock.fastForward('26:00');
  await expect(page.locator('#leftin')).toBeVisible();
  await page.click('#leftskip');
  await expect(page.locator('#leftin')).toHaveCount(0);
  expect((await app.state()).quests[0].left).toBeUndefined();
});

test('one Pause button: naming a cause logs an interruption, a break logs nothing', async ({ app, page }) => {
  await app.go('focus');
  await page.click('#start');
  await expect(page.locator('[data-interrupt]')).toHaveCount(0); // no separate button
  const pause = () => page.click('#v-zen [data-pause]');
  await pause();
  await expect(page.locator('#whyform label')).toHaveText('What paused you?');
  await page.fill('#whyin', 'Slack');
  await page.press('#whyin', 'Enter');
  await pause(); // resume
  await page.clock.fastForward('05:00');
  await pause();
  await page.click('#v-zen [data-why="Slack"]'); // causes used before are one tap
  await pause();
  await pause();
  await page.click('#whyskip'); // "Just a break"
  await pause(); // resume
  await pause();
  await pause(); // paused and resumed without answering: nothing logged either
  await expect(page.locator('#whyform')).toHaveCount(0);
  const s = await app.state();
  expect(s.interrupts.map(x => x.why)).toEqual(['Slack', 'Slack']);
  expect(s.timer.left).toBeUndefined(); // running again
  await pause();
  await page.click('#whyskip');
  await page.click('#zenexit');
  await app.go('log');
  await expect(page.locator('#v-log')).toContainText('Interruptions, last 7 days: 2');
  await expect(page.locator('#v-log')).toContainText('Most often 09:00–10:00');
  await expect(page.locator('#v-log .bar').first()).toContainText('Slack');
});

test('quests carried over for 3+ days ask for a decision each morning', async ({ app, page }) => {
  for (const t of ['Old report', 'Old email', 'Old call', 'Old idea', 'Fresh']) await app.addQuest(t);
  expect((await app.state()).quests.every(q => q.since === '2026-09-23')).toBe(true);
  await app.setState(s => s.quests.slice(0, 4).forEach(q => (q.since = '2026-09-19')));
  await page.reload();
  const card = page.locator('#v-today .carried');
  await expect(card.locator('.crow')).toHaveCount(4);
  await expect(card).toContainText('Old report 4 days');
  await expect(page.locator('#v-today .row .tag.old').first()).toHaveText('4 days');

  await card.locator('[data-keep]').first().click(); // Keep: off the card until tomorrow
  await card.locator('.crow', { hasText: 'Old email' }).locator('[data-sched]').first().click();
  await card.locator('[data-toinbox]').first().click(); // Old call
  await card.locator('[data-drop]').first().click(); // Old idea
  await expect(card).toHaveCount(0);
  let s = await app.state();
  expect(s.quests.map(q => q.text)).toEqual(['Old report', 'Fresh']);
  expect(s.quests[0].kept).toBe('2026-09-23');
  expect(s.later).toMatchObject([{ text: 'Old email', start: '2026-09-24' }]);
  expect(s.later[0].since).toBeUndefined();
  expect(s.inbox[0].text).toBe('Old call');

  // Back on Today, a moved quest starts counting again; a kept one asks again tomorrow.
  await page.clock.setSystemTime(new Date(2026, 8, 24, 9));
  await page.reload();
  s = await app.state();
  expect(s.quests.find(q => q.text === 'Old email').since).toBe('2026-09-24');
  await expect(card.locator('.crow')).toHaveCount(1);
  await expect(card).toContainText('Old report 5 days');
});

test('a quest can wait on someone: shown on Today and the Waiting tab, not Next up', async ({
  app,
  page,
}) => {
  await app.addQuest('Budget review');
  await app.addQuest('Write report');
  await app.openQuest('Budget review');
  await page.click('#waitd summary');
  await page.fill('#wwho', 'Sam');
  await page.fill('#wnote', 'Q3 figures');
  await page.fill('#wdue', '2026-09-23');
  await page.click('[data-waitsave]');
  let s = await app.state();
  expect(s.quests[0].wait).toEqual({
    who: 'Sam',
    note: 'Q3 figures',
    due: '2026-09-23',
    since: '2026-09-23',
  });
  await expect(page.locator('#waitd summary')).toHaveText('Waiting on Sam');
  await page.click('[data-crumb="-1"]');
  await expect(page.locator('#v-today .row .tag.wait')).toHaveText('Waiting on Sam');
  // Waiting rows look different (dark orange); others don't.
  await expect(page.locator('#v-today .row.waiting')).toHaveCount(1);
  await expect(page.locator('#v-today .row.waiting')).toContainText('Budget review');
  // It's blocked, so Next up moves on to the next quest.
  await expect(page.locator('#hnow')).toContainText('Write report');
  await expect(page.locator('#v-today .attn')).toContainText('1 to chase');
  await expect(page.locator('nav #waitBadge')).toHaveText('1');

  await app.go('waiting');
  const v = page.locator('#v-waiting');
  await expect(v.locator('.row')).toHaveCount(1);
  await expect(v.locator('.row')).toContainText('from Sam · Q3 figures');
  await expect(v.locator('.row')).toContainText('Chase today');

  // Add from the Waiting tab: it lands in the Inbox, already waiting, and is listed here.
  await page.fill('#wwhat', 'Signed contract');
  await page.fill('#wfrom', 'Legal');
  await page.press('#wwhat', 'Enter');
  s = await app.state();
  expect(s.inbox[0]).toMatchObject({ text: 'Signed contract', wait: { who: 'Legal', due: '' } });
  await expect(v.locator('.row')).toHaveCount(2);
  await expect(v.locator('.row', { hasText: 'Signed contract' })).toContainText('from Legal · in Inbox');
  // Moving it to Today keeps it waiting.
  await app.go('inbox');
  await expect(page.locator('#v-inbox .tag.wait')).toHaveText('Waiting on Legal');
  await page.click('#v-inbox [data-promote]');
  s = await app.state();
  expect(s.quests.find(q => q.text === 'Signed contract').wait).toMatchObject({ who: 'Legal' });
  await app.go('waiting');

  // "Got it" puts it back on the list as a normal quest.
  await v.locator('.row', { hasText: 'Budget review' }).locator('[data-waitclear]').click();
  s = await app.state();
  expect(s.quests[0].wait).toBeUndefined();
  await expect(page.locator('#hnow')).toContainText('Budget review');
  await expect(v.locator('.row')).toHaveCount(1);
  // Ticking one off from the Waiting tab finishes the quest.
  await v.locator('[data-toggle]').click();
  expect((await app.state()).quests.find(q => q.text === 'Signed contract').done).toBe(true);
  await expect(v.locator('.empty')).toHaveText('Nothing to chase.');
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

test('a waiting quest gets a chase notification, and skips the carried-over card', async ({ app, page }) => {
  await app.addQuest('Budget review');
  await app.setState(s => {
    s.quests[0].since = '2026-09-10';
    s.quests[0].wait = { who: 'Sam', note: '', due: '2026-09-25', since: '2026-09-10' };
  });
  await page.reload();
  await expect(page.locator('#v-today .carried')).toHaveCount(0);
  const want = await page.evaluate(() => wantedNotices(new Date(2026, 8, 23, 9).getTime()));
  expect(want.find(n => n.key.startsWith('chase:'))).toMatchObject({
    title: 'Time to chase',
    body: 'Budget review (Sam)',
  });
});

test('old promises become quests: waiting ones set waiting, "I owe" ones plain', async ({ app, page }) => {
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
    { id: 'p-a', text: 'Budget figures', wait: { who: 'Sam', due: '2026-09-25' } },
    { id: 'p-b', text: 'Send the deck (for Sarah)', due: '2026-09-24' },
  ]);
  expect(s.quests[1].wait).toBeUndefined();
});

test('interruptions sync as their own rows; waiting travels with its quest', async ({ app, page }) => {
  const r = await page.evaluate(() => {
    S.interrupts.push({ id: 'i1', t: Date.now(), q: null, why: 'Call' });
    S.quests.push(fix({ id: 'q1', text: 'x', wait: { who: 'Sam', note: '', due: '', since: '' } }));
    const m = toRecords(S),
      back = fromRecords(m, S.day);
    return { keys: [...m.keys()].filter(k => /^(interrupt|promise):/.test(k)), back };
  });
  expect(r.keys).toEqual(['interrupt:i1']);
  expect(r.back.interrupts[0].why).toBe('Call');
  expect(r.back.quests[0].wait.who).toBe('Sam');
});

test('a quest with a step waiting on someone shows as waiting too', async ({ app, page }) => {
  await app.addQuest('Budget');
  await app.openQuest('Budget');
  await app.addSub('Get figures');
  await app.addSub('Write summary');
  await app.setState(
    s => (s.quests[0].children[0].wait = { who: 'Sam', note: '', due: '', since: '2026-09-23' }),
  );
  await page.reload();
  const row = page.locator('#v-today .row', { hasText: 'Budget' });
  await expect(row).toHaveClass(/waiting/);
  await expect(row.locator('.tag.wait')).toHaveText('Step waiting on Sam');
  // The rest of the quest carries on: Next up skips the waiting step.
  await expect(page.locator('#hnow')).toContainText('Write summary');
  // Once the step is back, the quest isn't waiting.
  await app.setState(s => delete s.quests[0].children[0].wait);
  await page.reload();
  await expect(row).not.toHaveClass(/waiting/);
});

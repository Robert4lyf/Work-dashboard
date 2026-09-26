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

test('interruptions are logged with one tap, with an optional reason, and summarised', async ({
  app,
  page,
}) => {
  await app.go('focus');
  await page.click('#start');
  await page.click('#v-zen [data-interrupt]');
  await page.fill('#whyin', 'Slack');
  await page.press('#whyin', 'Enter');
  await page.clock.fastForward('05:00');
  await page.click('#v-zen [data-interrupt]');
  await page.click('#v-zen [data-why="Slack"]'); // reasons used before are one tap
  await page.click('#v-zen [data-interrupt]');
  await page.click('#whyskip');
  const s = await app.state();
  expect(s.interrupts.map(x => x.why)).toEqual(['Slack', 'Slack', '']);
  expect(s.timer).not.toBeNull(); // logging doesn't stop the session
  await page.click('#zenexit');
  await app.go('log');
  await expect(page.locator('#v-log')).toContainText('Interruptions, last 7 days: 3');
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

test('promises: I owe and waiting for, with due dates, History and the header', async ({ app, page }) => {
  await app.go('promises');
  await page.fill('#pwhat', 'Send the deck');
  await page.fill('#pwho', 'Sarah');
  await page.fill('#pdue', '2026-09-23');
  await page.press('#pwhat', 'Enter');
  await page.click('[data-pdir="wait"]');
  await page.fill('#pwhat', 'Budget figures');
  await page.fill('#pwho', 'Sam');
  await page.click('#pform .btn');
  let s = await app.state();
  expect(s.promises).toMatchObject([
    { dir: 'owe', what: 'Send the deck', who: 'Sarah', due: '2026-09-23', done: '' },
    { dir: 'wait', what: 'Budget figures', who: 'Sam', due: '', done: '' },
  ]);
  const v = page.locator('#v-promises');
  await expect(v.locator('.list').first()).toContainText('for Sarah');
  await expect(v.locator('.list').first()).toContainText('Due today');
  await expect(page.locator('#hstats')).toContainText('1 promise due');

  // Done goes into History; undoing takes it back out.
  await v.locator('[data-pdone]').first().click();
  s = await app.state();
  expect(s.promises[0].done).toBe('2026-09-23');
  expect(s.log.at(-1)).toMatchObject({ text: 'Send the deck (for Sarah)', d: '2026-09-23' });
  await expect(page.locator('#hstats')).not.toContainText('promise');
  await page.click('#pdoned summary');
  await v.locator('.row.done [data-pdone]').click();
  s = await app.state();
  expect(s.promises[0].done).toBe('');
  expect(s.log.some(x => x.text === 'Send the deck (for Sarah)')).toBe(false);

  await v.locator('[data-pdel]').last().click();
  expect((await app.state()).promises.map(p => p.what)).toEqual(['Send the deck']);
  // A due promise gets a notification at 9am.
  const want = await page.evaluate(() => wantedNotices(new Date(2026, 8, 22, 9).getTime()));
  expect(want.find(n => n.key.startsWith('promise:'))).toMatchObject({
    title: 'Promise due',
    body: 'Send the deck for Sarah',
  });
});

test('promises and interruptions sync as their own rows', async ({ app, page }) => {
  const keys = await page.evaluate(() => {
    S.promises.push({ id: 'p1', dir: 'owe', what: 'x', who: '', due: '', done: '', t: 1 });
    S.interrupts.push({ id: 'i1', t: Date.now(), q: null, why: 'Call' });
    const m = toRecords(S),
      back = fromRecords(m, S.day);
    return { keys: [...m.keys()].filter(k => /^(promise|interrupt):/.test(k)), back };
  });
  expect(keys.keys).toEqual(['promise:p1', 'interrupt:i1']);
  expect(keys.back.promises[0].id).toBe('p1');
  expect(keys.back.interrupts[0].why).toBe('Call');
});

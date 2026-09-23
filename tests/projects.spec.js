const { test, expect } = require('./fixtures');

test.beforeEach(async ({ app, page }) => {
  await page.clock.install({ time: new Date(2026, 8, 23, 9) });
  await app.open();
  await page.clock.pauseAt(new Date(2026, 8, 23, 9, 0, 30));
});

test('projects group quests, count progress and focus time', async ({ app, page }) => {
  page.on('dialog', d => d.accept('Q4 launch'));
  await app.addQuest('Write plan');
  await app.addQuest('Book venue');
  await app.addQuest('Unrelated');
  await app.openQuest('Write plan');
  await page.selectOption('[data-setproject]', '__new');
  let s = await app.state();
  const pid = s.projects[0].id;
  expect(s.projects[0]).toMatchObject({ name: 'Q4 launch', done: false });
  expect(s.quests[0].project).toBe(pid);
  await page.click('[data-crumb="-1"]');
  await app.openQuest('Book venue');
  await page.selectOption('[data-setproject]', pid);
  await page.click('[data-crumb="-1"]');
  await expect(page.locator('#v-today .row .tag.proj')).toHaveCount(2);

  // 10 minutes of focus on the plan, then finish it.
  await app.go('focus');
  await page.click('#start');
  await page.clock.fastForward('10:00');
  await page.click('#stopdone');
  s = await app.state();
  expect(s.sessions[0].p).toBe(pid);
  expect(s.pdaily['2026-09-23'][pid]).toBe(10);
  expect(s.log[0].p).toBe(pid);

  await app.go('log');
  const card = page.locator('.projcard', { hasText: 'Q4 launch' });
  await expect(card).toContainText('1 done · 1 open · 10m');
  await expect(card.locator('.prog div')).toHaveAttribute('style', /width:50%/);
  await card.locator('[data-open]').click();
  await expect(page.locator('.node h1')).toHaveText('Book venue');

  await app.go('log');
  await page.click('[data-projdone]');
  expect((await app.state()).projects[0].done).toBe(true);
  await expect(page.locator('#projfin summary')).toHaveText('Finished projects (1)');
});

test('inbox items carry their project; renaming and deleting projects', async ({ app, page }) => {
  await app.go('account');
  await page.fill('#projin', 'Hiring');
  await page.press('#projin', 'Enter');
  const pid = (await app.state()).projects[0].id;
  await app.go('inbox');
  await page.fill('#iin', 'Screen CVs');
  await page.press('#iin', 'Enter');
  const id = (await app.state()).inbox[0].id;
  await page.click(`[data-steps="${id}"]`);
  await page.selectOption(`[data-setproject="${id}"]`, pid);
  await page.click(`[data-promote="${id}"]`);
  expect((await app.state()).quests[0].project).toBe(pid);

  await app.go('account');
  await page.fill('[data-projname="0"]', 'Hiring Q4');
  await page.press('[data-projname="0"]', 'Tab');
  await app.go('today');
  await expect(page.locator('#v-today .tag.proj')).toHaveText('Hiring Q4');
  await app.go('account');
  await page.click('[data-delproj="0"]');
  await page.click('[data-delproj="0"]');
  let s = await app.state();
  expect(s.projects).toEqual([]);
  expect(s.quests[0].project).toBe('');
  await page.click('#undo');
  s = await app.state();
  expect(s.quests[0].project).toBe(pid);
});

test('project time merges when both devices logged focus the same day', async ({ page }) => {
  const r = await page.evaluate(() => {
    const t = h => new Date(2026, 8, 23, h).getTime();
    const base = { editedAt: 1, sessions: [], pdaily: {}, daily: {} };
    const mine = {
      editedAt: 3,
      sessions: [{ tag: '', mins: 10, t: t(10), q: 'a', p: 'P1' }],
      pdaily: { '2026-09-23': { P1: 10 } },
      daily: { '2026-09-23': { '': 10 } },
    };
    const theirs = {
      editedAt: 2,
      sessions: [{ tag: '', mins: 5, t: t(11), q: 'b', p: 'P1' }],
      pdaily: { '2026-09-23': { P1: 5 } },
      daily: { '2026-09-23': { '': 5 } },
    };
    return mergeState(base, mine, theirs);
  });
  expect(r.pdaily['2026-09-23']).toEqual({ P1: 15 });
  expect(r.daily['2026-09-23']).toEqual({ '': 15 });
});

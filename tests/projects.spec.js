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
  await page.click('#v-zen [data-stop="done"]');
  await page.keyboard.press('Escape');
  s = await app.state();
  expect(s.sessions[0].p).toBe(pid);
  expect(s.pdaily['2026-09-23'][pid]).toBe(10);
  expect(s.log[0].p).toBe(pid);

  await app.go('projects');
  const card = page.locator('.projcard', { hasText: 'Q4 launch' });
  await expect(card).toContainText('1 done · 1 open · 10m');
  await expect(card.locator('.prog div')).toHaveAttribute('style', /width:50%/);
  await card.locator('[data-open]').click();
  await expect(page.locator('.node h1')).toHaveText('Book venue');

  await app.go('projects');
  await page.click('[data-projdone]');
  expect((await app.state()).projects[0].done).toBe(true);
  await expect(page.locator('#projfin > summary')).toHaveText('Finished projects (1)');
});

test('inbox items carry their project; renaming and deleting projects', async ({ app, page }) => {
  await app.go('projects');
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

  await app.go('projects');
  await page.click(`#projm-${pid} summary`);
  await page.fill('[data-projname="0"]', 'Hiring Q4');
  await page.press('[data-projname="0"]', 'Tab');
  await app.go('today');
  await expect(page.locator('#v-today .tag.proj')).toHaveText('Hiring Q4');
  await app.go('projects');
  await page.click('[data-delproj="0"]');
  await page.click('[data-delproj="0"]');
  let s = await app.state();
  expect(s.projects).toEqual([]);
  expect(s.quests[0].project).toBe('');
  await page.click('#undo');
  s = await app.state();
  expect(s.quests[0].project).toBe(pid);
});

test('the Projects tab sets up projects and adds quests to them', async ({ app, page }) => {
  await app.addQuest('Loose end');
  await app.go('projects');
  await expect(page.locator('#v-projects .empty')).toHaveText('No projects yet.');
  await page.fill('#projin', 'Website');
  await page.press('#projin', 'Enter');
  const pid = (await app.state()).projects[0].id;
  const card = page.locator('.projcard', { hasText: 'Website' });
  // A new quest goes on Today, in the project.
  await card.locator(`#pa-${pid}`).fill('Draft homepage copy');
  await card.locator(`#pa-${pid}`).press('Enter');
  // An existing quest from Today joins it.
  await card.locator('[data-projpick]').selectOption({ label: 'Loose end' });
  const s = await app.state();
  expect(s.quests.map(q => [q.text, q.project])).toEqual([
    ['Loose end', pid],
    ['Draft homepage copy', pid],
  ]);
  await expect(card).toContainText('0 done · 2 open');
  await expect(card.locator('[data-projpick]')).toHaveCount(0); // nothing left without a project
  await card.locator('[data-open]', { hasText: 'Draft homepage copy' }).click();
  await expect(page.locator('.node h1')).toHaveText('Draft homepage copy');
  await expect(page.locator('#v-today')).toBeVisible();
});

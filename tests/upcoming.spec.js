const { test, expect } = require('./fixtures');

// Wednesday 23 Sep 2026, 9am
test.beforeEach(async ({ app, page }) => {
  await page.clock.install({ time: new Date(2026, 8, 23, 9) });
  await app.open();
});
const setDay = async (page, y, m, d) => {
  await page.clock.setSystemTime(new Date(y, m - 1, d, 9));
  await page.reload();
};

// The board's Upcoming cards: each one's name and what its card says of when it starts.
const upcoming = page =>
  page.$$eval('#v-projects .project-card:has([data-upcoming-project])', cs =>
    cs.map(c => [
      c.querySelector('.project-open > span').textContent,
      c.querySelector('.project-meta > span').textContent,
    ]),
  );
const actions = page => page.click('#v-today .qfoot .qmore');

test('a task put off to tomorrow leaves the active projects and comes back on the day', async ({
  app,
  page,
}) => {
  await app.addQuest('Report');
  await app.addQuest('Email');
  await app.openQuest('Report');
  await app.setTag('Design');
  await app.addSub('Draft');
  // (tomorrow and next week are in its actions; More keeps the date field alone)
  await app.openMore();
  await expect(page.locator('#mored [data-sched]')).toHaveCount(0);
  await expect(page.locator('#mored [data-schedpick]')).toBeVisible();
  await actions(page);
  await page.click('#sheet [data-sched][data-kind="q"] >> text=Do tomorrow');
  let s = await app.state();
  expect(s.quests.map(q => q.text)).toEqual(['Email']);
  expect(s.later[0]).toMatchObject({ text: 'Report', start: '2026-09-24', tag: 'Design' });
  // Back on the board, it's under Upcoming with the day it starts.
  await expect(page.locator('#v-projects')).toBeVisible();
  await expect(page.locator('#v-projects .project-group h3')).toHaveText('Upcoming');
  expect(await upcoming(page)).toEqual([['Report', 'Starts 24 Sep']]);
  expect(await app.order()).toEqual(['Email', 'Report']);
  expect(await page.evaluate(() => recommend()?.n.text)).toBe('Email');
  await setDay(page, 2026, 9, 24);
  s = await app.state();
  expect(s.later).toEqual([]);
  expect(s.quests.map(q => q.text)).toEqual(['Email', 'Report']);
  expect(s.quests[1].start).toBeUndefined();
  expect(s.quests[1].children[0].text).toBe('Draft');
  expect(await upcoming(page)).toEqual([]);
  await expect(page.locator('#v-projects .project-group')).toHaveCount(0);
});

test('next week, date picker, reschedule, bring back and delete', async ({ app, page }) => {
  for (const t of ['A', 'B', 'C']) await app.addQuest(t);
  await app.openQuest('A');
  await actions(page);
  await page.click('#sheet [data-sched] >> text=Do next week');
  await app.openQuest('B');
  await app.openMore();
  await page.fill('[data-schedpick]', '2026-10-10');
  let s = await app.state();
  expect(s.later.map(n => [n.text, n.start])).toEqual([
    ['A', '2026-09-28'],
    ['B', '2026-10-10'],
  ]);
  expect(await upcoming(page)).toEqual([
    ['A', 'Starts 28 Sep'],
    ['B', 'Starts 10 Oct'],
  ]);
  // An Upcoming card opens its record: the start date changes there, and it can start now.
  await page.click('#v-projects [data-upcoming-project] >> text="B"');
  const rec = page.locator('#v-project-record');
  await expect(rec.locator('h1')).toHaveText('B');
  await expect(rec).toContainText('Starts 10 Oct');
  await rec.locator('[data-restart]').fill('2026-09-25');
  expect((await app.state()).later.map(n => n.text)).toEqual(['B', 'A']);
  await expect(rec).toContainText('Starts 25 Sep');
  await rec.locator('[data-now]').click();
  expect((await app.state()).quests.map(q => q.text)).toEqual(['C', 'B']);
  await expect(page.locator('#toast')).toContainText('Moved to Projects');
  await expect(page.locator('#v-today .node.facts > h1')).toHaveText('B'); // (its page, back on Projects)
  // The Upcoming list (as the Waiting page and the forecast open it) deletes one, in two taps.
  await page.evaluate(() => showUpcoming());
  await expect(page.locator('#upd summary')).toHaveText('Upcoming (1)');
  await page.click('[data-dellater]');
  await expect(page.locator('[data-dellater]')).toHaveText('Delete?');
  expect((await app.state()).later.map(n => n.text)).toEqual(['A']);
  await page.click('[data-dellater]');
  expect((await app.state()).later).toEqual([]);
  await page.click('#undo');
  expect((await app.state()).later.map(n => n.text)).toEqual(['A']);
});

test('steps cannot be scheduled on their own', async ({ app, page }) => {
  await app.addQuest('Report');
  await app.openQuest('Report');
  await app.addSub('Draft');
  await page.click('.open >> text=Draft');
  await expect(page.locator('#v-today .node.facts > h1')).toHaveText('Draft');
  // (no date field under its More, and no Do tomorrow / Do next week / Schedule in its actions)
  await app.openMore();
  await expect(page.locator('#mored')).toHaveAttribute('open', '');
  await expect(page.locator('#v-today [data-schedpick]')).toHaveCount(0);
  await expect(page.locator('[data-sched]')).toHaveCount(0);
  await actions(page);
  await expect(page.locator('#sheet .qact', { hasText: 'Rename' })).toBeVisible();
  await expect(page.locator('#sheet [data-sched]')).toHaveCount(0);
  await expect(page.locator('#sheet [data-schedset]')).toHaveCount(0);
});

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

test('a quest scheduled for Tomorrow leaves Today and comes back on the day', async ({ app, page }) => {
  await app.addQuest('Report');
  await app.addQuest('Email');
  await app.openQuest('Report');
  await page.click('[data-settag="Design"]');
  await app.addSub('Draft');
  await page.click('[data-sched][data-kind="q"] >> text=Tomorrow');
  let s = await app.state();
  expect(s.quests.map(q => q.text)).toEqual(['Email']);
  expect(s.later[0]).toMatchObject({ text: 'Report', start: '2026-09-24', tag: 'Design' });
  await expect(page.locator('#upd summary')).toHaveText('Upcoming (1)');
  await expect(page.locator('#hnow b')).toHaveText('Email');
  await setDay(page, 2026, 9, 24);
  s = await app.state();
  expect(s.later).toEqual([]);
  expect(s.quests.map(q => q.text)).toEqual(['Email', 'Report']);
  expect(s.quests[1].start).toBeUndefined();
  expect(s.quests[1].children[0].text).toBe('Draft');
});

test('Next Mon, date picker, reschedule, bring back and delete', async ({ app, page }) => {
  for (const t of ['A', 'B', 'C']) await app.addQuest(t);
  await app.openQuest('A');
  await page.click('[data-sched] >> text=Next Mon');
  await app.openQuest('B');
  await page.fill('[data-schedpick]', '2026-10-10');
  let s = await app.state();
  expect(s.later.map(n => [n.text, n.start])).toEqual([
    ['A', '2026-09-28'],
    ['B', '2026-10-10'],
  ]);
  await page.click('#upd summary');
  await page.fill('[data-restart] >> nth=1', '2026-09-25');
  expect((await app.state()).later.map(n => n.text)).toEqual(['B', 'A']);
  await page.click('[data-now] >> nth=0');
  expect((await app.state()).quests.map(q => q.text)).toEqual(['C', 'B']);
  await page.click('[data-dellater]');
  await page.click('[data-dellater]');
  expect((await app.state()).later).toEqual([]);
  await page.click('#undo');
  expect((await app.state()).later.map(n => n.text)).toEqual(['A']);
});

test('an inbox item can go straight to Upcoming', async ({ app, page }) => {
  await app.go('inbox');
  await page.fill('#iin', 'Book dentist');
  await page.press('#iin', 'Enter');
  const id = (await app.state()).inbox[0].id;
  await page.click(`[data-steps="${id}"]`);
  await page.click(`[data-settag="Admin"][data-id="${id}"]`);
  await page.click(`[data-sched="${id}"] >> text=Tomorrow`);
  const s = await app.state();
  expect(s.inbox).toEqual([]);
  expect(s.later[0]).toMatchObject({ text: 'Book dentist', tag: 'Admin', start: '2026-09-24' });
});

test('subquests cannot be scheduled on their own', async ({ app, page }) => {
  await app.addQuest('Report');
  await app.openQuest('Report');
  await app.addSub('Draft');
  await page.click('.open >> text=Draft');
  await expect(page.locator('[data-sched]')).toHaveCount(0);
});

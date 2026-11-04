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

test('repeat panel: presets, weekdays, monthly and off', async ({ app, page }) => {
  await app.addQuest('Weekly report');
  await app.openQuest('Weekly report');
  await app.addSub('Gather numbers');
  await page.click('#mored > summary');
  await page.click('#rptd summary');
  await page.click('[data-rday="1"]');
  let s = await app.state();
  expect(s.templates[0]).toMatchObject({ auto: true, days: [1], text: 'Weekly report' });
  expect(s.quests[0].tpl).toBe(s.templates[0].id);
  await expect(page.locator('#rptd summary')).toContainText('Repeat: Mon');
  await page.click('[data-rpreset="weekdays"]');
  expect((await app.state()).templates[0].days.sort()).toEqual([1, 2, 3, 4, 5]);
  await page.click('[data-rpreset="off"]');
  s = await app.state();
  expect(s.templates).toHaveLength(0);
  expect(s.quests[0].tpl).toBeUndefined();
  await page.click('[data-rday="1"]');
  await page.selectOption('#fmonth', '31');
  expect((await app.state()).templates[0].monthDay).toBe(31);
});

test('a repeating task is on Today only on its days: missed days are not caught up', async ({
  app,
  page,
}) => {
  await app.addQuest('Weekly report');
  await app.openQuest('Weekly report');
  await app.addSub('Gather numbers');
  await page.click('#mored > summary');
  await page.click('#rptd summary');
  await page.click('[data-rday="1"]');
  await page.click('[aria-label="Mark done: Gather numbers"]');
  await setDay(page, 2026, 9, 24);
  expect((await app.state()).quests).toHaveLength(0);
  await setDay(page, 2026, 9, 29); // Monday 28th was missed: not caught up on Tuesday
  expect((await app.state()).quests).toHaveLength(0);
  await setDay(page, 2026, 10, 5); // Monday
  let s = await app.state();
  expect(s.quests.map(q => [q.text, q.id.slice(-10)])).toEqual([['Weekly report', '2026-10-05']]);
  expect(s.quests[0].children[0].done).toBe(false);
  // Left unfinished, with a step ticked: gone the next day, and a fresh copy on the next Monday.
  await page.evaluate(() => {
    S.quests[0].children.push(fix({ id: 'x', text: 'Extra' }));
    S.quests[0].children[0].done = true;
    save();
  });
  await setDay(page, 2026, 10, 6);
  expect((await app.state()).quests).toHaveLength(0);
  await setDay(page, 2026, 10, 12);
  s = await app.state();
  expect(s.quests.map(q => q.id.slice(-10))).toEqual(['2026-10-12']);
  expect(s.quests[0].children.map(c => [c.text, c.done])).toEqual([['Gather numbers', false]]);
});

test("a daily repeat left unfinished is replaced by the day's fresh copy; set on another day, it leaves Today", async ({
  app,
  page,
}) => {
  await app.addQuest('Standup notes');
  await app.openQuest('Standup notes');
  await app.addSub('Write');
  await page.click('#mored > summary');
  await page.click('#rptd summary');
  await page.click('[data-rpreset="daily"]');
  await page.click('[data-crumb="-1"]');
  await app.addQuest('Plan');
  await app.openQuest('Plan');
  await page.evaluate(() => ['#mored', '#rptd'].forEach(x => (document.querySelector(x).open = true)));
  await page.click('[data-rday="5"]'); // Fridays (set on a Wednesday)
  await setDay(page, 2026, 9, 24); // Thursday
  let s = await app.state();
  expect(s.quests.map(q => q.id.slice(-10))).toEqual(['2026-09-24']);
  expect(s.quests[0].text).toBe('Standup notes');
  // Today's copy made by another device's reset first is kept, ticks and all.
  await page.evaluate(() => {
    const bf = snapshot();
    S.quests[0].children[0].done = true;
    settle(bf);
    S.day = '2026-09-23';
    save();
  });
  await page.reload();
  s = await app.state();
  expect(s.quests.map(q => [q.id.slice(-10), q.children[0].done])).toEqual([['2026-09-24', true]]);
  await setDay(page, 2026, 9, 25); // Friday
  s = await app.state();
  expect(s.quests.map(q => q.text).sort()).toEqual(['Plan', 'Standup notes']);
  expect(s.quests.every(q => q.id.endsWith('2026-09-25'))).toBe(true);
});

test('monthly on the 31st falls on the last day of short months', async ({ app, page }) => {
  await app.addQuest('Invoices');
  await app.openQuest('Invoices');
  await page.click('#mored > summary');
  await page.click('#rptd summary');
  await page.selectOption('#fmonth', '31');
  await app.setState(s => {
    s.quests = [];
    s.day = '2026-11-28';
  });
  await setDay(page, 2026, 11, 29);
  expect((await app.state()).quests).toHaveLength(0);
  await setDay(page, 2026, 11, 30);
  expect((await app.state()).quests).toHaveLength(1);
});

test('the daily reset does not mark data as newly edited', async ({ app, page }) => {
  await app.addQuest('A');
  await app.setState(s => {
    s.day = '2026-09-01';
    s.editedAt = 5;
  });
  await page.reload();
  expect((await app.state()).editedAt).toBe(5);
});

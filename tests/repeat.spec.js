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

test('missed repeat days are caught up once, with fresh subquests', async ({ app, page }) => {
  await app.addQuest('Weekly report');
  await app.openQuest('Weekly report');
  await app.addSub('Gather numbers');
  await page.click('#rptd summary');
  await page.click('[data-rday="1"]');
  await page.click('[aria-label="Mark done: Gather numbers"]');
  await setDay(page, 2026, 9, 24);
  expect((await app.state()).quests).toHaveLength(0);
  await setDay(page, 2026, 9, 29); // Monday 28th was missed
  let s = await app.state();
  expect(s.quests.map(q => q.text)).toEqual(['Weekly report']);
  expect(s.quests[0].children[0].done).toBe(false);
  await setDay(page, 2026, 10, 5); // still unfinished: no duplicate
  expect((await app.state()).quests).toHaveLength(1);
});

test('monthly on the 31st falls on the last day of short months', async ({ app, page }) => {
  await app.addQuest('Invoices');
  await app.openQuest('Invoices');
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

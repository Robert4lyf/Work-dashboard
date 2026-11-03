// Release A: today's top 3, chosen from Today's quests each day.
const { test, expect } = require('./fixtures');

const setDay = async (page, y, m, d) => {
  await page.clock.setSystemTime(new Date(y, m - 1, d, 9));
  await page.reload();
};
const titles = page => page.$$eval('#v-today .top3 .t3row .open > span', x => x.map(e => e.textContent));

test.beforeEach(async ({ app, page }) => {
  await page.clock.install({ time: new Date(2026, 8, 23, 9) });
  await app.open();
  await page.evaluate(() => {
    S.quests = ['A', 'B', 'C', 'D'].map((t, i) =>
      fix({ id: 'q' + t, text: 'Quest ' + t, children: i === 1 ? [fix({ id: 'sB', text: 'Step B1' })] : [] }),
    );
    save();
    renderAll();
  });
});

test('one, two and three can be chosen, in order; the fourth is refused; the list underneath is untouched', async ({
  app,
  page,
}) => {
  // Nothing chosen: one quiet line.
  await expect(page.locator('#v-today .top3empty')).toContainText('What matters most today?');
  await expect(page.locator('#v-today .top3')).toHaveCount(0);
  await page.click('[data-top3pick]');
  await expect(page.locator('#sheettitle')).toHaveText('Top 3 for today');
  await page.click('#sheet [data-t3tog="qC"]');
  await expect(page.locator('#sheet [data-t3tog="qC"]')).toHaveAttribute('aria-pressed', 'true');
  expect((await app.state()).top3).toEqual({ day: '2026-09-23', ids: ['qC'] });
  await page.click('#sheet [data-t3tog="qA"]');
  await page.click('#sheet [data-t3tog="qB"]');
  // Full: the rest can't be picked until one is taken out.
  await expect(page.locator('#sheet [data-t3tog="qD"]')).toBeDisabled();
  await page.click('#sheet [data-sheetclose]:not(.sheetback)');
  expect(await titles(page)).toEqual(['Quest C', 'Quest A', 'Quest B']);
  expect(await app.order()).toEqual(['Quest A', 'Quest B', 'Quest C', 'Quest D']); // (the list keeps its order)
  await expect(page.locator('#hnow b')).toHaveText('Quest A'); // (Next up is still the list's first)
  // Each row: progress, and a way to work on it.
  await expect(page.locator('.t3row[data-t3="qB"] small')).toHaveText('0 of 1 steps · Next: Step B1');
  await expect(page.locator('.t3row[data-t3="qA"] small')).toHaveText('To do');
  await page.click('.t3row[data-t3="qB"] [data-zen]');
  await expect(page.locator('#v-zen .zt')).toHaveText('Step B1');
  await page.keyboard.press('Escape');
  await page.click('.t3row[data-t3="qA"] .open');
  await expect(page.locator('#v-today h1')).toHaveText('Quest A');
});

test('replace, reorder and clear from the picker; add and remove from a row’s actions', async ({
  app,
  page,
}) => {
  await page.evaluate(() => setTop3(['qA', 'qB', 'qC']));
  await page.click('[data-top3pick]');
  // Replace C with D.
  await page.click('#sheet [data-t3tog="qC"]');
  await page.click('#sheet [data-t3tog="qD"]');
  // Reorder: D to the top.
  await page.click('#sheet [data-t3up="qD"]');
  await page.click('#sheet [data-t3up="qD"]');
  await expect(page.locator('#sheet [data-t3up="qD"]')).toBeDisabled();
  await page.keyboard.press('Escape');
  expect((await app.state()).top3.ids).toEqual(['qD', 'qA', 'qB']);
  expect(await titles(page)).toEqual(['Quest D', 'Quest A', 'Quest B']);
  // From a row's ⋯: take one out, put one in; a full top 3 opens the picker instead.
  await page.click('[aria-label="Actions: Quest A"]');
  await page.click('#sheet [data-top3]');
  await expect(page.locator('#toast')).toContainText('Removed from Top 3');
  expect((await app.state()).top3.ids).toEqual(['qD', 'qB']);
  await page.click('[aria-label="Actions: Quest C"]');
  await expect(page.locator('#sheet [data-top3]')).toHaveText('Add to Top 3');
  await page.click('#sheet [data-top3]');
  expect((await app.state()).top3.ids).toEqual(['qD', 'qB', 'qC']);
  await page.click('[aria-label="Actions: Quest A"]');
  await page.click('#sheet [data-top3]');
  await expect(page.locator('#sheettitle')).toHaveText('Top 3 for today');
  await expect(page.locator('#sheet .qahint')).toContainText('Top 3 is full');
  await page.click('#sheet [data-t3none]');
  await page.keyboard.press('Escape');
  expect((await app.state()).top3).toBeNull();
  await expect(page.locator('#v-today .top3empty')).toBeVisible();
});

test('a finished priority shows as done; a moved or deleted one drops out; back on Today it returns', async ({
  app,
  page,
}) => {
  await page.evaluate(() => setTop3(['qA', 'qB', 'qC']));
  await page.click('[aria-label="Mark done: Quest A"]');
  const a = page.locator('.t3row[data-t3="qA"]');
  await expect(a).toHaveClass(/done/);
  await expect(a.locator('.tag.done')).toHaveText('Done');
  await expect(a.locator('.btn')).toHaveCount(0);
  // Moved to tomorrow: out of the top 3 (the record keeps it, so Today again brings it back).
  await page.click('[aria-label="Actions: Quest B"]');
  await page.click('#sheet [data-sched]:has-text("Do tomorrow")');
  expect(await titles(page)).toEqual(['Quest A', 'Quest C']);
  expect((await app.state()).top3.ids).toEqual(['qA', 'qB', 'qC']);
  await page.click('#upd > summary');
  await page.click('#upd [data-now]');
  expect(await titles(page)).toEqual(['Quest A', 'Quest B', 'Quest C']);
  // Deleted: gone from the top 3; Undo brings it back.
  await page.click('[aria-label="Actions: Quest C"]');
  await page.click('#sheet [data-delnow]');
  expect(await titles(page)).toEqual(['Quest A', 'Quest B']);
  await page.click('#undo');
  expect(await titles(page)).toEqual(['Quest A', 'Quest B', 'Quest C']);
  // Every quest done: the empty line doesn't nag.
  await page.evaluate(() => {
    S.quests.forEach(q => {
      q.done = true;
      q.children.forEach(c => (c.done = true));
    });
    S.top3 = null;
    save();
    renderAll();
  });
  await expect(page.locator('#v-today .top3empty')).toHaveCount(0);
});

test('a new day starts with no top 3; yesterday’s isn’t carried over, and a reload keeps today’s', async ({
  app,
  page,
}) => {
  await page.evaluate(() => setTop3(['qA', 'qB']));
  await page.reload();
  expect(await titles(page)).toEqual(['Quest A', 'Quest B']);
  await setDay(page, 2026, 9, 24);
  await expect(page.locator('#v-today .top3empty')).toBeVisible();
  expect((await app.state()).top3).toBeNull();
  // A stale record (from a device that didn't run the day's reset) isn't shown either.
  await app.setState(s => (s.top3 = { day: '2026-09-23', ids: ['qA'] }));
  await page.reload();
  await expect(page.locator('#v-today .top3')).toHaveCount(0);
  // Malformed records are dropped, ids over three cut.
  await app.setState(s => (s.top3 = { day: 'nope', ids: ['qA'] }));
  await page.reload();
  expect((await app.state()).top3).toBeNull();
  await app.setState(s => (s.top3 = { day: today(), ids: ['qA', 'qA', 'bad id', 'qB', 'qC', 'qD'] }));
  await page.reload();
  expect((await app.state()).top3.ids).toEqual(['qA', 'qB', 'qC']);
});

test('keyboard: the picker and the actions sheet can be worked without a mouse', async ({ app, page }) => {
  await page.focus('[data-top3pick]');
  await page.keyboard.press('Enter');
  // The first choice has the keyboard; Space picks it, the sheet stays up; Escape closes it.
  expect(await page.evaluate(() => document.activeElement.dataset.t3tog)).toBe('qA');
  await page.keyboard.press('Space');
  expect(await page.evaluate(() => document.activeElement.dataset.t3tog)).toBe('qA');
  await expect(page.locator('#sheet [data-t3tog="qA"]')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(page.locator('#sheet')).toHaveCount(0);
  expect((await app.state()).top3.ids).toEqual(['qA']);
  expect(await page.evaluate(() => document.activeElement.dataset.top3pick)).toBe('1');
});

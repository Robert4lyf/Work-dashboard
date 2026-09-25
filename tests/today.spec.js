const { test, expect } = require('./fixtures');

test.beforeEach(async ({ app }) => app.open());

test('completing a quest logs it, sinks it and moves Next up', async ({ app, page }) => {
  for (const t of ['A', 'B', 'C']) await app.addQuest(t);
  await expect(page.locator('#hnow b')).toHaveText('A');
  await page.click('[aria-label="Mark done: A"]');
  expect(await app.order()).toEqual(['B', 'C', 'A']);
  await expect(page.locator('#hnow b')).toHaveText('B');
  expect((await app.state()).log.map(x => x.text)).toEqual(['A']);
  await page.click('[aria-label="Mark done: A"]');
  expect((await app.state()).log).toEqual([]);
  expect(await app.order()).toEqual(['B', 'C', 'A']);
});

test('reorder: Top makes a quest Next up; open items stay above done ones', async ({ app, page }) => {
  for (const t of ['A', 'B', 'C']) await app.addQuest(t);
  await page.click('[aria-label="Mark done: A"]');
  await page.click('#reorder');
  await page.click('[data-top]:not([disabled]) >> nth=0');
  expect(await app.order()).toEqual(['C', 'B', 'A']);
  await expect(page.locator('#hnow b')).toHaveText('C');
  const bDownDisabled = await page.evaluate(
    () =>
      [...document.querySelectorAll('#v-today .row')]
        .find(r => r.querySelector('.open>span').textContent === 'B')
        .querySelector('[data-down]').disabled,
  );
  expect(bDownDisabled).toBe(true);
  await expect(page.locator('.row.done [data-top]')).toHaveCount(0);
});

test('subquests: next step, sinking, and header tick', async ({ app, page }) => {
  await app.addQuest('Report');
  await app.openQuest('Report');
  await app.addSub('Draft');
  await app.addSub('Review');
  await expect(page.locator('#hnow')).toContainText('Next up in Report');
  await page.click('header .check');
  await expect(page.locator('#hnow b')).toHaveText('Review');
  expect(await app.order()).toEqual(['Review', 'Draft']);
});

test('delete can be undone', async ({ app, page }) => {
  await app.addQuest('Email Bob');
  await page.click('[aria-label="Delete Email Bob"]');
  await page.click('[aria-label="Delete Email Bob"]');
  expect((await app.state()).quests).toHaveLength(0);
  await page.click('#undo');
  expect((await app.state()).quests).toHaveLength(1);
});

test('tags are set on the quest and shown on its row', async ({ app, page }) => {
  await app.addQuest('Report');
  await app.openQuest('Report');
  await page.click('[data-settag="Design"]');
  expect((await app.state()).quests[0].tag).toBe('Design');
  await page.click('[data-crumb="-1"]');
  await expect(page.locator('#v-today .row .tag')).toHaveText('Design');
});

test('overdue count shows in the header', async ({ app, page }) => {
  await app.addQuest('Report');
  await app.openQuest('Report');
  await page.click('.node details summary >> nth=0');
  await page.fill('#fdue', '2000-01-01');
  await page.dispatchEvent('#fdue', 'change');
  await expect(page.locator('#hstats')).toContainText('1 overdue');
});

test('a background refresh keeps what you are typing', async ({ app, page }) => {
  await app.addQuest('First');
  await page.fill('#qin', 'Half-typed quest');
  await page.evaluate(() => inBackground(renderAll));
  await expect(page.locator('#qin')).toBeFocused();
  await expect(page.locator('#qin')).toHaveValue('Half-typed quest');
  await page.press('#qin', 'Enter');
  expect(await app.order()).toEqual(['First', 'Half-typed quest']);
  // A normal (user-driven) redraw after adding still clears the box.
  await expect(page.locator('#qin')).toHaveValue('');
});
